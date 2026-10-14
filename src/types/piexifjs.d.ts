declare module 'piexifjs' {
  export function load(jpegData: string): any
  export function dump(exifObj: any): string
  export function insert(exifBytes: string, jpegData: string): string
  const _default: { load: typeof load; dump: typeof dump; insert: typeof insert }
  export default _default
}
