# icloudpd-node

[icloud_photos_downloader](https://github.com/icloud-photos-downloader/icloud_photos_downloader)（MIT）的 Node.js / TypeScript 移植版。

以官方网页客户端相同的方式登录 iCloud 照片，把照片和视频下载到本地，支持 Live Photo、增量同步和 cookie 会话复用。

## 当前状态

**开发中 — P0/P1/P2/P3 已完成，CLI 封装暂停。** 按模块逐步翻译 Python 源码。Apple 改 iCloud 接口时，跟随上游同步，不自己逆向。

| 阶段 | 范围 | 状态 |
|---|---|---|
| P0 | 登录认证：密码 → 2FA → cookie/session 持久化 | ✅ 完成 |
| P1 | 列相册 / 图库、照片分页列表 | ✅ 完成 |
| P2 | 下载照片/视频 + 文件夹结构 + 增量同步 + EXIF | ✅ 完成 |
| P3 | Apple API 接口补全 + SDK 优化 | ✅ 完成 |
| P4 | CLI 完整参数封装 | ⏳ 暂停 |

## 作为库使用

```ts
import { PyiCloudService } from 'icloudpd-node'

const svc = new PyiCloudService(
  'cn',                                    // 'com' 国际区 / 'cn' 中国区
  'your@email.com',
  () => process.env.APPLE_ID_PASSWORD,     // 密码提供者
)

await svc.authenticate()                   // 首次登录会触发 2FA push

const albums = await svc.photos.listAlbums()
const total  = await svc.photos.countAll()
const photos = await svc.photos.listPhotos(0, 100)
```

完整 API 见 [docs/API.md](./docs/API.md)。

## 本地开发

```bash
npm install
npm run build

# 首次登录
node dist/cli.js --username 你的邮箱 --domain cn

# 后续运行自动复用 cookie
node dist/cli.js --username 你的邮箱 --domain cn
```

密码通过 `--password` 参数或 `ICLOUDPD_PASSWORD` 环境变量传入；2FA 验证码运行时交互输入。

## 来源说明

基于 [icloud-photos-downloader/icloud_photos_downloader](https://github.com/icloud-photos-downloader/icloud_photos_downloader) 翻译，MIT 协议。iCloud 协议理解归功于上游维护者。

开发文档：
- [docs/API.md](./docs/API.md) — 开发者 API 参考
- [docs/HANDOVER.md](./docs/HANDOVER.md) — 交接文档
- [docs/UPSTREAM.md](./docs/UPSTREAM.md) — 上游同步记录
- [docs/CLI_PARAMS.md](./docs/CLI_PARAMS.md) — CLI 参数对照表
- [docs/APPLE_API.md](./docs/APPLE_API.md) — Apple API 接口清单

## 许可证

MIT — 见 [LICENSE](./LICENSE)。
