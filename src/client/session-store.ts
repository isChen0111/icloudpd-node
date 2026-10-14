/**
 * SessionStore —— 对应 pyicloud_ipd/base.py 的 session/cookiejar 持久化
 *
 * 文件布局（和上游一致）：
 *   <cookieDir>/<appleId 去掉非 \w 字符>.session   —— session_data JSON
 *   <cookieDir>/<appleId 去掉非 \w 字符>           —— cookies JSON（Node 版用 JSON，不是 LWP 格式）
 *
 * 上游每次 HTTP 响应后都把 HEADER_DATA 字段更新到 session_data 并落盘，
 * cookies 同步保存。Node 版一比一复刻。
 */
import fs from 'node:fs'
import path from 'node:path'

export type SessionData = Record<string, string>

export class SessionStore {
  readonly sessionPath: string
  readonly cookiesPath: string

  constructor(
    cookieDir: string,
    appleId: string,
  ) {
    fs.mkdirSync(cookieDir, { recursive: true, mode: 0o700 })
    const safeName = appleId.replace(/[^\w]/g, '')
    this.sessionPath = path.join(cookieDir, `${safeName}.session`)
    this.cookiesPath = path.join(cookieDir, safeName)
  }

  loadSessionData(): SessionData {
    try {
      const raw = fs.readFileSync(this.sessionPath, 'utf-8')
      return JSON.parse(raw) as SessionData
    } catch {
      return {}
    }
  }

  loadCookies(): Map<string, string> {
    try {
      const raw = fs.readFileSync(this.cookiesPath, 'utf-8')
      const obj = JSON.parse(raw) as Record<string, string>
      return new Map(Object.entries(obj))
    } catch {
      return new Map()
    }
  }

  saveSessionData(data: SessionData): void {
    fs.writeFileSync(this.sessionPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  saveCookies(cookies: Map<string, string>): void {
    const obj: Record<string, string> = {}
    for (const [k, v] of cookies.entries()) obj[k] = v
    fs.writeFileSync(this.cookiesPath, JSON.stringify(obj, null, 2), 'utf-8')
  }
}

/**
 * 对应 pyicloud_ipd/session.py 的 HEADER_DATA：
 * 每次响应后从这些响应头提取字段写入 session_data。
 * fetch Headers 会把名字规范化为小写。
 */
export const HEADER_DATA: Record<string, string> = {
  'x-apple-id-account-country': 'account_country',
  'x-apple-id-session-id': 'session_id',
  'x-apple-session-token': 'session_token',
  'x-apple-twosv-trust-token': 'trust_token',
  'x-apple-twosv-trust-eligible': 'trust_eligible',
  'x-apple-i-rscd': 'apple_rscd',
  'x-apple-i-ercd': 'apple_ercd',
  scnt: 'scnt',
}
