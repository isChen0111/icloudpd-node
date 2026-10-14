/**
 * 照片下载器 —— 对照 icloudpd/download.py
 *
 * 职责：
 * - 从 downloadUrl 拉文件落盘
 * - 创建目录结构（按拍摄日期 YYYY/MM/DD）
 * - 断点续传（.part 临时文件）
 * - 设置文件修改时间为拍摄时间
 * - 可选：补写 EXIF 拍摄时间（--set-exif-datetime）
 */
import { mkdir, writeFile, utimes, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PhotoAsset } from '../services/photos.js'
import type { PyiCloudSession } from '../client/session.js'
import { ApiError } from '../errors.js'
import * as piexif from 'piexifjs'

export interface DownloadOptions {
  /** 输出根目录 */
  outputDir: string
  /** 文件修改时间是否设为拍摄时间，默认 true */
  setMtime?: boolean
  /**
   * 文件夹结构模板，默认 `{year}/{month}/{day}`
   * 设为 'none' 则不分子目录
   */
  folderStructure?: string
  /** 补写 EXIF 拍摄时间（--set-exif-datetime），默认 false */
  setExifDatetime?: boolean
  /**
   * 下载尺寸，默认 'original'
   * - 'original'：原图
   * - 'medium'：中等尺寸
   * - 'thumb'：缩略图
   */
  size?: 'original' | 'medium' | 'thumb'
  /** 下载进度回调 */
  onProgress?: (loaded: number, total: number) => void
}

/** 按拍摄日期生成子目录路径 */
function buildDatePath(assetDate: number, template: string): string {
  if (template === 'none') return ''
  const d = new Date(assetDate)
  const year = String(d.getFullYear())
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return template
    .replace('{year}', year)
    .replace('{month}', month)
    .replace('{day}', day)
}

/** 格式化 EXIF 时间：YYYY:MM:DD HH:mm:ss */
function formatExifDate(assetDate: number): string {
  const d = new Date(assetDate)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${y}:${m}:${day} ${h}:${min}:${s}`
}

/** 给 JPEG 补写 EXIF 拍摄时间 */
function writeExifDatetime(buffer: Buffer, assetDate: number): Buffer {
  try {
    const b64 = buffer.toString('base64')
    const exifObj = piexif.load(b64)
    const dateStr = formatExifDate(assetDate)
    // 306: DateTime, 36867: DateTimeOriginal, 36868: DateTimeDigitized
    exifObj['Exif'][36867] = dateStr
    exifObj['Exif'][36868] = dateStr
    exifObj['0th'][306] = dateStr
    const exifBytes = piexif.dump(exifObj)
    const newB64 = piexif.insert(exifBytes, b64)
    return Buffer.from(newB64, 'base64') as any
  } catch {
    return buffer  // 写失败就返回原文件
  }
}

/**
 * 下载单张照片到指定路径
 */
export async function downloadPhoto(
  session: PyiCloudSession,
  photo: PhotoAsset,
  options: DownloadOptions,
): Promise<string> {
  const { outputDir, setMtime = true, folderStructure = '{year}/{month}/{day}', setExifDatetime = false, size = 'original', onProgress } = options

  // 根据 size 选下载 URL
  let url: string | null
  switch (size) {
    case 'medium':
      url = photo.mediumUrl
      break
    case 'thumb':
      url = photo.thumbUrl
      break
    default:
      url = photo.downloadUrl
  }

  if (!url) {
    throw new ApiError(`照片 ${photo.id} 没有 ${size} 尺寸的下载 URL`, 400)
  }

  // 生成输出路径
  const filename = photo.filename ?? `${photo.id}.jpg`
  const datePath = buildDatePath(photo.assetDate, folderStructure)
  const outputPath = datePath ? join(outputDir, datePath, filename) : join(outputDir, filename)

  // 创建目录
  const dir = dirname(outputPath)
  await mkdir(dir, { recursive: true })

  // 临时文件（断点续传）—— id 可能含 /，替换掉
  const safeId = photo.id.replace(/[^a-zA-Z0-9]/g, '_')
  const tempPath = join(dir, `${safeId}.part`)

  try {
    // 下载文件
    const res = await fetch(url)
    if (!res.ok) {
      throw new ApiError(`下载失败: HTTP ${res.status}`, res.status)
    }

    // 读取内容（支持进度回调）
    const total = Number(res.headers.get('content-length') ?? 0)
    let buffer: Buffer
    if (onProgress && res.body) {
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        onProgress(loaded, total)
      }
      buffer = Buffer.concat(chunks)
    } else {
      buffer = Buffer.from(await res.arrayBuffer())
    }

    // 补写 EXIF 时间（仅 JPEG）
    if (setExifDatetime && /\.jpe?g$/i.test(filename)) {
      buffer = writeExifDatetime(buffer, photo.assetDate)
    }

    await writeFile(tempPath, buffer)

    // 重命名为正式文件
    await rename(tempPath, outputPath)

    // 设置修改时间
    if (setMtime && photo.assetDate) {
      const mtime = new Date(photo.assetDate)
      await utimes(outputPath, mtime, mtime)
    }

    return outputPath
  } catch (e) {
    throw e
  }
}
