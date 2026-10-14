# icloudpd-node 项目交接文档

> 本文档供新接手的 agent / 开发者快速了解项目背景、当前进度、技术决策与约定。
> 最后更新：2026-10-14

---

## 一、项目背景

用户在做一个本地 iCloud 照片浏览器（Vue3 + Node.js/Fastify + SQLite + sharp），位于 `F:\iPhone\icloud-app`。
原项目通过调用开源 `icloudpd` exe 命令行工具下载照片，但官方 exe 是黑盒：
- 认证流程不可控（每次要命令行交互输密码/验证码）
- 没有 Node SDK，只能 spawn 子进程
- 无法嵌入网页端做"一键链接 iCloud"

用户发现官方 npm 包 `icloudpd` 只是 launcher（按平台拉预编译二进制，5.3KB），**不是 Node SDK**。
于是决定：**把开源 icloud_photos_downloader（Python，MIT）一比一翻译成 TypeScript/Node**。

**核心原则**：不自己逆向 Apple API，所有协议变更跟随上游 Python 源码同步。Apple 改了接口，我们看上游怎么改，照着改。

**复刻边界**：
- **必须一比一对标**：SRP 登录流程、2FA 验证、Cookie/session 持久化、列相册/分页接口参数、下载 URL 获取方式（Apple 协议不能错）
- **按需借鉴**：`--until-found` 增量逻辑、`--folder-structure` 目录拼接、`--set-exif-datetime` 写 EXIF、各种过滤排序参数（自己实现的功能，看需要做）

---

## 二、项目目标

- 包名：`icloudpd-node`（未来发布到 npm）
- 语言：TypeScript（ESM, NodeNext, strict）
- 零原生依赖（不依赖 node-gyp / C++ 扩展）
- 以 Node API 形式暴露，供 `icloud-app` 项目直接 `import` 调用

### 核心原则

**一比一复刻的是 Apple API 接口的实现，不是 CLI 命令。**

所有功能都是基于这些 Apple 接口衍生出来的：
- 列相册、列照片 → `records/query`
- 下载照片 → 下载 URL
- 删除照片 → `records/modify`
- 登录认证 → SRP + 2FA 流程

CLI 参数（--until-found、--folder-structure、--recent 等）都是在这些接口之上自己实现的业务逻辑，按需借鉴。

Apple 改了接口，我们看上游怎么改，照着改。

### 阶段规划

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 认证流程（SRP + 2FA + session 持久化） | ✅ 完成 |
| P1 | 列相册/列库、照片列表分页 | ✅ 完成 |
| P2 | 下载照片 + 文件夹结构 + 增量同步 + EXIF | ✅ 完成 |
| P3 | Apple API 接口补全 + SDK 优化 | ✅ 完成 |
| P4 | CLI 完整参数封装 | ⏳ 暂停 |

---

## 三、当前进度

### P0 认证（已完成）
```
首次：输密码 → SRP → 409 → accountLogin → push → 手机确认 → 输验证码
     → trustSession → 二次 accountLogin → 成功
二次：validate → 200，免密
```

### P1 列表（已完成）
实测账号 `ischen0111@foxmail.com`（domain=cn）：
- 列库：`PrimarySync`
- 列相册：21 个（QQ、微信、抖音、DJI Album 等）
- 总数：12470 张
- 分页拉取最近照片：文件名/尺寸/日期正确

---

## 四、目录结构

```
F:\iPhone\icloudpd-node\
├── package.json
├── tsconfig.json
├── LICENSE
├── README.md
├── docs\
│   ├── API.md                # 开发者 API 参考（含错误处理）
│   ├── HANDOVER.md            # 本文档
│   ├── UPSTREAM.md            # 上游同步记录、模块对照表
│   ├── CLI_PARAMS.md          # CLI 参数对照表
│   └── APPLE_API.md           # Apple API 接口清单
└── src\
    ├── index.ts               # 公开 API 导出
    ├── cli.ts                 # 命令行入口
    ├── errors.ts              # 错误类（ICloudError/AuthError/NetworkError/IndexingError/ApiError）
    ├── auth\
    │   └── srp.ts             # SRP-6a 纯 JS 实现
    ├── client\
    │   ├── session.ts         # HTTP 层（fetch + 手动 cookie Map + 超时 + 自动重试）
    │   ├── session-store.ts   # session/cookie 文件读写
    │   └── service.ts         # PyiCloudService 认证主流程
    ├── services\
    │   └── photos.ts          # PhotosService（列库/列相册/计数/分页/增量/删除/最近删除）
    ├── download\
    │   └── runner.ts          # 下载器（落盘 + EXIF 写入 + 目录结构 + 进度回调）
    └── types\
        └── piexifjs.d.ts      # piexifjs 类型声明
```

---

## 五、关键技术决策

### 1. 不用 npm `srp` 包，自己实现 SRP-6a
- npm `srp` 依赖 `bignum`（C++ 原生模块），本机 node-gyp 编译失败
- 改用 Node 内置 `crypto` + `BigInt` 纯 JS 实现，零原生依赖
- 对照 Python srp 库 `F:\iPhone\_srp_py\srp\_pysrp.py` 逐行验证

### 2. 手动管理 cookie，不用 undici CookieAgent
- undici CookieJar API 版本漂移
- 自己用 `Map<name, value>`，从 `Set-Cookie` 响应头手动解析

### 3. SRP 登录 409 后必须继续调 accountLogin
- 上游在 SRP 返回 409（需 2FA）后，仍然继续调 `_authenticate_with_token()`
- 之前误以为 409 就要停下来等验证码，导致 cookie 全部丢失
- 正确：409 → 仍调 accountLogin → 返回部分 cookie → push → 输验证码 → trustSession → 二次 accountLogin

### 4. Session 持久化：标准 SDK 做法
- **默认纯内存**，不写盘
- 传 `cookieDir` 参数才自动 load/save 文件
- 提供 `exportSession()` / `importSession()` 方法，调用方自己决定存哪（数据库/文件/内存）
- CLI 默认存 `~/.config/icloudpd-node/`（Windows: `%APPDATA%\icloudpd-node\`）

### 5. iCloud 索引状态检查
- `CheckIndexingState` 返回 `RUNNING` 时说明 iCloud 正在索引
- 上游逻辑：抛异常，外层等 60 秒重试
- 我们：`checkIndexingState()` 单独方法，由调用方决定是否重试

### 6. 错误处理规范
- 错误类：`ICloudError` 基类 + `AuthError`/`NetworkError`/`IndexingError`/`ApiError`
- 每个错误带 `retryable` 字段标记是否可重试
- HTTP 超时：默认 30 秒
- 自动重试：网络错误、5xx 重试 3 次，指数退避（1s→2s→4s）
- 认证错误、索引错误不自动重试

---

## 六、上游源码位置

用户本地已下载：`F:\iPhone\icloud_photos_downloader-master`

关键文件：
- `src/pyicloud_ipd/base.py` —— 认证主流程
- `src/pyicloud_ipd/session.py` —— HTTP session + cookie
- `src/pyicloud_ipd/services/photos.py` —— 照片列表/下载
- `src/icloudpd/cli.py` —— CLI 参数定义（约 40 个参数）

Python srp 参考：`F:\iPhone\_srp_py\srp\_pysrp.py`

---

## 七、约定与规范

### 代码规范
- TypeScript ESM + NodeNext + strict
- 所有 HTTP 请求走 `src/client/session.ts`
- 新功能先对照上游 Python 源码，**不自己发明协议**
- 函数名/字段名与上游保持一致，方便以后 diff

### Git 流程（用户硬性要求）
- 需求改动前先给评估方案与影响，用户确认后才动手
- 新建分支开发，测试验收后用户说"可以提交"才提交
- 不主动 push / 合并 / 删分支

### 上游同步
- 上游每周五发新版
- 只同步协议相关改动（URL、headers、cookie 字段、2FA 流程）
- 每次同步更新 `docs/UPSTREAM.md`

### 安全红线
- SDK 提供完整能力，业务方自己决定用不用（包括删除功能）
- 不要在日志/提交里暴露密码、验证码、trust_token
- cookie 文件含敏感信息，不要提交到 git

---

## 八、当前待办

1. CLI 完整参数封装（--size、--album、--watch-with-interval）
2. XMP 副文件导出
3. 相册计数（listAlbums 返回的 count 是 0）
4. GitHub 远程仓库创建

---

## 九、快速验证

```powershell
cd F:\iPhone\icloudpd-node
npx tsc

# 首次登录（会触发 2FA push）
$env:ICLOUDPD_PASSWORD="你的密码"
node dist/cli.js --username 你的邮箱 --domain cn

# 二次免密
node dist/cli.js --username 你的邮箱 --domain cn
```

session 位置：`%APPDATA%\icloudpd-node\`（Windows）

---

## 十、已知小问题

- iCloud 索引偶尔 RUNNING，需要外层重试
- GitHub 远程仓库尚未创建
- CLI 文案 bug：SRP 成功后仍打印 "Session reused"（不影响功能）
