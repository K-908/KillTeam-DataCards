import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { SourceFile, SourceSide } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface ImportResult {
  sides: SourceSide[]
  file: SourceFile
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
