/**
 * PhotosService —— 对应 pyicloud_ipd/services/photos.py
 *
 * 端点：
 *   service_root = data.webservices.ckdatabasews.url
 *   service_endpoint = {service_root}/database/1/com.apple.photos.cloud/production/private
 *
 * 关键接口：
 *   - POST {service_endpoint}/records/query?params  列库/列相册/照片分页/索引检查
 *   - POST {service_endpoint}/zones/list           列所有库
 *   - POST {service_endpoint}/internal/records/query/batch  相册数量
 */
import type { PyiCloudService } from '../client/service.js'
import type { PyiCloudSession } from '../client/session.js'
import { IndexingError } from '../errors.js'

const CK_HEADERS = { 'Content-type': 'text/plain' }

export interface ZoneID {
  zoneName: string
}

export interface PhotoLibrary {
  zoneName: string
  serviceEndpoint: string
}

export interface AlbumInfo {
  /** 相册 ID（查相册照片用） */
  id: string
  name: string
  /** 照片数量（内部相册可能为 0） */
  count: number
}

export interface PhotoAsset {
  id: string
  filename: string | null
  /** 拍摄时间（ms） */
  assetDate: number
  width: number
  height: number
  itemType: string | null
  /** 原始文件大小（bytes） */
  size: number
  /** original 版本下载 URL */
  downloadUrl: string | null
  /** medium 中等尺寸下载 URL */
  mediumUrl: string | null
  /** thumb 缩略图下载 URL */
  thumbUrl: string | null
  isVideo: boolean
  /** recordChangeTag（删除/修改需要） */
  recordChangeTag?: string
}

/** 照片列表查询选项 */
export interface PhotosListOptions {
  /** 起始位置，默认 0 */
  offset?: number
  /** 每页数量，默认 100 */
  limit?: number
  /** 图库 ID，默认 PrimarySync */
  zoneId?: string
}

/** 记录里 fields 的通用形状：{ value: ..., type: ... } */
type Field = { value: any; type?: string }

function fv(rec: any, key: string): any | undefined {
  const f: Field | undefined = rec?.fields?.[key]
  return f?.value
}

function decodeAlbumName(enc: Field | undefined): string {
  if (!enc) return '(unnamed)'
  if (enc.type === 'ENCRYPTED_BYTES') {
    try {
      return Buffer.from(enc.value, 'base64').toString('utf-8')
    } catch {
      return enc.value
    }
  }
  return String(enc.value ?? '')
}

export class PhotosService {
  private service: PyiCloudService
  private session: PyiCloudSession
  private serviceRoot: string
  private serviceEndpoint: string
  private params: Record<string, string>

  private _privateLibraries: PhotoLibrary[] | null = null
  private _albums: AlbumInfo[] | null = null

  constructor(service: PyiCloudService) {
    this.service = service
    this.session = service.session
    const ws = (service.data as any)?.webservices ?? {}
    const url = ws.ckdatabasews?.url
    if (!url) throw new Error('ckdatabasews 不可用 — accountLogin 未成功')
    this.serviceRoot = url
    this.serviceEndpoint = `${this.serviceRoot}/database/1/com.apple.photos.cloud/production/private`
    this.params = { remapEnums: 'true', getCurrentSyncToken: 'true' }
  }

  /** 检查 iCloud 是否索引完成，未完成抛异常（构造时调一次即可） */
  async checkIndexingState(zoneId = 'PrimarySync'): Promise<void> {
    const res = await this.session.post(
      `${this.serviceEndpoint}/records/query?${new URLSearchParams(this.params)}`,
      {
        body: JSON.stringify({
          query: { recordType: 'CheckIndexingState' },
          zoneID: { zoneName: zoneId },
        }),
        headers: CK_HEADERS,
      },
    )
    const rec = (res.body as any)?.records?.[0]
    const state = rec?.fields?.state?.value
    if (state !== 'FINISHED') {
      throw new IndexingError(state ?? 'UNKNOWN')
    }
  }

  /** 列出所有库（private） */
  async listLibraries(): Promise<PhotoLibrary[]> {
    if (this._privateLibraries) return this._privateLibraries
    const res = await this.session.post(`${this.serviceEndpoint}/zones/list`, {
      body: '{}',
      headers: CK_HEADERS,
    })
    const zones = (res.body as any)?.zones ?? []
    this._privateLibraries = zones
      .filter((z: any) => !z?.deleted)
      .map((z: any) => ({
        zoneName: z.zoneID.zoneName,
        serviceEndpoint: this.serviceEndpoint,
      }))
    return this._privateLibraries!
  }

  /** 列出所有相册（含智能相册） */
  async listAlbums(zoneId = 'PrimarySync'): Promise<AlbumInfo[]> {
    if (this._albums) return this._albums
    const res = await this.session.post(
      `${this.serviceEndpoint}/records/query?${new URLSearchParams(this.params)}`,
      {
        body: JSON.stringify({
          query: { recordType: 'CPLAlbumByPositionLive' },
          zoneID: { zoneName: zoneId },
        }),
        headers: CK_HEADERS,
      },
    )
    const records: any[] = (res.body as any)?.records ?? []
    const out: AlbumInfo[] = []
    for (const rec of records) {
      if (rec.recordName === '----Root-Folder----' || rec.recordName === '----Project-Root-Folder----') continue
      if (fv(rec, 'isDeleted')) continue
      const name = decodeAlbumName(rec.fields?.albumNameEnc)
      out.push({ id: rec.recordName, name, count: 0 })
    }
    this._albums = out
    return out
  }

  /** 查询整个图库的照片总数 */
  async countAll(zoneId = 'PrimarySync'): Promise<number> {
    return this._count('CPLAssetByAssetDateWithoutHiddenOrDeleted', zoneId)
  }

  private async _count(objType: string, zoneId = 'PrimarySync'): Promise<number> {
    const body = {
      batch: [
        {
          resultsLimit: 1,
          query: {
            filterBy: {
              fieldName: 'indexCountID',
              fieldValue: { type: 'STRING_LIST', value: [objType] },
              comparator: 'IN',
            },
            recordType: 'HyperionIndexCountLookup',
          },
          zoneWide: true,
          zoneID: { zoneName: zoneId },
        },
      ],
    }
    const res = await this.session.post(
      `${this.serviceEndpoint}/internal/records/query/batch?${new URLSearchParams(this.params)}`,
      { body: JSON.stringify(body), headers: CK_HEADERS },
    )
    return Number((res.body as any)?.batch?.[0]?.records?.[0]?.fields?.itemCount?.value ?? 0)
  }

  /**
   * 分页拉取照片。
   * @param offset 起始偏移
   * @param limit 每页数量（默认 100）
   */
  async listPhotos(offset = 0, limit = 100, zoneId = 'PrimarySync'): Promise<PhotoAsset[]> {
    const body = {
      query: {
        filterBy: [
          { fieldName: 'startRank', fieldValue: { type: 'INT64', value: offset }, comparator: 'EQUALS' },
          { fieldName: 'direction', fieldValue: { type: 'STRING', value: 'ASCENDING' }, comparator: 'EQUALS' },
        ],
        recordType: 'CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted',
      },
      resultsLimit: limit * 2,
      desiredKeys: [
        'filenameEnc', 'itemType',
        'resOriginalWidth', 'resOriginalHeight', 'resOriginalRes',
        'resJPEGMedWidth', 'resJPEGMedHeight', 'resJPEGMedRes',
        'resJPEGThumbWidth', 'resJPEGThumbHeight', 'resJPEGThumbRes',
        'assetDate', 'masterRef',
      ],
      zoneID: { zoneName: zoneId },
    }
    const res = await this.session.post(
      `${this.serviceEndpoint}/records/query?${new URLSearchParams(this.params)}`,
      { body: JSON.stringify(body), headers: CK_HEADERS },
    )
    const records: any[] = (res.body as any)?.records ?? []

    // 配对 CPLAsset（含 assetDate/res*）和 CPLMaster（含 filename/itemType/size）
    const assetByMasterId = new Map<string, any>()
    const masters: any[] = []
    for (const rec of records) {
      if (rec.recordType === 'CPLAsset') {
        const masterId = rec.fields?.masterRef?.value?.recordName
        if (masterId) assetByMasterId.set(masterId, rec)
      } else if (rec.recordType === 'CPLMaster') {
        masters.push(rec)
      }
    }

    const out: PhotoAsset[] = []
    for (const m of masters) {
      const a = assetByMasterId.get(m.recordName)
      if (!a) continue
      out.push(this._toAsset(m, a))
    }
    return out
  }

  private _toAsset(master: any, asset: any): PhotoAsset {
    const itemType = fv(master, 'itemType') ?? null
    // resOriginalRes 在 master 里，不在 asset 里
    const resOriginal = fv(master, 'resOriginalRes') ?? {}
    const filenameEnc = master.fields?.filenameEnc as Field | undefined
    let filename: string | null = null
    if (filenameEnc) {
      if (filenameEnc.type === 'ENCRYPTED_BYTES') {
        try { filename = Buffer.from(filenameEnc.value, 'base64').toString('utf-8') } catch { filename = null }
      } else {
        filename = String(filenameEnc.value)
      }
    }
    return {
      id: master.recordName,
      filename,
      assetDate: Number(fv(asset, 'assetDate') ?? 0),
      width: Number(fv(master, 'resOriginalWidth') ?? 0),
      height: Number(fv(master, 'resOriginalHeight') ?? 0),
      itemType,
      size: Number(resOriginal.size ?? 0),
      downloadUrl: resOriginal.downloadURL ?? null,
      mediumUrl: (fv(master, 'resJPEGMedRes') ?? {}).downloadURL ?? null,
      thumbUrl: (fv(master, 'resJPEGThumbRes') ?? {}).downloadURL ?? null,
      isVideo: itemType === 'com.apple.quicktime-movie',
      recordChangeTag: asset.recordChangeTag,
    }
  }

  /**
   * 增量同步：从最新照片往下拉，遇到 existingCount 张已存在的就停
   * 对应上游 --until-found N
   *
   * @param existingPathFn 判断文件是否已存在的函数（传文件名，返回 boolean）
   * @param untilFound 遇到多少张已存在就停，默认 20
   * @param maxFetch 最多拉多少张，防止死循环
   */
  async listPhotosIncremental(
    existingPathFn: (filename: string | null) => boolean,
    untilFound = 20,
    maxFetch = 500,
    zoneId = 'PrimarySync',
  ): Promise<PhotoAsset[]> {
    const result: PhotoAsset[] = []
    let offset = 0
    let existingCount = 0

    while (offset < maxFetch) {
      const batch = await this.listPhotos(offset, 100, zoneId)
      if (batch.length === 0) break

      for (const p of batch) {
        if (existingPathFn(p.filename)) {
          existingCount++
          if (existingCount >= untilFound) {
            return result
          }
        } else {
          result.push(p)
        }
      }

      offset += batch.length
      if (batch.length < 100) break
    }

    return result
  }

  /**
   * 最近删除相册里的照片列表
   * 和普通列表用同一个接口，只是 recordType 换成
   * CPLAssetAndMasterDeletedByExpungedDate
   */
  async listRecentlyDeleted(offset = 0, limit = 100, zoneId = 'PrimarySync'): Promise<PhotoAsset[]> {
    const body = {
      query: {
        filterBy: [
          { fieldName: 'startRank', fieldValue: { type: 'INT64', value: offset }, comparator: 'EQUALS' },
          { fieldName: 'direction', fieldValue: { type: 'STRING', value: 'ASCENDING' }, comparator: 'EQUALS' },
        ],
        recordType: 'CPLAssetAndMasterDeletedByExpungedDate',
      },
      resultsLimit: limit * 2,
      desiredKeys: [
        'filenameEnc', 'itemType',
        'resOriginalWidth', 'resOriginalHeight', 'resOriginalRes',
        'resJPEGMedWidth', 'resJPEGMedHeight', 'resJPEGMedRes',
        'resJPEGThumbWidth', 'resJPEGThumbHeight', 'resJPEGThumbRes',
        'assetDate', 'masterRef',
      ],
      zoneID: { zoneName: zoneId },
    }
    const res = await this.session.post(
      `${this.serviceEndpoint}/records/query?${new URLSearchParams(this.params)}`,
      { body: JSON.stringify(body), headers: CK_HEADERS },
    )
    const records: any[] = (res.body as any)?.records ?? []

    const assetByMasterId = new Map<string, any>()
    const masters: any[] = []
    for (const rec of records) {
      if (rec.recordType === 'CPLAsset') {
        const masterId = rec.fields?.masterRef?.value?.recordName
        if (masterId) assetByMasterId.set(masterId, rec)
      } else if (rec.recordType === 'CPLMaster') {
        masters.push(rec)
      }
    }

    const out: PhotoAsset[] = []
    for (const m of masters) {
      const a = assetByMasterId.get(m.recordName)
      if (!a) continue
      out.push(this._toAsset(m, a))
    }
    return out
  }

  /**
   * 拉取指定相册里的照片
   * @param albumId 相册 ID（listAlbums 返回的 recordName）
   */
  async listPhotosByAlbum(albumId: string, offset = 0, limit = 100, zoneId = 'PrimarySync'): Promise<PhotoAsset[]> {
    const body = {
      query: {
        filterBy: [
          { fieldName: 'startRank', fieldValue: { type: 'INT64', value: offset }, comparator: 'EQUALS' },
          { fieldName: 'direction', fieldValue: { type: 'STRING', value: 'ASCENDING' }, comparator: 'EQUALS' },
          { fieldName: 'parentId', fieldValue: { type: 'STRING', value: albumId }, comparator: 'EQUALS' },
        ],
        recordType: 'CPLContainerRelationLiveByAssetDate',
      },
      resultsLimit: limit * 2,
      desiredKeys: [
        'filenameEnc', 'itemType',
        'resOriginalWidth', 'resOriginalHeight', 'resOriginalRes',
        'resJPEGMedWidth', 'resJPEGMedHeight', 'resJPEGMedRes',
        'resJPEGThumbWidth', 'resJPEGThumbHeight', 'resJPEGThumbRes',
        'assetDate', 'masterRef',
      ],
      zoneID: { zoneName: zoneId },
    }
    const res = await this.session.post(
      `${this.serviceEndpoint}/records/query?${new URLSearchParams(this.params)}`,
      { body: JSON.stringify(body), headers: CK_HEADERS },
    )
    const records: any[] = (res.body as any)?.records ?? []

    const assetByMasterId = new Map<string, any>()
    const masters: any[] = []
    for (const rec of records) {
      if (rec.recordType === 'CPLAsset') {
        const masterId = rec.fields?.masterRef?.value?.recordName
        if (masterId) assetByMasterId.set(masterId, rec)
      } else if (rec.recordType === 'CPLMaster') {
        masters.push(rec)
      }
    }

    const out: PhotoAsset[] = []
    for (const m of masters) {
      const a = assetByMasterId.get(m.recordName)
      if (!a) continue
      out.push(this._toAsset(m, a))
    }
    return out
  }

  /**
   * 删除照片（从 iCloud）
   * 调 records/modify，把 isDeleted 改成 1
   */
  async deletePhoto(photo: PhotoAsset, zoneId = 'PrimarySync'): Promise<void> {
    if (!photo.recordChangeTag) {
      throw new Error('PhotoAsset 缺少 recordChangeTag，无法删除')
    }
    const body = {
      atomic: true,
      desiredKeys: ['isDeleted'],
      operations: [
        {
          operationType: 'update',
          record: {
            fields: { isDeleted: { value: 1 } },
            recordChangeTag: photo.recordChangeTag,
            recordName: photo.id,
            recordType: 'CPLAsset',
          },
        },
      ],
      zoneID: { zoneName: zoneId },
    }
    await this.session.post(
      `${this.serviceEndpoint}/records/modify?${new URLSearchParams(this.params)}`,
      { body: JSON.stringify(body), headers: CK_HEADERS },
    )
  }
}
