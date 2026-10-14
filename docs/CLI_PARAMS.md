# CLI 参数对照表

对照上游 [icloudpd](https://github.com/icloud-photos-downloader/icloud_photos_downloader) CLI 参数，整理本项目已实现/待实现/不做。

---

## 认证相关

| 参数 | 说明 | 状态 |
|---|---|---|
| `--username` / `-u` | Apple ID 邮箱 | ✅ 已做 |
| `--password` / `-p` | 密码 | ✅ 已做（环境变量） |
| `--domain` | iCloud 区域：com / cn | ✅ 已做 |
| `--cookie-directory` | cookie 存储目录 | ✅ 自动管理 |
| `--auth-only` | 只登录不下载 | ❌ 待做 |

## 下载相关

| 参数 | 说明 | 状态 |
|---|---|---|
| `--directory` / `-d` | 本地下载目录 | ✅ 已做（`--download`） |
| `--size` | 图片尺寸：original / medium / thumb / adjusted / alternative | ❌ 待做 |
| `--live-photo-size` | Live Photo 视频尺寸：original / medium / thumb | ❌ 待做 |
| `--recent` | 只下载最近 N 张 | ✅ 已做 |
| `--until-found` | 增量同步（遇到 N 张已下载就停） | ✅ 已做 |
| `--album` / `-a` | 指定相册下载（可多个） | ❌ 待做 |
| `--library` | 指定图库（默认 PrimarySync） | ❌ 待做 |
| `--skip-videos` | 跳过视频 | ✅ 已做 |
| `--skip-photos` | 跳过照片 | ❌ 待做 |
| `--skip-live-photos` | 跳过 Live Photo | ❌ 待做 |
| `--folder-structure` | 目录结构模板 | ✅ 已做 |
| `--set-exif-datetime` | 补写 EXIF 拍摄时间 | ✅ 已做 |
| `--file-match-policy` | 文件匹配去重策略 | ❌ 待做 |
| `--skip-created-before` | 跳过指定日期前的素材 | ❌ 待做 |
| `--skip-created-after` | 跳过指定日期后的素材 | ❌ 待做 |

## 列表相关

| 参数 | 说明 | 状态 |
|---|---|---|
| `--list-albums` | 列出所有相册 | ✅ 已做 |
| `--list-libraries` | 列出所有图库 | ✅ 已做 |
| `--only-print-filenames` | 只打印文件名不下载 | ✅ 已做（`--dry-run`） |

## 其他

| 参数 | 说明 | 状态 |
|---|---|---|
| `--dry-run` | 试运行，不实际写盘 | ✅ 已做 |
| `--xmp-sidecar` | 导出 XMP 副文件 | ❌ 待做 |
| `--keep-unicode-in-filenames` | 保留文件名 Unicode 字符 | ❌ 待做 |
| `--live-photo-mov-filename-policy` | Live Photo MOV 文件名策略 | ❌ 待做 |
| `--align-raw` | RAW + JPEG 对齐策略 | ❌ 待做 |
| `--watch-with-interval` | 循环定时下载（秒） | ❌ 待做 |
| `--log-level` | 日志级别：debug / info / error | ❌ 待做 |
| `--no-progress-bar` | 禁用进度条 | ❌ 待做 |
| `--password-provider` | 密码提供者：console / keyring / parameter | ❌ 待做 |
| `--mfa-provider` | 验证码提供者：console / webui | ❌ 待做 |

## 删除相关（SDK 提供，业务方自行决定）

| 参数 | 说明 | 状态 |
|---|---|---|
| `--auto-delete` | 扫描"最近删除"文件夹，删除本地对应文件 | ❌ 待做 |
| `--delete-after-download` | 下载后从 iCloud 删除照片 | ❌ 待做 |
| `--keep-icloud-recent-days` | 只保留最近 N 天，删除更早的 | ❌ 待做 |
| `--threads-num` | 多线程（上游已废弃） | 🚫 不做 |

## 通知相关

| 参数 | 说明 | 状态 |
|---|---|---|
| `--smtp-username` | SMTP 用户名（2FA 过期通知） | ❌ 待做 |
| `--smtp-password` | SMTP 密码 | ❌ 待做 |
| `--smtp-host` | SMTP 服务器 | ❌ 待做 |
| `--smtp-port` | SMTP 端口 | ❌ 待做 |
| `--smtp-no-tls` | 禁用 TLS | ❌ 待做 |
| `--notification-email` | 通知邮箱 | ❌ 待做 |
| `--notification-email-from` | 发件人邮箱 | ❌ 待做 |
| `--notification-script` | 外部通知脚本 | ❌ 待做 |

---

## 统计

- ✅ 已做：12 个
- ❌ 待做：29 个
- 🚫 上游废弃不做：1 个
