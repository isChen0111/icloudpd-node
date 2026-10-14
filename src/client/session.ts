/**
 * HTTP Session 层 —— 对应 pyicloud_ipd/session.py
 *
 * 职责：
 * - 持有 fetch + 手动 CookieJar（Map<name, value>）
 * - 统一默认 headers（Origin/Referer/User-Agent）
 * - 超时控制（默认 30s）
 * - 自动重试（网络错误、5xx 重试 3 次，指数退避）
 *
 * 不依赖 undici 的 cookie jar（API 版本漂移），自己解析 Set-Cookie。
 */
import { NetworkError, ApiError } from '../errors.js'

export interface SessionEndpoints {
  authRoot: string
  authEndpoint: string
  homeEndpoint: string
  setupEndpoint: string
}

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'

const DEFAULT_TIMEOUT = 30000
const MAX_RETRIES = 3

export interface SessionOptions {
  /** 请求超时（毫秒），默认 30000 */
  timeout?: number
  /** 网络错误重试次数，默认 3 */
  maxRetries?: number
}

export class PyiCloudSession {
  /** cookie 存储：name → value */
  readonly cookies = new Map<string, string>()
  defaultHeaders: Record<string, string>
  /** 每次 HTTP 响应后回调（headers 已规范化为小写），service 用它提取 HEADER_DATA */
  onAfterResponse?: (headers: Headers) => void
  private timeout: number
  private maxRetries: number

  constructor(public readonly endpoints: SessionEndpoints, options?: SessionOptions) {
    this.defaultHeaders = {
      'User-Agent': DEFAULT_UA,
      Accept: 'application/json, text/javascript',
      Origin: endpoints.homeEndpoint,
      Referer: `${endpoints.homeEndpoint}/`,
    }
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT
    this.maxRetries = options?.maxRetries ?? MAX_RETRIES
  }

  /** 从响应头解析 Set-Cookie，合并到 jar */
  private absorbCookies(res: Response): void {
    const setCookies = res.headers.getSetCookie?.() ?? []
    for (const sc of setCookies) {
      const first = sc.split(';')[0]
      const eq = first.indexOf('=')
      if (eq < 0) continue
      const name = first.slice(0, eq).trim()
      const value = first.slice(eq + 1).trim()
      if (value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  private async doFetch<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    opts: {
      body?: unknown
      headers?: Record<string, string>
      query?: Record<string, string>
    } = {},
  ): Promise<{ status: number; headers: Headers; body: T }> {
    const u = new URL(url)
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) u.searchParams.set(k, v)
    }
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(opts.headers ?? {}),
    }
    const cookie = this.cookieHeader()
    if (cookie) headers['Cookie'] = cookie

    let body: BodyInit | undefined
    if (opts.body !== undefined) {
      if (typeof opts.body === 'string') {
        body = opts.body
      } else {
        body = JSON.stringify(opts.body)
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
      }
    }

    // 超时控制
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const res = await fetch(u.toString(), { method, headers, body, signal: controller.signal })
      this.absorbCookies(res)
      this.onAfterResponse?.(res.headers)
      const text = await res.text()
      let parsed: T
      try {
        parsed = text ? (JSON.parse(text) as T) : (undefined as T)
      } catch {
        parsed = text as unknown as T
      }
      return { status: res.status, headers: res.headers, body: parsed }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new NetworkError(`请求超时（${this.timeout / 1000}s）`)
      }
      throw new NetworkError(`网络请求失败: ${e.message}`, e)
    } finally {
      clearTimeout(timer)
    }
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    opts: Parameters<PyiCloudSession['doFetch']>[2] = {},
  ): Promise<{ status: number; headers: Headers; body: T }> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.doFetch<T>(method, url, opts)

        // 5xx 自动重试
        if (res.status >= 500 && attempt < this.maxRetries) {
          console.error(`[retry] ${method} ${url} ${res.status}, attempt ${attempt + 1}/${this.maxRetries}`)
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
          continue
        }

        return res
      } catch (e: any) {
        lastError = e

        // 网络错误自动重试
        if (e instanceof NetworkError && attempt < this.maxRetries) {
          console.error(`[retry] ${method} ${url} network error, attempt ${attempt + 1}/${this.maxRetries}`)
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
          continue
        }

        throw e
      }
    }

    throw lastError ?? new Error('Unknown error')
  }

  get<T = unknown>(url: string, opts: Parameters<PyiCloudSession['request']>[2] = {}) {
    return this.request<T>('GET', url, opts)
  }
  post<T = unknown>(url: string, opts: Parameters<PyiCloudSession['request']>[2] = {}) {
    return this.request<T>('POST', url, opts)
  }
  put<T = unknown>(url: string, opts: Parameters<PyiCloudSession['request']>[2] = {}) {
    return this.request<T>('PUT', url, opts)
  }
}
