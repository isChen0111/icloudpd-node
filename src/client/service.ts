/**
 * PyiCloudService —— 对应 pyicloud_ipd/base.py
 *
 * 认证主流程：
 * 1. authenticate()：有 session_token 先 /validate，失败走 SRP
 * 2. _authenticate_srp(password)：/signin/init → /signin/complete
 * 3. 409 = 需要 2FA；412 = 非 2FA 账号，补 /repair/complete
 * 4. validate_2fa_code(code)：PUT /verify/trusteddevice/securitycode
 * 5. trust_session()：GET /2sv/trust
 * 6. _authenticate_with_token()：POST /setup/ws/1/accountLogin
 */
import crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { PyiCloudSession, type SessionEndpoints } from './session.js'
import { SrpUser } from '../auth/srp.js'
import { SessionStore, HEADER_DATA, type SessionData } from './session-store.js'
import { PhotosService } from '../services/photos.js'
import { AuthError, ApiError } from '../errors.js'

export type Domain = 'com' | 'cn'

function endpointsFor(domain: Domain): SessionEndpoints {
  if (domain === 'cn') {
    return {
      authRoot: 'https://idmsa.apple.com.cn',
      authEndpoint: 'https://idmsa.apple.com.cn/appleauth/auth',
      homeEndpoint: 'https://www.icloud.com.cn',
      setupEndpoint: 'https://setup.icloud.com.cn/setup/ws/1',
    }
  }
  return {
    authRoot: 'https://idmsa.apple.com',
    authEndpoint: 'https://idmsa.apple.com/appleauth/auth',
    homeEndpoint: 'https://www.icloud.com',
    setupEndpoint: 'https://setup.icloud.com/setup/ws/1',
  }
}

const WIDGET_KEY = 'd39ba9916b7251055b22c7f910e2ea796ee65e98b2ddecea8f5dde8d9d1a815d'

export interface AuthResult {
  requires2fa: boolean
  requires2sa: boolean
  data: Record<string, any>
}

/** 可序列化的会话状态，调用方自己存到数据库/文件/哪都行 */
export interface SessionSnapshot {
  cookies: Record<string, string>
  sessionData: SessionData
}

export interface ICloudOptions {
  /** 请求超时（毫秒），默认 30000 */
  timeout?: number
  /** 网络错误重试次数，默认 3 */
  maxRetries?: number
}

export class PyiCloudService {
  readonly session: PyiCloudSession
  clientId: string
  readonly store: SessionStore | null
  sessionData: SessionData = {}
  data: Record<string, any> = {}
  private _photos: PhotosService | null = null

  constructor(
    public readonly domain: Domain,
    public readonly appleId: string,
    public readonly passwordProvider: () => string | null,
    cookieDir?: string,
    options?: ICloudOptions,
  ) {
    this.clientId = `auth-${randomUUID().toLowerCase()}`
    const endpoints = endpointsFor(domain)
    this.session = new PyiCloudSession(endpoints, options)

    // cookieDir 传了才持久化，不传就纯内存（标准 SDK 做法）
    if (cookieDir) {
      this.store = new SessionStore(cookieDir, appleId)
      this.sessionData = this.store.loadSessionData()
      for (const [k, v] of this.store.loadCookies()) this.session.cookies.set(k, v)
    } else {
      this.store = null
    }

    if (this.sessionData.client_id) {
      this.clientId = this.sessionData.client_id
    } else {
      this.sessionData.client_id = this.clientId
    }

    // 每次响应后：提取 HEADER_DATA 字段 → 更新 session_data；有 store 就落盘
    this.session.onAfterResponse = (headers) => {
      let changed = false
      for (const [headerName, field] of Object.entries(HEADER_DATA)) {
        const v = headers.get(headerName)
        if (v) {
          this.sessionData[field] = v
          changed = true
        }
      }
      if (this.store) {
        if (changed) this.store.saveSessionData(this.sessionData)
        this.store.saveCookies(this.session.cookies)
      }
    }
  }

  /** 导出当前会话（给调用方自己持久化） */
  exportSession(): SessionSnapshot {
    const cookies: Record<string, string> = {}
    for (const [k, v] of this.session.cookies.entries()) cookies[k] = v
    return { cookies, sessionData: { ...this.sessionData } }
  }

  /** 从之前导出的快照恢复会话 */
  importSession(snap: SessionSnapshot): void {
    for (const [k, v] of Object.entries(snap.cookies)) this.session.cookies.set(k, v)
    this.sessionData = { ...snap.sessionData }
    if (this.sessionData.client_id) this.clientId = this.sessionData.client_id
  }

  private get authRoot() { return this.session.endpoints.authRoot }
  private get authEndpoint() { return this.session.endpoints.authEndpoint }
  private get homeEndpoint() { return this.session.endpoints.homeEndpoint }
  private get setupEndpoint() { return this.session.endpoints.setupEndpoint }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json, text/javascript',
      'Content-Type': 'application/json',
      'X-Apple-OAuth-Client-Id': WIDGET_KEY,
      'X-Apple-OAuth-Client-Type': 'firstPartyAuth',
      'X-Apple-OAuth-Redirect-URI': this.domain === 'cn' ? 'https://www.icloud.com.cn' : 'https://www.icloud.com',
      'X-Apple-OAuth-Require-Grant-Code': 'true',
      'X-Apple-OAuth-Response-Mode': 'web_message',
      'X-Apple-OAuth-Response-Type': 'code',
      'X-Apple-OAuth-State': this.clientId,
      'X-Apple-Widget-Key': WIDGET_KEY,
      Origin: this.authRoot,
      Referer: `${this.authRoot}/`,
    }
    if (this.sessionData.scnt) h['scnt'] = this.sessionData.scnt
    if (this.sessionData.session_id) h['X-Apple-ID-Session-Id'] = this.sessionData.session_id
    return { ...h, ...extra }
  }

  /** 入口：完整认证 */
  async authenticate(): Promise<AuthResult> {
    // 1. 先试已有 session_token
    if (this.sessionData.session_token) {
      try {
        this.data = await this.validateToken()
        return this.buildAuthResult()
      } catch {
        // token 失效，走完整登录
      }
    }
    const password = this.passwordProvider()
    if (!password) throw new AuthError('未提供密码')
    await this.authenticateSrp(password)
    return this.buildAuthResult()
  }

  private buildAuthResult(): AuthResult {
    const ds = this.data.dsInfo ?? {}
    const hsaVersion = ds.hsaVersion ?? 0
    return {
      requires2fa: hsaVersion === 2 && (this.data.hsaChallengeRequired || !this.isTrustedSession) && !!ds.hasICloudQualifyingDevice,
      requires2sa: hsaVersion >= 1 && (this.data.hsaChallengeRequired || !this.isTrustedSession),
      data: this.data,
    }
  }

  get isTrustedSession(): boolean {
    return !!this.data.hsaTrustedBrowser
  }

  /** /setup/ws/1/validate —— 检查 session_token 是否还有效 */
  async validateToken(): Promise<Record<string, any>> {
    const res = await this.session.post(`${this.setupEndpoint}/validate`, {
      body: 'null',
      headers: { Origin: this.homeEndpoint, Referer: `${this.homeEndpoint}/` },
    })
    if (res.status >= 400) throw new ApiError(`validate 失败: ${res.status}`, res.status)
    return res.body as Record<string, any>
  }

  /** SRP 登录：init → complete */
  private async authenticateSrp(password: string): Promise<void> {
    const user = new SrpUser(this.appleId)
    const { username, A } = user.start()
    const initBody = {
      a: A.toString('base64'),
      accountName: username,
      protocols: ['s2k', 's2k_fo'],
    }
    const initRes = await this.session.post(`${this.authEndpoint}/signin/init`, {
      body: JSON.stringify(initBody),
      headers: this.authHeaders(),
    })
    if (initRes.status === 401) throw new AuthError('Signin init 失败: 密码错误', 401)

    // scnt/session_id/session_token 由 onAfterResponse 从响应头自动提取并存盘
    const init = initRes.body as any
    console.error('[srp] init body keys:', Object.keys(init))

    const salt = Buffer.from(init.salt, 'base64')
    const B = Buffer.from(init.b, 'base64')
    const c = init.c
    const iterations = init.iteration
    const protocol = init.protocol as 's2k' | 's2k_fo'

    const M1 = user.processChallenge({ password, salt, B, iterations, protocol })
    const completeBody: Record<string, any> = {
      accountName: username,
      c,
      m1: M1.toString('base64'),
      m2: user.m2.toString('base64'),
      rememberMe: true,
      trustTokens: [],
    }
    if (this.sessionData.trust_token) completeBody.trustTokens = [this.sessionData.trust_token]

    const completeRes = await this.session.post(`${this.authEndpoint}/signin/complete`, {
      body: JSON.stringify(completeBody),
      query: { isRememberMeEnabled: 'true' },
      headers: this.authHeaders(),
    })

    // complete 响应头同样由 onAfterResponse 自动提取更新

    if (completeRes.status === 412) {
      await this.session.post(`${this.authEndpoint}/repair/complete`, {
        body: JSON.stringify({}),
        headers: this.authHeaders(),
      })
    } else if (completeRes.status >= 400 && completeRes.status !== 409) {
      console.error('[srp] complete response body:', JSON.stringify(completeRes.body).slice(0, 500))
      throw new ApiError(`Signin complete 失败: ${completeRes.status}`, completeRes.status)
    }

    // 409 时把响应 body（含 dsInfo）存下来给 buildAuthResult 判断
    if (completeRes.status === 409) {
      this.data = (completeRes.body as Record<string, any>) ?? {}
    }

    await this.authenticateWithToken()
  }

  /** POST /setup/ws/1/accountLogin —— 用 session_token 换 iCloud 会话 */
  async authenticateWithToken(): Promise<void> {
    const body = {
      accountCountryCode: this.sessionData.account_country,
      dsWebAuthToken: this.sessionData.session_token,
      extended_login: true,
      trustToken: this.sessionData.trust_token ?? '',
    }
    const res = await this.session.post(`${this.setupEndpoint}/accountLogin`, { body: JSON.stringify(body) })
    if (res.status >= 400) throw new ApiError(`accountLogin 失败: ${res.status}`, res.status)
    this.data = res.body as Record<string, any>
  }

  /** PUT /verify/trusteddevice/securitycode —— 触发 push 到受信设备 */
  async triggerPushNotification(): Promise<boolean> {
    try {
      await this.session.put(`${this.authEndpoint}/verify/trusteddevice/securitycode`, {
        headers: this.authHeaders({ Accept: 'application/json' }),
      })
      return true
    } catch {
      return false
    }
  }

  /** POST /verify/trusteddevice/securitycode —— 提交 6 位验证码 */
  async validate2faCode(code: string): Promise<boolean> {
    const res = await this.session.post(`${this.authEndpoint}/verify/trusteddevice/securitycode`, {
      body: JSON.stringify({ securityCode: { code } }),
      headers: this.authHeaders({ Accept: 'application/json' }),
    })
    if (res.status >= 400) return false
    await this.trustSession()
    await this.authenticateWithToken()
    return true
  }

  /** GET /2sv/trust —— 信任当前会话 */
  async trustSession(): Promise<boolean> {
    try {
      await this.session.get(`${this.authEndpoint}/2sv/trust`, { headers: this.authHeaders() })
      return true
    } catch {
      return false
    }
  }

  /** 懒加载 PhotosService（对应 base.py 的 @property photos） */
  get photos(): PhotosService {
    if (!this._photos) this._photos = new PhotosService(this)
    return this._photos
  }
}
