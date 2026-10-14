# Apple API 接口清单

本项目的核心是对接 iCloud Apple API。所有功能都是基于这些接口衍生出来的。

---

## 总览

| 接口 | 端点 | 说明 | 状态 |
|---|---|---|---|
| **认证** | | | |
| SRP init | `POST /appleauth/auth/mpd/srpu/init` | SRP 登录初始化 | ✅ 已做 |
| SRP complete | `POST /appleauth/auth/mpd/srpu/complete` | SRP 登录验证 | ✅ 已做 |
| accountLogin | `POST /setup/ws/1/accountLogin` | 登录主接口 | ✅ 已做 |
| triggerPushNotification | `POST /appleauth/auth/verify/trusteddevice` | 触发 2FA push | ✅ 已做 |
| validate2faCode | `POST /appleauth/auth/verify/securitycode` | 提交验证码 | ✅ 已做 |
| trustSession | `POST /appleauth/auth/verify/trust` | 信任设备 | ✅ 已做 |
| **照片** | | | |
| records/query | `POST /databyte/photo/records/query` | 列表查询（全部照片/相册/最近删除共用） | ✅ 已做 |
| records/query/batch | `POST /databyte/photo/internal/records/query/batch` | 计数 | ✅ 已做 |
| downloadPhoto | `GET <downloadUrl>` | 下载照片文件 | ✅ 已做 |
| records/modify | `POST /databyte/photo/records/modify` | 修改/删除照片 | ✅ 已做 |
| CheckIndexingState | `POST /databyte/photo/records/query` | 索引状态检查 | ✅ 已做 |

已做 10 个，全部完成。

---

## 详细接口文档

## 认证接口

### SRP 登录初始化

```
POST https://idmsa.apple.com.cn/appleauth/auth/mpd/srpu/init
```

**请求头：**
- `Content-Type: application/json`
- `Accept: application/json`
- `User-Agent: ...`
- `X-Apple-Widget-Key: d39ba9916b7251055b22c7f910e2ea796ee65e98b2ddecea8f5dde8d9d1a815d`

**请求体：**
```json
{
  "iteration": 100000,
  "salt": "<hex>",
  "protocol": "srp-6a",
  "b": "<base64>"
}
```

**返回：**
- `scnt`：会话计数器
- `sid`：会话 ID
- `st`：服务器公钥

---

### SRP 登录验证

```
POST https://idmsa.apple.com.cn/appleauth/auth/mpd/srpu/complete
```

**请求头：**
- 和 init 一样，加上 `scnt`、`sid`

**请求体：**
```json
{
  "c": "<base64>",
  "M1": "<base64>"
}
```

**返回：**
- 状态码 409 → 需要 2FA
- 状态码 200 → 登录成功

---

### accountLogin

```
POST https://setup.icloud.com.cn/setup/ws/1/accountLogin
```

**请求体：**
```json
{
  "apple_id": "your@email.com",
  "password": "..."
}
```

**返回：**
- `dsid`：用户 ID
- `session_token`：会话 token
- `trust_token`：信任 token
- `webservices`：可用服务列表

---

### 触发 2FA Push

```
POST https://idmsa.apple.com.cn/appleauth/auth/verify/trusteddevice
```

**返回：**
- 成功后手机会弹出"是否允许登录"

---

### 提交验证码

```
POST https://idmsa.apple.com.cn/appleauth/auth/verify/securitycode
```

**请求体：**
```json
{
  "securityCode": { "code": "123456" }
}
```

**返回：**
- 验证成功

---

### 信任设备

```
POST https://idmsa.apple.com.cn/appleauth/auth/verify/trust
```

**请求体：**
```json
{
  "trustTokens": ["<trust_token>"]
}
```

**返回：**
- 信任当前设备，下次免验证

---

## 照片接口

### records/query（照片列表/相册/最近删除共用）

```
POST https://pXX-photostream.icloud.com/databyte/photo/records/query
```

**说明：** 这个接口是核心，所有"列表"类查询都用它，只是 `recordType` 和 `filterBy` 不同。

**通用请求体：**
```json
{
  "query": {
    "filterBy": [
      {
        "fieldName": "startRank",
        "fieldValue": { "type": "INT64", "value": 0 },
        "comparator": "EQUALS"
      },
      {
        "fieldName": "direction",
        "fieldValue": { "type": "STRING", "value": "ASCENDING" },
        "comparator": "EQUALS"
      }
    ],
    "recordType": "<查询类型>"
  },
  "resultsLimit": 100,
  "desiredKeys": ["...字段列表..."],
  "zoneID": { "zoneName": "PrimarySync" }
}
```

**不同查询类型：**

| 功能 | recordType |
|---|---|
| 全部照片 | `CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted` |
| 最近删除 | `CPLAssetAndMasterDeletedByExpungedDate` |
| 相册列表 | `CPLAlbumByPositionLive` |
| 指定相册 | `CPLContainerRelationLiveByAssetDate` |

**返回：**
```json
{
  "records": [
    {
      "recordType": "CPLAsset",
      "recordName": "...",
      "recordChangeTag": "...",
      "fields": {
        "resOriginalRes": { "value": "<download_url>" },
        "assetDate": { "value": 1234567890000 },
        "itemType": { "value": "image" },
        ...
      }
    },
    {
      "recordType": "CPLMaster",
      "recordName": "...",
      "fields": {
        "filename": { "value": "IMG_0001.JPG" },
        ...
      }
    }
  ]
}
```

**说明：** 返回的记录分两种类型：
- `CPLAsset`：资产记录，包含下载 URL、拍摄时间等
- `CPLMaster`：主记录，包含文件名等

---

### records/query/batch（计数）

```
POST https://pXX-photostream.icloud.com/databyte/photo/internal/records/query/batch
```

**说明：** 批量查询，用来获取照片总数。

**请求体：**
```json
{
  "batch": [
    {
      "resultsLimit": 1,
      "query": {
        "filterBy": {
          "fieldName": "indexCountID",
          "fieldValue": { "type": "STRING_LIST", "value": ["<obj_type>"] },
          "comparator": "IN"
        },
        "recordType": "HyperionIndexCountLookup"
      },
      "zoneWide": true,
      "zoneID": { "zoneName": "PrimarySync" }
    }
  ]
}
```

**返回：**
```json
{
  "batch": [
    {
      "records": [
        {
          "fields": {
            "itemCount": { "value": 12470 }
          }
        }
      ]
    }
  ]
}
```

---

### records/modify（删除照片）

```
POST https://pXX-photostream.icloud.com/databyte/photo/records/modify
```

**说明：** 修改照片记录，把 `isDeleted` 改成 1 就是删除。

**请求体：**
```json
{
  "atomic": true,
  "desiredKeys": ["isDeleted"],
  "operations": [
    {
      "operationType": "update",
      "record": {
        "fields": { "isDeleted": { "value": 1 } },
        "recordChangeTag": "<从列表接口取>",
        "recordName": "<从列表接口取>",
        "recordType": "CPLAsset"
      }
    }
  ],
  "zoneID": { "zoneName": "PrimarySync" }
}
```

---

### CheckIndexingState（索引状态）

```
POST https://pXX-photostream.icloud.com/databyte/photo/records/query
```

**说明：** 检查 iCloud 是否正在索引照片库。

**请求体：**
```json
{
  "query": { "recordType": "CheckIndexingState" },
  "zoneID": { "zoneName": "PrimarySync" }
}
```

**返回：**
```json
{
  "records": [
    {
      "fields": {
        "state": { "value": "FINISHED" }
      }
    }
  ]
}
```

状态值：`RUNNING`（索引中）/ `FINISHED`（完成）

---

## 下载照片

```
GET <从 records/query 返回的 resOriginalRes 字段里取>
```

**说明：** 不是固定端点，是从列表接口返回的下载 URL。

---

## 核心说明

**这些是所有功能的基础。**

所有 CLI 参数（--until-found、--recent、--folder-structure、--size 等）都是在这些接口之上自己实现的业务逻辑。

复刻优先级：
1. 必须一比一对标：以上所有 Apple API 接口
2. 按需借鉴：基于这些接口的业务逻辑实现

Apple 改了接口，我们看上游 Python 源码怎么改，照着改。
