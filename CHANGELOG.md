# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-10-14

### 初始版本

**认证：**
- SRP-6a 纯 JS 实现（零原生依赖）
- 两步验证（2FA）支持
- Cookie / session 持久化
- 国内区（cn）和国际区（com）支持

**照片列表：**
- 列出所有图库
- 列出所有相册
- 照片总数统计
- 分页拉取全部照片
- 拉取指定相册的照片
- 增量同步（--until-found）
- 最近删除相册列表

**下载：**
- 下载照片到本地
- 按日期分目录（{year}/{month}/{day}）
- 断点续传（.part 临时文件）
- 设置文件修改时间为拍摄时间
- 补写 EXIF 拍摄时间（仅 JPEG）
- 支持不同尺寸（original / medium / thumb）
- 下载进度回调

**其他：**
- 错误处理规范（AuthError / NetworkError / IndexingError / ApiError）
- 请求超时和重试次数可配置
- CLI 命令行工具（基础参数）
