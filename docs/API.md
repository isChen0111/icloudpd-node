# icloudpd-node

把 iCloud 照片下载到本地的 Node.js 库。

## 安装

```bash
npm install icloudpd-node
```

Node.js ≥ 18。

## 快速开始

### 1. 创建服务实例

```ts
import { PyiCloudService } from 'icloudpd-node'

const svc = new PyiCloudService(
  'cn',                                    // 'com' 国际区 / 'cn' 中国区
  'your@email.com',                        // 你的 Apple ID
  () => process.env.APPLE_ID_PASSWORD,     // 返回密码的函数
)
```

### 2. 登录

```ts
const auth = await svc.authenticate()
```

第一次登录会触发 2FA：你的手机会弹出"是否允许登录"，点允许后输入收到的 6 位验证码。

```ts
if (auth.requires2fa) {
  await svc.triggerPushNotification()
  await svc.validate2faCode('123456')  // 换成你收到的验证码
}
```

### 3. 拉取照片列表

```ts
// 默认照片库（PrimarySync）最近 100 张
const photos = await svc.photos.listPhotos(0, 100)

for (const p of photos) {
  console.log(p.filename, p.width + 'x' + p.height)
}
```

### 4. 下载照片到本地

```ts
import { downloadPhoto } from 'icloudpd-node'

for (const p of photos) {
  await downloadPhoto(svc.session, p, {
    outputDir: 'F:/photos',                    // 输出根目录
    folderStructure: '{year}/{month}/{day}',     // 按日期分目录，'none' 则不分
    setMtime: true,                             // 修改时间设为拍摄时间
    setExifDatetime: false,                     // 补写 EXIF 时间（仅 JPEG）
  })
}
```

**下载选项：**

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `outputDir` | string | — | 输出根目录 |
| `folderStructure` | string | `'{year}/{month}/{day}'` | 文件夹结构模板，`'none'` 则不分目录 |
| `setMtime` | boolean | `true` | 文件修改时间设为拍摄时间 |
| `setExifDatetime` | boolean | `false` | 补写 EXIF 拍摄时间（仅 JPEG） |
| `size` | `'original' \| 'medium' \| 'thumb'` | `'original'` | 下载尺寸 |
| `onProgress` | `(loaded, total) => void` | — | 下载进度回调 |

### 5. 保存登录状态

默认关闭程序后登录状态就没了。传 `cookieDir` 参数让它自动保存，**下次启动自动恢复**：

```ts
// 第一次启动：登录后自动存
const svc = new PyiCloudService(
  'cn',
  'your@email.com',
  () => process.env.APPLE_ID_PASSWORD,
  'C:/Users/你/.icloudpd'  // session 存这个目录
)
await svc.authenticate()

// 第二次启动：传同一个路径，自动恢复，不用再输密码
const svc2 = new PyiCloudService('cn', 'your@email.com', () => null, 'C:/Users/你/.icloudpd')
await svc2.authenticate()
```

目录里会生成两个文件：

- `<邮箱>.session` — session_token、trust_token
- `<邮箱>` — cookies

## API 参考

### PyiCloudService

```ts
new PyiCloudService(domain, appleId, passwordProvider, cookieDir?, options?)
```

| 参数                 | 类型                    | 说明                           |
| -------------------- | ----------------------- | ------------------------------ |
| `domain`           | `'com' \| 'cn'`        | iCloud 区域                    |
| `appleId`          | `string`              | Apple ID 邮箱                  |
| `passwordProvider` | `() => string \| null` | 返回密码的函数                 |
| `cookieDir`        | `string?`             | session 存储目录，不传则纯内存 |
| `options.timeout`  | `number?`             | 请求超时（毫秒），默认 30000   |
| `options.maxRetries` | `number?`           | 网络错误重试次数，默认 3       |

```ts
const svc = new PyiCloudService(
  'cn',
  'your@email.com',
  () => process.env.APPLE_ID_PASSWORD,
  'C:/Users/你/.icloudpd',
  {
    timeout: 60000,    // 60 秒超时
    maxRetries: 5,     // 重试 5 次
  }
)
```

#### 属性

| 属性            | 类型                    | 说明                      |
| --------------- | ----------------------- | ------------------------- |
| `svc.session` | `PyiCloudSession`     | HTTP 会话（下载照片时用） |
| `svc.photos`  | `PhotosService`       | 照片服务                  |
| `svc.data`    | `Record<string, any>` | 登录返回的完整数据        |

#### 方法

| 方法                          | 返回                    | 说明          |
| ----------------------------- | ----------------------- | ------------- |
| `authenticate()`            | `Promise<AuthResult>` | 登录          |
| `triggerPushNotification()` | `Promise<boolean>`    | 触发 2FA push |
| `validate2faCode(code)`     | `Promise<boolean>`    | 提交验证码    |
| `exportSession()`           | `SessionSnapshot`     | 导出会话状态  |
| `importSession(session)`    | `void`                | 导入会话状态  |

会话状态数据结构：

```ts
interface SessionSnapshot {
  cookies: Record<string, string>   // cookies
  sessionData: SessionData          // session_token / trust_token 等
}
```

登录返回的数据结构：

```ts
interface AuthResult {
  requires2fa: boolean   // 新版两步验证（新账号）
  requires2sa: boolean   // 旧版两步认证（老账号）
  data: Record<string, any>  // 完整响应数据
}
```

### PhotosService

通过 `svc.photos` 访问。

| 方法                                                          | 返回                        | 说明                      |
| ------------------------------------------------------------- | --------------------------- | ------------------------- |
| `checkIndexingState(zoneId?)`                                | `Promise<void>`            | 检查 iCloud 是否索引完成  |
| `listLibraries()`                                           | `Promise<PhotoLibrary[]>` | 列出所有图库              |
| `listAlbums(zoneId?)`                                        | `Promise<AlbumInfo[]>`    | 列出所有相册              |
| `countAll(zoneId?)`                                          | `Promise<number>`         | 照片总数                  |
| `listPhotos(offset?, limit?, zoneId?)`                       | `Promise<PhotoAsset[]>`   | 拉取照片库照片            |
| `listPhotosByAlbum(albumId, offset?, limit?, zoneId?)`       | `Promise<PhotoAsset[]>`   | 拉取指定相册的照片        |
| `listPhotosIncremental(existingFn, untilFound?, maxFetch?, zoneId?)` | `Promise<PhotoAsset[]>`   | 增量同步（遇到已存在的就停） |
| `listRecentlyDeleted(offset?, limit?, zoneId?)`              | `Promise<PhotoAsset[]>`   | 最近删除相册列表          |
| `deletePhoto(photo, zoneId?)`                               | `Promise<void>`           | 从 iCloud 删除照片        |

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `offset` | number | 0 | 起始位置（按拍摄时间排序） |
| `limit` | number | 100 | 每页数量 |
| `zoneId` | string | `'PrimarySync'` | 图库 ID（`PrimarySync` 主图库 / `SharedLibrary` 共享图库） |
| `albumId` | string | — | 相册 ID |
| `untilFound` | number | 20 | 增量同步：遇到多少张已存在的就停 |
| `maxFetch` | number | 500 | 增量同步：最多拉取多少张 |
| `existingFn` | `(filename) => boolean` | — | 增量同步：判断文件是否已存在的函数 |

照片元数据结构：

```ts
interface AlbumInfo {
  id: string       // 相册 ID
  name: string     // 相册名称
  count: number    // 照片数量
}

interface PhotoAsset {
  id: string
  filename: string | null
  assetDate: number       // 拍摄时间 ms
  width: number
  height: number
  itemType: string | null
  size: number
  downloadUrl: string | null      // original 原图
  mediumUrl: string | null        // medium 中等尺寸
  thumbUrl: string | null         // thumb 缩略图
  isVideo: boolean
  recordChangeTag?: string        // 删除需要
}
```

### downloadPhoto

下载单张照片到本地，参数：

| 参数                        | 类型                | 说明                                      |
| --------------------------- | ------------------- | ----------------------------------------- |
| `session`                 | `PyiCloudSession` | 从`svc.session` 取                      |
| `photo`                   | `PhotoAsset`      | 照片元数据                                |
| `options.outputDir`       | `string`          | 输出根目录                                |
| `options.folderStructure` | `string?`         | 目录模板，默认`{year}/{month}/{day}`    |
| `options.setMtime`        | `boolean?`        | 修改时间设为拍摄时间，默认 true           |
| `options.setExifDatetime` | `boolean?`        | 补写 EXIF 拍摄时间，默认 false（仅 JPEG） |
| `options.size`            | `'original' \| 'medium' \| 'thumb'` | 下载尺寸，默认 original |
| `options.onProgress`       | `(loaded, total) => void` | 下载进度回调 |

```ts
await downloadPhoto(svc.session, photo, {
  outputDir: 'F:/photos',
  size: 'medium',  // 下载中等尺寸
  onProgress: (loaded, total) => {
    console.log(`进度: ${(loaded / total * 100).toFixed(1)}%`)
  },
})
```

## 错误处理

所有 API 调用都可能抛错，错误类型：

| 错误类            | 触发场景               | 是否自动重试         |
| ----------------- | ---------------------- | -------------------- |
| `AuthError`     | 密码错误、session 过期 | 否                   |
| `NetworkError`  | 网络连接失败、超时     | 是（3 次，指数退避） |
| `IndexingError` | iCloud 正在索引        | 否（等几分钟重试）   |
| `ApiError`      | Apple API 返回 5xx     | 是（3 次）           |

```ts
import { AuthError, NetworkError, IndexingError } from 'icloudpd-node'

try {
  await svc.authenticate()
} catch (e) {
  if (e instanceof AuthError) {
    console.error('密码错误，重新登录')
  } else if (e instanceof NetworkError) {
    console.error('网络问题，稍后再试')
  } else if (e instanceof IndexingError) {
    console.error('iCloud 正在索引，等几分钟')
  }
}
```

每个错误都带 `retryable` 字段标记是否可重试：

```ts
catch (e) {
  if (e.retryable) {
    // 可以自动重试
  } else {
    // 需要用户介入
  }
}
```
