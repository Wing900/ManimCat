export type ExportFormat = 'png' | 'svg' | 'pdf'

interface ImageAsset {
  blob: Blob
  mimeType: string
  dataUrl: string
}

interface ImageDimensions {
  width: number
  height: number
}

export async function exportImageAsset(input: {
  source: string
  format: ExportFormat
  index?: number
  fallbackName?: string
}): Promise<void> {
  const asset = await readImageAsset(input.source)
  const dimensions = await resolveImageDimensions(input.source)
  const filename = buildExportFilename(input.source, input.index ?? 0, input.format, input.fallbackName)

  if (input.format === 'png') {
    const pngBlob = await createPngBlob(asset, dimensions)
    downloadBlob(pngBlob, filename)
    return
  }

  if (input.format === 'svg') {
    const svgBlob = await createSvgBlob(asset, dimensions)
    downloadBlob(svgBlob, filename)
    return
  }

  const pdfBlob = await createPdfBlob(asset, dimensions)
  downloadBlob(pdfBlob, filename)
}

export async function copyImageAssetToClipboard(input: {
  source: string
  format: Exclude<ExportFormat, 'pdf'>
}): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard image copy is not supported in this browser')
  }

  const asset = await readImageAsset(input.source)
  const dimensions = await resolveImageDimensions(input.source)
  const blob = input.format === 'png'
    ? await createPngBlob(asset, dimensions)
    : await createSvgBlob(asset, dimensions)

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob,
    }),
  ])
}

export function buildDownloadName(input: {
  source: string
  index?: number
  extension: string
  fallbackName?: string
}): string {
  return buildExportFilename(input.source, input.index ?? 0, input.extension as ExportFormat, input.fallbackName)
}

async function readImageAsset(source: string): Promise<ImageAsset> {
  if (source.startsWith('data:')) {
    const [header, base64Part = ''] = source.split(',', 2)
    const mimeType = header.match(/^data:([^;]+)/)?.[1] || 'image/png'
    const bytes = Uint8Array.from(atob(base64Part), (char) => char.charCodeAt(0))
    const blob = new Blob([bytes], { type: mimeType })
    return { blob, mimeType, dataUrl: source }
  }

  const response = await fetch(getAbsoluteUrl(source))
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`)
  }
  const blob = await response.blob()
  const mimeType = blob.type || inferMimeTypeFromUrl(source)
  const dataUrl = await blobToDataUrl(blob)
  return { blob, mimeType, dataUrl }
}

async function resolveImageDimensions(source: string): Promise<ImageDimensions> {
  const image = new Image()
  image.decoding = 'async'
  image.src = getAbsoluteUrl(source)

  await image.decode()
  return {
    width: Math.max(1, image.naturalWidth || image.width || 1),
    height: Math.max(1, image.naturalHeight || image.height || 1),
  }
}

async function createPngBlob(asset: ImageAsset, dimensions: ImageDimensions): Promise<Blob> {
  if (asset.mimeType === 'image/png') {
    return asset.blob
  }

  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  const image = await loadImage(asset.dataUrl)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return await canvasToBlob(canvas, 'image/png')
}

async function createSvgBlob(asset: ImageAsset, dimensions: ImageDimensions): Promise<Blob> {
  if (asset.mimeType === 'image/svg+xml') {
    return asset.blob
  }

  const markup = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">`,
    `  <image href="${escapeXmlAttribute(asset.dataUrl)}" width="${dimensions.width}" height="${dimensions.height}" preserveAspectRatio="xMidYMid meet" />`,
    `</svg>`,
  ].join('\n')

  return new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
}

async function createPdfBlob(asset: Pick<ImageAsset, 'dataUrl'>, dimensions: ImageDimensions): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context is unavailable')
  }

  const image = await loadImage(asset.dataUrl)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.96)
  const jpegBytes = dataUrlToUint8Array(jpegDataUrl)

  const pageWidth = Math.max(1, Math.round((dimensions.width * 72) / 96))
  const pageHeight = Math.max(1, Math.round((dimensions.height * 72) / 96))
  const contentStream = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ`

  const objects: Uint8Array[] = [
    encodeText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    encodeText('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    encodeText(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
    ),
    encodeText(`4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`),
    concatUint8Arrays([
      encodeText(
        `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${dimensions.width} /Height ${dimensions.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
      ),
      jpegBytes,
      encodeText('\nendstream\nendobj\n'),
    ]),
  ]

  const header = encodeText('%PDF-1.4\n%\u00ff\u00ff\u00ff\u00ff\n')
  const bodyParts: Uint8Array[] = [header]
  const offsets: number[] = [0]
  let currentOffset = header.length

  for (const object of objects) {
    offsets.push(currentOffset)
    bodyParts.push(object)
    currentOffset += object.length
  }

  const xrefStart = currentOffset
  const xrefLines = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ']
  for (let index = 1; index < offsets.length; index += 1) {
    xrefLines.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `)
  }
  const xref = encodeText(`${xrefLines.join('\n')}\n`)
  const trailer = encodeText(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)

  return new Blob([...bodyParts, xref, trailer], { type: 'application/pdf' })
}

function buildExportFilename(source: string, index: number, format: ExportFormat, fallbackName?: string) {
  const base = sanitizeBasename(fallbackName) || extractSourceBasename(source) || `image-${index + 1}`
  const normalizedBase = base.replace(/\.[a-z0-9]+$/i, '')
  return `${normalizedBase}.${format}`
}

function sanitizeBasename(name?: string) {
  if (!name) {
    return ''
  }

  return name.split(/[\\/]/).pop()?.trim() ?? ''
}

function extractSourceBasename(source: string) {
  if (source.startsWith('data:')) {
    return ''
  }

  try {
    const url = new URL(getAbsoluteUrl(source))
    const raw = url.pathname.split('/').pop() || ''
    return decodeURIComponent(raw)
  } catch {
    return ''
  }
}

function inferMimeTypeFromUrl(source: string) {
  if (/\.svg($|\?)/i.test(source)) {
    return 'image/svg+xml'
  }
  if (/\.jpe?g($|\?)/i.test(source)) {
    return 'image/jpeg'
  }
  if (/\.webp($|\?)/i.test(source)) {
    return 'image/webp'
  }
  if (/\.gif($|\?)/i.test(source)) {
    return 'image/gif'
  }
  return 'image/png'
}

function getAbsoluteUrl(url: string): string {
  if (/^(data:|https?:\/\/)/i.test(url)) {
    return url
  }
  return new URL(url, window.location.origin).toString()
}

function downloadBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.readAsDataURL(blob)
  })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to decode image'))
    image.src = source
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(`Failed to export canvas as ${type}`))
        return
      }
      resolve(blob)
    }, type)
  })
}

function dataUrlToUint8Array(dataUrl: string) {
  const base64 = dataUrl.split(',', 2)[1] ?? ''
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

function encodeText(text: string) {
  return new TextEncoder().encode(text)
}

function concatUint8Arrays(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  return merged
}

function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
