/**
 * SRP-6a 纯 JS 实现 —— 对照 Python `srp` 库（mozilla-iam/srp）
 *
 * 组参数：RFC 5054 Appendix A.3，2048-bit Group，g = 2
 * 用法对齐 icloudpd 的 SrpPassword：
 *   - hash_alg = SHA256
 *   - rfc5054_enable()
 *   - no_username_in_x()
 *   - 密码经 Apple 定制 PBKDF2 预处理（s2k / s2k_fo）
 */
import crypto from 'node:crypto'

// RFC 5054 Appendix A.3 —— 2048-bit group
const N_HEX =
  'AC6BDB41324A9A9BF166DE5E1389582FAF72B6651987EE07FC319294' +
  '3DB56050A37329CBB4A099ED8193E0757767A13DD52312AB4B03310D' +
  'CD7F48A9DA04FD50E8083969EDB767B0CF6095179A163AB3661A05FB' +
  'D5FAAAE82918A9962F0B93B855F97993EC975EEAA80D740ADBF4FF74' +
  '7359D041D5C33EA71D281E446B14773BCA97B43A23FB801676BD207A' +
  '436C6481F1D2B9078717461A5B9D32E688F87748544523B524B0D57D' +
  '5EA77A2775D2ECFA032CFBDBF52FB3786160279004E57AE6AF874E73' +
  '03CE53299CCC041C7BC308D82A5698F3A8D0C38271AE35F8E9DBFBB6' +
  '94B5C803D89F7AE435DE236D525F54759B65E372FCD68EF20FA7111F' +
  '9E4AFF73'

export const N = BigInt('0x' + N_HEX)
export const g = 2n

const sha256 = (buf: Buffer | string): Buffer =>
  crypto.createHash('sha256').update(buf).digest()

/** 整数转定长大端字节（N 长度 = 256 字节） */
function i2osp(i: bigint, len = 256): Buffer {
  const hex = i.toString(16).padStart(len * 2, '0')
  return Buffer.from(hex, 'hex')
}

/** 字节转大整数 */
function os2ip(buf: Buffer): bigint {
  return BigInt('0x' + buf.toString('hex').replace(/^0+/, '') || '0')
}

/** 把任意长度的大整数字节串左 padding 到 256 字节（RFC 5054） */
function padToN(buf: Buffer, len = 256): Buffer {
  if (buf.length === len) return buf
  if (buf.length > len) return buf.subarray(buf.length - len)
  return Buffer.concat([Buffer.alloc(len - buf.length), buf])
}

/**
 * Apple 定制密码预处理（对应 SrpPassword.encode）
 * - s2k_fo: password_digest = hex(SHA256(password)) 作为字符串
 * - 其他:  password_digest = binary(SHA256(password))
 * - 再 PBKDF2-HMAC-SHA256(digest, salt, iterations, 32)
 */
function applePasswordDigest(
  password: string,
  protocol: 's2k' | 's2k_fo',
  salt: Buffer,
  iterations: number,
): Buffer {
  const h = sha256(password)
  const digestInput =
    protocol === 's2k_fo' ? Buffer.from(h.toString('hex'), 'utf8') : h
  return crypto.pbkdf2Sync(digestInput, salt, iterations, 32, 'sha256')
}

export class SrpUser {
  private a: bigint
  private A: bigint
  private xKey: Buffer | null = null
  private K: Buffer | null = null
  private M1: Buffer | null = null
  private M2: Buffer | null = null

  constructor(public readonly username: string) {
    // 256-bit 私钥 a
    this.a = BigInt('0x' + crypto.randomBytes(32).toString('hex'))
    this.A = modPow(g, this.a, N)
  }

  /** start_authentication() → [uname, A]（base64 编码后发送） */
  start(): { username: string; A: Buffer } {
    return { username: this.username, A: i2osp(this.A) }
  }

  /**
   * process_challenge(salt, B, c, iterations, protocol)
   * 返回 M1
   */
  processChallenge(opts: {
    password: string
    salt: Buffer
    B: Buffer
    iterations: number
    protocol: 's2k' | 's2k_fo'
  }): Buffer {
    const { password, salt, iterations, protocol } = opts
    // RFC 5054：所有大整数 hash 前 padding 到 N 的字节长度（256）
    const B = padToN(opts.B)
    const Bn = os2ip(B)
    if (Bn % N === 0n) throw new Error('SRP: B mod N == 0, abort')

    // x = H(salt, H(username + ':' + password_digest))
    // no_username_in_x() → username = b''，所以 inner = SHA256(b':' + pbkdf2)
    this.xKey = applePasswordDigest(password, protocol, salt, iterations)
    const inner = sha256(Buffer.concat([Buffer.from(':', 'utf8'), this.xKey]))
    const x = os2ip(sha256(Buffer.concat([salt, inner])))

    // k = H(N, g)
    const k = os2ip(sha256(Buffer.concat([i2osp(N), i2osp(g)])))

    // u = H(A, B)
    const u = os2ip(sha256(Buffer.concat([i2osp(this.A), B])))

    // S = (B - k * g^x) ^ (a + u*x) mod N
    const gx = modPow(g, x, N)
    const kgx = (k * gx) % N
    let base = (Bn - kgx) % N
    if (base < 0n) base += N
    const exp = (this.a + u * x) % N
    const S = modPow(base, exp, N)

    this.K = sha256(i2osp(S))

    // M1 = H( H(N) xor H(g), H(I), salt, A, B, K )
    const hN = sha256(i2osp(N))
    const hg = sha256(i2osp(g))
    const xor = Buffer.alloc(32)
    for (let i = 0; i < 32; i++) xor[i] = hN[i] ^ hg[i]
    const hI = sha256(this.username)
    this.M1 = sha256(
      Buffer.concat([xor, hI, salt, i2osp(this.A), B, this.K]),
    )

    // M2 = H(A, M1, K)
    this.M2 = sha256(Buffer.concat([i2osp(this.A), this.M1, this.K]))
    return this.M1
  }

  get m2(): Buffer {
    if (!this.M2) throw new Error('processChallenge not called')
    return this.M2
  }
}

/** 模幂：base^exp mod m（BigInt 下 Node 原生 BigInt 不支持 modPow，自己实现） */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n
  let b = ((base % m) + m) % m
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m
    e >>= 1n
    b = (b * b) % m
  }
  return result
}
