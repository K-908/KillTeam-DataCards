import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { CARD_HEIGHT_MM, CARD_WIDTH_MM } from './layout'
import { extractTeamLogo, type ExtractedLogo } from './logoExtraction'
import type { SourceFile, SourceSide } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface ImportResult {
  sides: SourceSide[]
  file: SourceFile
  sheetInfo?: { pageCount: number; detectedPages: number }
  extractedLogo?: ExtractedLogo
}

type PdfPage = Awaited<ReturnType<pdfjs.PDFDocumentProxy['getPage']>>
type CropBox = NonNullable<SourceSide['cropBox']>

const points = (mm: number) => mm * 72 / 25.4
const cardWidth = points(CARD_WIDTH_MM)
const cardHeight = points(CARD_HEIGHT_MM)

function detectCardGrid(page: PdfPage, operators: Awaited<ReturnType<PdfPage['getOperatorList']>>): CropBox[] {
  // The official sheets draw a card-sized vector outline for every slot.
  // Repeated fills and strokes of the same outline count as one slot.
  if (page.rotate !== 0) return []
  const boxes: CropBox[] = []
  for (let index = 0; index < operators.fnArray.length; index++) {
    if (operators.fnArray[index] !== pdfjs.OPS.constructPath) continue
    const bounds = operators.argsArray[index]?.[2] as ArrayLike<number> | undefined
    if (!bounds || bounds.length !== 4) continue
    const [left, bottom, right, top] = Array.from(bounds)
    const width = right - left
    const height = top - bottom
    const matchesCard = (Math.abs(width - cardWidth) < 1.5 && Math.abs(height - cardHeight) < 1.5)
      || (Math.abs(width - cardHeight) < 1.5 && Math.abs(height - cardWidth) < 1.5)
    if (!matchesCard || left < page.view[0] - 1 || bottom < page.view[1] - 1
      || right > page.view[2] + 1 || top > page.view[3] + 1) continue
    if (!boxes.some(box => Math.abs(box.left - left) < 1 && Math.abs(box.bottom - bottom) < 1)) {
      boxes.push({ left, bottom, right, top })
    }
  }

  // Reject isolated card-sized artwork on ordinary PDF pages. The supplied
  // team sheets use either four stacked slots or a regular two-by-two grid.
  if (boxes.length !== 4) return []
  const landscape = boxes.every(box => box.right - box.left > box.top - box.bottom)
  const portrait = boxes.every(box => box.right - box.left < box.top - box.bottom)
  if (!landscape && !portrait) return []
  const positions = (values: number[]) => {
    const unique: number[] = []
    for (const value of values) if (!unique.some(other => Math.abs(other - value) < 2)) unique.push(value)
    return unique.length
  }
  const columns = positions(boxes.map(box => box.left))
  const rows = positions(boxes.map(box => box.top))
  if (landscape ? columns !== 1 || rows !== 4 : columns !== 2 || rows !== 2) return []
  return boxes.sort((a, b) => Math.abs(a.top - b.top) < 2 ? a.left - b.left : b.top - a.top)
}

function isNotesBox(box: CropBox, content: Awaited<ReturnType<PdfPage['getTextContent']>>) {
  return content.items.some(item => {
    if (!('str' in item) || !/^NOTES\s*:/i.test(item.str.trim())) return false
    const x = item.transform[4]
    const y = item.transform[5]
    return x >= box.left && x <= box.right && y >= box.bottom && y <= box.top
  })
}

function renderCroppedCanvas(pageCanvas: HTMLCanvasElement, viewport: ReturnType<PdfPage['getViewport']>, box: CropBox, outputWidth: number) {
  const [x1, y1] = viewport.convertToViewportPoint(box.left, box.bottom)
  const [x2, y2] = viewport.convertToViewportPoint(box.right, box.top)
  const sx = Math.min(x1, x2)
  const sy = Math.min(y1, y2)
  const sw = Math.abs(x2 - x1)
  const sh = Math.abs(y2 - y1)
  const portrait = box.top - box.bottom > box.right - box.left
  const canvas = document.createElement('canvas')
  canvas.width = outputWidth
  canvas.height = Math.round(outputWidth * (portrait ? sw / sh : sh / sw))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  if (portrait) {
    context.translate(0, canvas.height)
    context.rotate(-Math.PI / 2)
    context.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, canvas.height, canvas.width)
  } else {
    context.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  }
  return canvas.toDataURL('image/png')
}

async function renderPageCanvas(page: PdfPage, scale: number) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  await page.render({ canvas, viewport }).promise
  return { canvas, viewport }
}

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function isImage(file: File) {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    || /\.(png|jpe?g|webp)$/i.test(file.name)
}

async function imageToPng(file: File) {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image conversion failed')), 'image/png')
    })
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      thumbnailUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    bitmap.close()
  }
}

export async function importSource(file: File): Promise<ImportResult> {
  const sourceId = crypto.randomUUID()
  if (isPdf(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const loadingTask = pdfjs.getDocument({ data: bytes.slice() })
    const document = await loadingTask.promise
    const sides: SourceSide[] = []
    try {
      const grids = new Map<number, CropBox[]>()
      for (let pageIndex = 0; pageIndex < document.numPages; pageIndex++) {
        const page = await document.getPage(pageIndex + 1)
        const width = page.view[2] - page.view[0]
        const height = page.view[3] - page.view[1]
        if (width < cardWidth * 1.3 || height < cardHeight * 2) continue
        const boxes = detectCardGrid(page, await page.getOperatorList())
        if (boxes.length) grids.set(pageIndex, boxes)
      }
      if (grids.size) {
        let extractedLogo: ExtractedLogo | null = null
        try {
          extractedLogo = await extractTeamLogo(await document.getPage(1), file.name)
        } catch {
          // Logo extraction is optional; card import can still succeed.
        }
        for (const [pageIndex, boxes] of grids) {
          const page = await document.getPage(pageIndex + 1)
          const content = await page.getTextContent()
          const { canvas, viewport } = await renderPageCanvas(page, 1.5)
          for (const [slot, cropBox] of boxes.entries()) {
            const portrait = cropBox.top - cropBox.bottom > cropBox.right - cropBox.left
            sides.push({
              id: `${sourceId}:${pageIndex}:${slot}`,
              sourceId,
              kind: 'pdf',
              pageIndex,
              cardIndex: slot,
              cropBox,
              suggestedNote: isNotesBox(cropBox, content),
              pdfRotationDegrees: portrait ? 90 : 0,
              autoRotated: portrait,
              label: `Page ${pageIndex + 1} · card ${slot + 1} · ${file.name}`,
              thumbnailUrl: renderCroppedCanvas(canvas, viewport, cropBox, 360),
              width: portrait ? cropBox.top - cropBox.bottom : cropBox.right - cropBox.left,
              height: portrait ? cropBox.right - cropBox.left : cropBox.top - cropBox.bottom,
            })
          }
          page.cleanup()
        }
        return { sides, file: { kind: 'pdf', bytes }, sheetInfo: { pageCount: document.numPages, detectedPages: grids.size }, extractedLogo: extractedLogo ?? undefined }
      }
      for (let pageIndex = 0; pageIndex < document.numPages; pageIndex++) {
        const page = await document.getPage(pageIndex + 1)
        const natural = page.getViewport({ scale: 1 })
        const autoRotated = natural.height > natural.width
        // PDF.js uses clockwise degrees; 270 turns a portrait page 90° CCW.
        const displayRotation = (page.rotate + (autoRotated ? 270 : 0)) % 360
        const oriented = page.getViewport({ scale: 1, rotation: displayRotation })
        const viewport = page.getViewport({ scale: 360 / oriented.width, rotation: displayRotation })
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(viewport.width))
        canvas.height = Math.max(1, Math.round(viewport.height))
        await page.render({ canvas, viewport }).promise
        sides.push({
          id: `${sourceId}:${pageIndex}`,
          sourceId,
          kind: 'pdf',
          pageIndex,
          pdfRotationDegrees: (360 - displayRotation) % 360,
          autoRotated,
          label: `Page ${pageIndex + 1} · ${file.name}`,
          thumbnailUrl: canvas.toDataURL('image/png'),
          width: oriented.width,
          height: oriented.height,
        })
        page.cleanup()
      }
    } finally {
      await loadingTask.destroy()
    }
    return { sides, file: { kind: 'pdf', bytes } }
  }

  if (isImage(file)) {
    const image = await imageToPng(file)
    return {
      sides: [{
        id: `${sourceId}:0`,
        sourceId,
        kind: 'image',
        label: file.name,
        thumbnailUrl: image.thumbnailUrl,
        width: image.width,
        height: image.height,
      }],
      file: { kind: 'image', bytes: image.bytes },
    }
  }

  throw new Error('Use a PDF, PNG, JPEG, or WebP file')
}

export async function renderLargePreview(side: SourceSide, source: SourceFile) {
  if (side.kind === 'image') return side.thumbnailUrl
  if (source.kind !== 'pdf') throw new Error('The PDF source is unavailable')

  const loadingTask = pdfjs.getDocument({ data: source.bytes.slice() })
  try {
    const document = await loadingTask.promise
    const page = await document.getPage((side.pageIndex ?? 0) + 1)
    if (side.cropBox) {
      const orientedWidth = side.autoRotated ? side.cropBox.top - side.cropBox.bottom : side.cropBox.right - side.cropBox.left
      const { canvas, viewport } = await renderPageCanvas(page, 1200 / orientedWidth)
      const imageUrl = renderCroppedCanvas(canvas, viewport, side.cropBox, 1200)
      page.cleanup()
      return imageUrl
    }
    const rotation = (360 - (side.pdfRotationDegrees ?? 0)) % 360
    const natural = page.getViewport({ scale: 1, rotation })
    const viewport = page.getViewport({ scale: 1600 / natural.width, rotation })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(viewport.width))
    canvas.height = Math.max(1, Math.round(viewport.height))
    await page.render({ canvas, viewport }).promise
    const imageUrl = canvas.toDataURL('image/png')
    page.cleanup()
    return imageUrl
  } finally {
    await loadingTask.destroy()
  }
}
