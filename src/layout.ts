import type { Card } from './types'

export const CARD_WIDTH_MM = 121
export const CARD_HEIGHT_MM = 70

export type PaperSize = 'a4' | 'letter'
export type LayoutChoice = 'vertical' | 'grid'

export interface PrintLayout {
  paperSize: PaperSize
  choice: LayoutChoice
  pageWidthMm: number
  pageHeightMm: number
  columns: number
  rows: number
  cardsPerSheet: number
  slotWidthMm: number
  slotHeightMm: number
  cardRotationDegrees: number
  gapMm: number
  leftMm: number
  topMm: number
  orientation: 'portrait' | 'landscape'
  flipEdge: 'long' | 'short'
}

export function getPrintLayout(paperSize: PaperSize, choice: LayoutChoice): PrintLayout {
  const portraitWidth = paperSize === 'a4' ? 210 : 215.9
  const portraitHeight = paperSize === 'a4' ? 297 : 279.4
  const grid = choice === 'grid'
  const columns = grid ? 2 : 1
  const rows = grid ? 2 : paperSize === 'a4' ? 4 : 3
  const gapMm = grid || rows === 3 ? 6 : 2
  const pageWidthMm = portraitWidth
  const pageHeightMm = portraitHeight
  const slotWidthMm = grid ? CARD_HEIGHT_MM : CARD_WIDTH_MM
  const slotHeightMm = grid ? CARD_WIDTH_MM : CARD_HEIGHT_MM
  const leftMm = (pageWidthMm - columns * slotWidthMm - (columns - 1) * gapMm) / 2
  const topMm = (pageHeightMm - rows * slotHeightMm - (rows - 1) * gapMm) / 2
  if (leftMm < 0 || topMm < 0) throw new Error('Cards do not fit on the selected paper')

  return {
    paperSize,
    choice,
    pageWidthMm,
    pageHeightMm,
    columns,
    rows,
    cardsPerSheet: columns * rows,
    slotWidthMm,
    slotHeightMm,
    cardRotationDegrees: grid ? 90 : 0,
    gapMm,
    leftMm,
    topMm,
    orientation: 'portrait',
    flipEdge: 'long',
  }
}

export interface Sheet {
  fronts: (Card | null)[]
  backs: (Card | null)[]
}

export function slotPosition(layout: PrintLayout, index: number) {
  const column = index % layout.columns
  const row = Math.floor(index / layout.columns)
  return {
    x: layout.leftMm + column * (layout.slotWidthMm + layout.gapMm),
    yFromTop: layout.topMm + row * (layout.slotHeightMm + layout.gapMm),
  }
}

export function makeSheets(cards: Card[], layout: PrintLayout): Sheet[] {
  const sheets: Sheet[] = []
  for (let offset = 0; offset < cards.length; offset += layout.cardsPerSheet) {
    const group: (Card | null)[] = Array.from(
      { length: layout.cardsPerSheet },
      (_, index) => cards[offset + index] ?? null,
    )
    // Portrait long-edge duplex reverses the columns on the back of each row.
    const backs = layout.choice === 'grid'
      ? group.map((_, slot) => {
          const row = Math.floor(slot / layout.columns)
          const mirroredColumn = layout.columns - 1 - slot % layout.columns
          return group[row * layout.columns + mirroredColumn]
        })
      : [...group]
    sheets.push({ fronts: group, backs })
  }
  return sheets
}

export function backSideId(card: Card, sharedBackId: string | null) {
  return card.backMode === 'shared' ? sharedBackId : card.backId
}
