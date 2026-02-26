import express from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { asyncHandler } from '../middlewares/error-handler'
import { authMiddleware } from '../middlewares/auth.middleware'
import { ValidationError } from '../utils/errors'

const router = express.Router()

const DEFAULT_MAX_UPLOAD_BYTES = 4 * 1024 * 1024
const configuredUploadLimit = parseInt(process.env.MAX_REFERENCE_IMAGE_UPLOAD_BYTES || '', 10)
const MAX_REFERENCE_IMAGE_UPLOAD_BYTES =
  Number.isFinite(configuredUploadLimit) && configuredUploadLimit > 0
    ? configuredUploadLimit
    : DEFAULT_MAX_UPLOAD_BYTES

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
}

function normalizeMimeType(rawMimeType: string | undefined): string {
  return rawMimeType?.split(';')[0].trim().toLowerCase() || ''
}

function resolvePublicBaseUrl(req: express.Request): string {
  const envBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '')
  if (envBaseUrl) {
    return envBaseUrl
  }

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0].trim()
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0].trim()
  const protocol = forwardedProto || req.protocol
  const host = forwardedHost || req.get('host') || ''
  return host ? `${protocol}://${host}` : ''
}

async function handleReferenceImageUpload(req: express.Request, res: express.Response) {
  const mimeType = normalizeMimeType(req.get('content-type'))
  const extension = MIME_EXTENSION_MAP[mimeType]
  if (!extension) {
    throw new ValidationError('仅支持 PNG/JPEG/WEBP/GIF 图片上传', {
      contentType: req.get('content-type')
    })
  }

  const body = req.body
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new ValidationError('上传内容为空')
  }

  if (body.length > MAX_REFERENCE_IMAGE_UPLOAD_BYTES) {
    throw new ValidationError(`图片大小不能超过 ${Math.floor(MAX_REFERENCE_IMAGE_UPLOAD_BYTES / 1024 / 1024)}MB`)
  }

  const imagesDir = path.join(process.cwd(), 'public', 'images', 'references')
  await fs.mkdir(imagesDir, { recursive: true })

  const fileName = `${uuidv4()}${extension}`
  const filePath = path.join(imagesDir, fileName)
  await fs.writeFile(filePath, body)

  const relativeUrl = `/images/references/${fileName}`
  const baseUrl = resolvePublicBaseUrl(req)
  const url = baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl

  res.status(201).json({
    success: true,
    url,
    relativeUrl,
    mimeType,
    size: body.length
  })
}

router.post(
  '/reference-images',
  authMiddleware,
  express.raw({
    type: 'image/*',
    limit: `${MAX_REFERENCE_IMAGE_UPLOAD_BYTES}b`
  }),
  asyncHandler(handleReferenceImageUpload)
)

export default router
