export type LogoRotation = 0 | 90 | 180 | 270

export interface LogoSettings {
  horizontal: number
  vertical: number
  size: number
  rotation: LogoRotation
  color: string | null
}

export type ReverseBackground =
  | { kind: 'upload'; file: File }
  | { kind: 'builtin'; url: string }
  | { kind: 'color'; color: string }

const CARD_WIDTH_PX = 1815
const CARD_HEIGHT_PX = 1050

export async function createReverseDesign(
  backgroundSource: ReverseBackground,
  logoFile: File | null,
  logoSettings: LogoSettings,
) {
  let background: ImageBitmap | null = null
  let logo: ImageBitmap | null = null
  try {
    if (backgroundSource.kind === 'upload') background = await createImageBitmap(backgroundSource.file)
    if (backgroundSource.kind === 'builtin') {
      const response = await fetch(backgroundSource.url)
      if (!response.ok) throw new Error('Included background could not be loaded')
      background = await createImageBitmap(await response.blob())
    }
    if (logoFile) logo = await createImageBitmap(logoFile)
    const canvas = document.createElement('canvas')
    canvas.width = CARD_WIDTH_PX
    canvas.height = CARD_HEIGHT_PX
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')

    if (background) {
      // Fill the card without stretching the image; crop any excess at the edges.
      const backgroundScale = Math.max(canvas.width / background.width, canvas.height / background.height)
      const backgroundWidth = background.width * backgroundScale
      const backgroundHeight = background.height * backgroundScale
      context.drawImage(
        background,
        (canvas.width - backgroundWidth) / 2,
        (canvas.height - backgroundHeight) / 2,
        backgroundWidth,
        backgroundHeight,
      )
    } else if (backgroundSource.kind === 'color') {
      context.fillStyle = backgroundSource.color
      context.fillRect(0, 0, canvas.width, canvas.height)
    }

    if (logo) {
      let logoImage: CanvasImageSource = logo
      if (logoSettings.color) {
        const tintedLogo = document.createElement('canvas')
        tintedLogo.width = logo.width
        tintedLogo.height = logo.height
        const tintedContext = tintedLogo.getContext('2d')
        if (!tintedContext) throw new Error('Canvas is unavailable')
        tintedContext.drawImage(logo, 0, 0)
        tintedContext.globalCompositeOperation = 'source-in'
        tintedContext.fillStyle = logoSettings.color
        tintedContext.fillRect(0, 0, logo.width, logo.height)
        logoImage = tintedLogo
      }
      const third = canvas.width / 3
      const sideways = logoSettings.rotation === 90 || logoSettings.rotation === 270
      const rotatedWidth = sideways ? logo.height : logo.width
      const rotatedHeight = sideways ? logo.width : logo.height
      const baseScale = Math.min(third / rotatedWidth, canvas.height * 0.82 / rotatedHeight)
      const scale = Math.min(
        baseScale * logoSettings.size / 100,
        canvas.width * 0.96 / rotatedWidth,
        canvas.height * 0.96 / rotatedHeight,
      )
      const logoWidth = rotatedWidth * scale
      const logoHeight = rotatedHeight * scale
      const centerX = logoWidth / 2 + (canvas.width - logoWidth) * logoSettings.horizontal / 100
      const centerY = logoHeight / 2 + (canvas.height - logoHeight) * logoSettings.vertical / 100
      context.save()
      context.translate(centerX, centerY)
      context.rotate(logoSettings.rotation * Math.PI / 180)
      context.drawImage(logoImage, -logo.width * scale / 2, -logo.height * scale / 2, logo.width * scale, logo.height * scale)
      context.restore()
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Reverse image conversion failed')), 'image/png')
    })
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      thumbnailUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    background?.close()
    logo?.close()
  }
}
