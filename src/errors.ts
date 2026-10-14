/**
 * 错误类定义
 *
 * 比上游 icloudpd 更规范：统一基类、区分错误类型、标记是否可重试
 */

export class ICloudError extends Error {
  statusCode?: number
  retryable: boolean

  constructor(
    message: string,
    opts: { statusCode?: number; retryable?: boolean } = {},
  ) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = opts.statusCode
    this.retryable = opts.retryable ?? false
  }
}

/** 认证失败：密码错误、session 过期 */
export class AuthError extends ICloudError {
  constructor(message: string, statusCode?: number) {
    super(message, { statusCode, retryable: false })
  }
}

/** 网络错误：连接失败、超时 */
export class NetworkError extends ICloudError {
  constructor(message: string, cause?: unknown) {
    super(message, { retryable: true })
    if (cause) (this as any).cause = cause
  }
}

/** iCloud 正在索引，等几分钟重试 */
export class IndexingError extends ICloudError {
  constructor(state: string) {
    super(`iCloud Photo Library 正在索引 (state=${state})，请等几分钟后重试`, {
      retryable: false,
    })
  }
}

/** Apple API 返回错误（5xx 等） */
export class ApiError extends ICloudError {
  constructor(message: string, statusCode: number) {
    super(message, { statusCode, retryable: statusCode >= 500 })
  }
}
