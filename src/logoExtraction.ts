import type { PDFPageProxy } from 'pdfjs-dist'

export interface ExtractedLogo {
  file: File
  previewUrl: string
}

export async function extractTeamLogo(page: PDFPageProxy, sourceName: string): Promise<ExtractedLogo | null> {
  if (page.rotate !== 0) return null

  // The official team sheets put the orange emblem outside the card grid,
  // within the top-left 115 pt square of the first page.
  const scale = 4
  const region = Math.min(115, page.view[2] - page.view[0], page.view[3] - page.view[1])
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(region * scale)
  canvas.height = Math.round(region * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable')
  await page.render({ canvas, viewport: page.getViewport({ scale }) }).promise

  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  let left = canvas.width
  let top = canvas.height
  let right = -1
  let bottom = -1
  let strongPixels = 0
  let totalRed = 0
  let totalGreen = 0
  let totalBlue = 0

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      if (red - green < 65 || green - blue < 20 || red < 170 || blue > 145) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
      totalRed += red
      totalGreen += green
      totalBlue += blue
      strongPixels++
    }
  }
  if (strongPixels < 150 || right - left < 35 || bottom - top < 35) return null

  const padding = 6
  left = Math.max(0, left - padding)
  top = Math.max(0, top - padding)
  right = Math.min(canvas.width - 1, right + padding)
  bottom = Math.min(canvas.height - 1, bottom + padding)
  const logo = document.createElement('canvas')
  logo.width = right - left + 1
  logo.height = bottom - top + 1
  const logoContext = logo.getContext('2d')
  if (!logoContext) throw new Error('Canvas is unavailable')
  const output = logoContext.createImageData(logo.width, logo.height)
  const orangeRed = Math.round(totalRed / strongPixels)
  const orangeGreen = Math.round(totalGreen / strongPixels)
  const orangeBlue = Math.round(totalBlue / strongPixels)
  const orangeDifference = Math.max(1, orangeRed - orangeGreen - 8)
  for (let y = 0; y < logo.height; y++) {
    for (let x = 0; x < logo.width; x++) {
      const sourceOffset = ((top + y) * canvas.width + left + x) * 4
      const targetOffset = (y * logo.width + x) * 4
      const red = pixels[sourceOffset]
      const green = pixels[sourceOffset + 1]
      const blue = pixels[sourceOffset + 2]
      if (red - green < 12 || green - blue < 5 || red - blue < 25) continue
      output.data[targetOffset] = orangeRed
      output.data[targetOffset + 1] = orangeGreen
      output.data[targetOffset + 2] = orangeBlue
      output.data[targetOffset + 3] = Math.min(255, Math.round(255 * (red - green - 8) / orangeDifference))
    }
  }
  logoContext.putImageData(output, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    logo.toBlob(value => value ? resolve(value) : reject(new Error('Logo conversion failed')), 'image/png')
  })
  return {
    file: new File([blob], `${sourceName.replace(/\.pdf$/i, '')}-logo.png`, { type: 'image/png' }),
    previewUrl: logo.toDataURL('image/png'),
  }
}
