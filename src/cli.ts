#!/usr/bin/env node
/**
 * icloudpd-node CLI
 *
 * 用法：
 *   node dist/cli.js --username you@example.com --domain cn
 *   node dist/cli.js --username you@example.com --download ./photos
 *   node dist/cli.js --username you@example.com --download ./photos --until-found 20
 *
 * session 默认存在 ~/.config/icloudpd-node/（Windows: %APPDATA%\icloudpd-node\）
 */
import readline from 'node:readline'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { PyiCloudService, downloadPhoto, type Domain } from './index.js'

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())))
}

function defaultCookieDir(): string {
  const home = os.homedir()
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'icloudpd-node')
  }
  return path.join(home, '.config', 'icloudpd-node')
}

async function main() {
  const args = process.argv.slice(2)
  const get = (k: string): string | boolean | undefined => {
    const i = args.indexOf(`--${k}`)
    if (i < 0) return undefined
    // 如果下一个参数也是 -- 开头的，说明这是 flag，没值
    const next = args[i + 1]
    if (!next || next.startsWith('--')) return true
    return next
  }
  const getString = (k: string): string | undefined => {
    const v = get(k)
    return typeof v === 'string' ? v : undefined
  }
  const username = getString('username')
  const domain = (getString('domain') as Domain) || 'cn'
  const downloadDir = getString('download')
  const untilFound = Number(getString('until-found') ?? 20)
  const folderStructure = getString('folder-structure') ?? '{year}/{month}/{day}'
  const setExifDatetime = !!get('set-exif-datetime')
  const recent = Number(getString('recent') ?? 0)
  const skipVideos = !!get('skip-videos')
  const listAlbums = !!get('list-albums')
  const listLibraries = !!get('list-libraries')
  const dryRun = !!get('dry-run')
  const album = getString('album')
  const size = getString('size') ?? 'original'

  if (!username) {
    console.error('Usage: cli.js --username you@example.com [--domain cn|com] [--download ./photos]')
    process.exit(1)
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const cookieDir = defaultCookieDir()

  // 登录
  let svc = new PyiCloudService(domain, username, () => process.env.ICLOUDPD_PASSWORD ?? null, cookieDir)
  let result: Awaited<ReturnType<PyiCloudService['authenticate']>>
  try {
    console.log('[auth] Trying existing session...')
    result = await svc.authenticate()
    console.log('[auth] Session reused.')
  } catch {
    console.log('[auth] Session expired, need password.')
    const password = process.env.ICLOUDPD_PASSWORD ?? (await ask(rl, 'Password: '))
    svc = new PyiCloudService(domain, username, () => password, cookieDir)
    result = await svc.authenticate()
  }
  console.log('[auth] Requires 2FA:', result.requires2fa)

  if (result.requires2fa) {
    console.log('[2fa] Triggering push...')
    await svc.triggerPushNotification()
    const code = process.env.ICLOUDPD_2FA_CODE ?? (await ask(rl, 'Enter 6-digit code: '))
    const verified = await svc.validate2faCode(code)
    console.log('[2fa] Verified:', verified)
    if (!verified) process.exit(2)
  }

  console.log('[done] Authenticated. dsid:', (svc.data as any)?.dsInfo?.dsid)

  // 列图库
  if (listLibraries) {
    const libs = await svc.photos.listLibraries()
    console.log('[libraries]')
    for (const l of libs) console.log(' -', l.zoneName)
    rl.close()
    return
  }

  // 列相册
  if (listAlbums) {
    const albums = await svc.photos.listAlbums()
    console.log('[albums]')
    for (const a of albums) console.log(` - ${a.name} (${a.id})`)
    rl.close()
    return
  }

  // 下载
  if (downloadDir) {
    console.log(`[download] Target: ${downloadDir}`)
    console.log(`[download] Folder structure: ${folderStructure}`)

    const exists = (filename: string | null) => {
      if (!filename) return false
      return existsSync(path.join(downloadDir, filename))
    }

    const photos = await svc.photos.listPhotosIncremental(exists, untilFound, 500)
    console.log(`[download] New photos: ${photos.length}`)

    // 过滤：跳过视频 / 只取最近 N 张 / 指定相册
    let filtered = photos
    if (skipVideos) {
      filtered = filtered.filter((p) => !p.isVideo)
      console.log(`[download] Skip videos: ${photos.length - filtered.length}`)
    }
    if (recent > 0) {
      filtered = filtered.slice(0, recent)
      console.log(`[download] Recent ${recent}: ${filtered.length}`)
    }

    if (dryRun) {
      console.log(`[dry-run] Would download ${filtered.length} photos:`)
      for (const p of filtered) {
        console.log(`  - ${p.filename}`)
      }
      rl.close()
      return
    }

    let done = 0
    for (const p of filtered) {
      try {
        const out = await downloadPhoto(svc.session, p, {
          outputDir: downloadDir,
          folderStructure,
          setExifDatetime,
        })
        done++
        console.log(`[download] (${done}/${photos.length}) ${path.basename(out)}`)
      } catch (e: any) {
        console.error(`[download] Failed: ${p.filename} - ${e.message}`)
      }
    }

    console.log(`[download] Done. Downloaded ${done} photos.`)
  }

  rl.close()
}

main().catch((e) => {
  console.error('[fatal]', e)
  process.exit(1)
})
