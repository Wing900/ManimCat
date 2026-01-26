/**
 * CORS Middleware
 * 跨域资源共享配置
 */

import cors from 'cors'
import { appConfig } from '../config/app'

/**
 * CORS 中间件配置
 */
export const corsMiddleware = cors({
  origin: appConfig.cors.origin,
  credentials: appConfig.cors.credentials,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400 // 24 小时
})