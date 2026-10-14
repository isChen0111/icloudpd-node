# 上游同步记录

本项目是 [icloud_photos_downloader](https://github.com/icloud-photos-downloader/icloud_photos_downloader)（MIT）的 Node/TypeScript 移植版。
我们**不直接对接 Apple API**，所有协议变更都跟随上游 Python 源码。

## 当前同步基线

- **上游仓库**：https://github.com/icloud-photos-downloader/icloud_photos_downloader
- **当前对齐版本**：master 分支
- **对齐 commit**：见下表"最近同步"
- **同步日期**：2026-10-13

## 同步规则

1. 上游发新版（每周五）→ 我们 diff 它的 `src/pyicloud_ipd/` 和 `src/icloudpd/`
2. **必须同步**：Apple 协议相关（URL、headers、cookie 字段、2FA 流程、接口参数）
3. **按需借鉴**：自己实现的功能（增量同步、目录结构、EXIF 写入等），看需要做
4. UI/日志/无关功能不同步
5. 每次同步更新本表"最近同步"

## 模块对照表

| 本项目文件                      | 上游 Python 文件                             | 状态                            |
| ------------------------------- | -------------------------------------------- | ------------------------------- |
| `src/client/session.ts`       | `pyicloud_ipd/session.py`                  | ✅ P0 完成（+超时+自动重试）    |
| `src/client/session-store.ts` | `pyicloud_ipd/session.py`（cookie 持久化） | ✅ P0 完成                      |
| `src/client/service.ts`       | `pyicloud_ipd/base.py`                     | ✅ P0 认证 + P1 photos getter   |
| `src/auth/srp.ts`             | `pyicloud_ipd/base.py::_authenticate_srp`  | ✅ P0 完成                      |
| `src/services/photos.ts`      | `pyicloud_ipd/services/photos.py`          | ✅ P1 列表 + P2 增量同步        |
| `src/errors.ts`               | —（上游无，我们做更好）                      | ✅ 错误类定义                   |
| `src/download/runner.ts`      | `icloudpd/download.py`                     | ✅ P2 下载器                    |
| `src/cli.ts`                  | `icloudpd/cli.py`                          | 🚧 基础认证 CLI 完成            |

## 最近同步

| 日期       | 上游 commit/tag    | 同步内容          | 本项目 commit |
| ---------- | ------------------ | ----------------- | ------------- |
| 2026-10-13 | master（初始移植） | 骨架 + session 层 | —            |
| 2026-10-14 | master            | P0 认证 + P1 列表 + P2 下载 + P3 Apple API | — |
