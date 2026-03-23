// API 类型定义

/** 视频质量选项 */
export type Quality = 'low' | 'medium' | 'high';
export type OutputMode = 'video' | 'image';
export type PromptLocale = 'zh-CN' | 'en-US';
export type ProblemFramingMode = 'clarify' | 'invent';

/** 图片细节级别 */
export type VisionImageDetail = 'auto' | 'low' | 'high';

/** 参考图片 */
export interface ReferenceImage {
  url: string;
  detail?: VisionImageDetail;
}

/** API 配置 */
export interface ApiConfig {
  manimcatApiKey: string;
  providers: AIProvider[];
  activeProviderId: string | null;
}

export interface CustomApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export type AIProviderType = 'openai' | 'google';

export interface AIProvider {
  id: string;
  name: string;
  type: AIProviderType;
  apiUrl: string;
  apiKey: string;
  model: string;
}

/** 角色类型 */
export type RoleType = 'problemFraming' | 'conceptDesigner' | 'codeGeneration' | 'codeRetry' | 'codeEdit';

/** 共享模块类型 */
export type SharedModuleType = 'apiIndex' | 'specification';

/** 提示词默认值（从服务端获取） */
export interface PromptDefaults {
  roles: Record<RoleType, { system: string; user: string }>;
  shared: Record<SharedModuleType, string>;
}

/** 提示词覆盖配置（用户自定义） */
export interface PromptOverrides {
  locale?: PromptLocale;
  roles?: Partial<Record<RoleType, { system?: string; user?: string }>>;
  shared?: Partial<Record<SharedModuleType, string>>;
}

/** 视频配置 */
export interface VideoConfig {
  /** 默认质量 */
  quality: Quality;
  /** 帧率 */
  frameRate: number;
  /** 超时时间（秒），默认 1200 秒（20 分钟） */
  timeout?: number;
  /** 是否添加背景音乐 */
  bgm?: boolean;
}

/** 设置配置 */
export interface SettingsConfig {
  api: ApiConfig;
  video: VideoConfig;
}

/** 任务状态 */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

/** 处理阶段 */
export type ProcessingStage = 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering';

export interface JobTimings {
  analyze?: number;
  edit?: number;
  retry?: number;
  render?: number;
  store?: number;
  total?: number;
}

/** 生成请求 */
export interface GenerateRequest {
  concept: string;
  problemPlan?: ProblemFramingPlan;
  outputMode: OutputMode;
  quality?: Quality;
  /** 参考图片 */
  referenceImages?: ReferenceImage[];
  /** 预生成的代码（使用自定义 AI 时） */
  code?: string;
  /** 视频配置 */
  videoConfig?: VideoConfig;
  /** Prompt overrides */
  promptOverrides?: PromptOverrides;
  customApiConfig?: CustomApiConfig;
  renderCacheKey?: string;
}

export interface ProblemFramingStep {
  title: string;
  content: string;
}

export interface ProblemFramingPlan {
  mode: ProblemFramingMode;
  headline: string;
  summary: string;
  steps: ProblemFramingStep[];
  visualMotif: string;
  designerHint: string;
}

export interface ProblemFramingRequest {
  concept: string;
  feedback?: string;
  feedbackHistory?: string[];
  locale?: PromptLocale;
  currentPlan?: ProblemFramingPlan;
  referenceImages?: ReferenceImage[];
  promptOverrides?: PromptOverrides;
  customApiConfig?: CustomApiConfig;
}

export interface ProblemFramingResponse {
  success: boolean;
  plan: ProblemFramingPlan;
}

/** AI 修改请求 */
export interface ModifyRequest {
  concept: string;
  outputMode: OutputMode;
  quality?: Quality;
  instructions: string;
  code: string;
  videoConfig?: VideoConfig;
  promptOverrides?: PromptOverrides;
  customApiConfig?: CustomApiConfig;
  renderCacheKey?: string;
}

/** 生成响应 */
export interface GenerateResponse {
  success: boolean;
  jobId: string;
  message: string;
  status: JobStatus;
  submittedAt: string;
}

/** 任务结果 */
export interface JobResult {
  jobId: string;
  status: JobStatus;
  stage?: ProcessingStage;
  message?: string;
  success?: boolean;
  submitted_at?: string;
  finished_at?: string;
  updated_at?: string;
  revision?: number;
  attempt?: number;
  output_mode?: OutputMode;
  video_url?: string | null;
  image_urls?: string[];
  image_count?: number;
  code?: string;
  used_ai?: boolean;
  render_quality?: string;
  generation_type?: string;
  render_peak_memory_mb?: number;
  timings?: JobTimings;

  error?: string;
  details?: string;
  cancel_reason?: string;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  total: number;
}

export interface UsageDailyPoint {
  date: string;
  submittedTotal: number;
  submittedGenerate: number;
  submittedModify: number;
  completedTotal: number;
  failedTotal: number;
  cancelledTotal: number;
  completedVideo: number;
  completedImage: number;
  renderMsSum: number;
  successRate: number;
  avgRenderMs: number;
}

export interface UsageTotals {
  submittedTotal: number;
  submittedGenerate: number;
  submittedModify: number;
  completedTotal: number;
  failedTotal: number;
  cancelledTotal: number;
  completedVideo: number;
  completedImage: number;
  renderMsSum: number;
  successRate: number;
  avgRenderMs: number;
}

export interface UsageMetricsResponse {
  timestamp: string;
  rangeDays: number;
  daily: UsageDailyPoint[];
  totals: UsageTotals;
  queue: QueueStats;
}

/** API 错误 */
export interface ApiError {
  error: string;
}

/** 历史记录 */
export interface HistoryRecord {
  id: string;
  prompt: string;
  code: string | null;
  output_mode: OutputMode;
  quality: Quality;
  status: 'completed' | 'failed';
  created_at: string;
}

export interface HistoryListResponse {
  records: HistoryRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
