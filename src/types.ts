export type SideKind = 'pdf' | 'image'

export interface SourceSide {
  id: string
  sourceId: string
  kind: SideKind
  pageIndex?: number
  pdfRotationDegrees?: number
  autoRotated?: boolean
  label: string
  thumbnailUrl: string
  width: number
  height: number
}

export interface SourceFile {
  kind: SideKind
  bytes: Uint8Array
}

export interface Card {
  id: string
  frontId: string
  backMode: 'shared' | 'custom'
  backId: string | null
}
