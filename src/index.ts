/**
 * icloudpd-node —— Node/TypeScript port of icloud_photos_downloader (MIT)
 *
 * 公开 API 入口
 */
export { PyiCloudService, type Domain, type AuthResult, type SessionSnapshot } from './client/service.js'
export { PyiCloudSession } from './client/session.js'
export { PhotosService, type PhotoAsset, type AlbumInfo, type PhotoLibrary } from './services/photos.js'
export { downloadPhoto, type DownloadOptions } from './download/runner.js'
export { ICloudError, AuthError, NetworkError, IndexingError, ApiError } from './errors.js'
