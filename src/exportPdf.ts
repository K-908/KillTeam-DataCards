import { degrees, PDFDocument, rgb, type PDFEmbeddedPage, type PDFImage, type PDFPage } from 'pdf-lib'
import { backSideId, makeSheets, slotPosition, type PrintLayout } from './layout'
import type { Card, SourceFile, SourceSide } from './types'

const pt = (mm: number) => mm * 72 / 25.4

type Embedded = { kind: 'pdf'; value: PDFEmbeddedPage; rotationDegrees: number } | { kind: 'image'; value: PDFImage }

function drawCutGuides(page: PDFPage, slot: number, layout: PrintLayout) {
  const { x, yFromTop } = slotPosition(layout, slot)
  const left = pt(x)
  const right = pt(x + layout.slotWidthMm)
  const bottom = pt(layout.pageHeightMm - yFromTop - layout.slotHeightMm)
  const top = pt(layout.pageHeightMm - yFromTop)
  const length = pt(Math.min(2, layout.gapMm / 2))
  const color = rgb(0.5, 0.5, 0.5)
  for (const edgeX of [left, right]) {
    const direction = edgeX === left ? -1 : 1
    for (const edgeY of [bottom, top]) {
      const vertical = edgeY === bottom ? -1 : 1
      page.drawLine({ start: { x: edgeX, y: edgeY }, end: { x: edgeX + direction * length, y: edgeY }, thickness: 0.35, color })
      page.drawLine({ start: { x: edgeX, y: edgeY }, end: { x: edgeX, y: edgeY + vertical * length }, thickness: 0.35, color })
    }
  }
}

function drawEmbedded(page: PDFPage, embedded: Embedded, slot: number, layout: PrintLayout) {
  const { x, yFromTop } = slotPosition(layout, slot)
  const width = pt(layout.slotWidthMm)
  const height = pt(layout.slotHeightMm)
  const source = embedded.value
  const rotation = ((embedded.kind === 'pdf' ? embedded.rotationDegrees : 0) + layout.cardRotationDegrees) % 360
  const sideways = rotation === 90 || rotation === 270
  const orientedWidth = sideways ? source.height : source.width
  const orientedHeight = sideways ? source.width : source.height
  const scale = Math.min(width / orientedWidth, height / orientedHeight)
  const sourceWidth = source.width * scale
  const sourceHeight = source.height * scale
  const left = pt(x) + (width - orientedWidth * scale) / 2
  const bottom = pt(layout.pageHeightMm - yFromTop - layout.slotHeightMm) + (height - orientedHeight * scale) / 2
  const origin = rotation === 90
    ? { x: left + sourceHeight, y: bottom }
    : rotation === 180
      ? { x: left + sourceWidth, y: bottom + sourceHeight }
      : rotation === 270
        ? { x: left, y: bottom + sourceWidth }
        : { x: left, y: bottom }
  if (embedded.kind === 'pdf') {
    page.drawPage(embedded.value, {
      ...origin,
      width: sourceWidth,
      height: sourceHeight,
      rotate: degrees(rotation),
    })
  } else {
    page.drawImage(embedded.value, {
      ...origin,
      width: sourceWidth,
      height: sourceHeight,
      rotate: degrees(rotation),
    })
  }
  drawCutGuides(page, slot, layout)
}

export async function createPrintPdf(
  cards: Card[],
  sharedBackId: string | null,
  sides: SourceSide[],
  files: Map<string, SourceFile>,
  layout: PrintLayout,
) {
  const pdf = await PDFDocument.create()
  const sideById = new Map(sides.map(side => [side.id, side]))
  const embedded = new Map<string, Embedded>()

  async function getEmbedded(sideId: string) {
    const cached = embedded.get(sideId)
    if (cached) return cached
    const side = sideById.get(sideId)
    if (!side) throw new Error(`Missing source side: ${sideId}`)
    const source = files.get(side.sourceId)
    if (!source) throw new Error(`Missing source file for ${side.label}`)
    let value: Embedded
    if (source.kind === 'pdf') {
      const [page] = await pdf.embedPdf(source.bytes, [side.pageIndex ?? 0])
      value = { kind: 'pdf', value: page, rotationDegrees: side.pdfRotationDegrees ?? 0 }
    } else {
      value = { kind: 'image', value: await pdf.embedPng(source.bytes) }
    }
    embedded.set(sideId, value)
    return value
  }

  for (const sheet of makeSheets(cards, layout)) {
    for (const face of ['fronts', 'backs'] as const) {
      const page = pdf.addPage([pt(layout.pageWidthMm), pt(layout.pageHeightMm)])
      for (let slot = 0; slot < layout.cardsPerSheet; slot++) {
        const card = sheet[face][slot]
        if (!card) continue
        const sideId = face === 'fronts' ? card.frontId : backSideId(card, sharedBackId)
        if (!sideId) throw new Error('A card is missing its reverse')
        drawEmbedded(page, await getEmbedded(sideId), slot, layout)
      }
    }
  }

  return pdf.save()
}
