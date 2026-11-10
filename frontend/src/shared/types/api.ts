// API 类型定义

/** 视频质量选项 */
export type Quality = 'low' | 'medium' | 'high';
export type OutputMode = 'video' | 'image';
export type PromptLocale = 'zh-CN' | 'en-US';
export type ProblemFramingMode = 'clarify' | 'invent';

/** 渲染位置。云端为兼容默认值；浏览器为 Workflow 视频的本地渲染目标。 */
export type RenderTarget = 'cloud' | 'browser';

/** 图片细节级别 */
export type VisionImageDetail = 'auto' | 'low' | 'high';

/** 参考图片 */
export interface ReferenceImage {
  url: string;
  detail?: VisionImageDetail;
}

/** Original user input, including every attached reference image. */
export interface ConceptInput {
  concept: string;
  referenceImages?: ReferenceImage[];
}

export interface CustomApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

/** 角色类型 */
export type RoleType = 'problemFraming' | 'conceptDesigner' | 'codeGeneration' | 'narration' | 'codeRetry' | 'codeEdit';

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

/** 旁白配音配置。默认关闭；开启后由 Workflow 自动生成旁白并合轨。 */
export interface NarrationConfig {
  enabled: boolean;
  voice: string;
  rate: string;
}

/** 视频配置 */
export interface VideoConfig {
  /** 默认质量 */
  quality: Quality;
  /** 帧率 */
  frameRate: number;
  /** 超时时间（秒），默认 1200 秒（20 分钟） */
  timeout?: number;
  /** 旁白配音 */
  narration?: NarrationConfig;
  /** 下载时把字幕烧录进画面（单独产出，预览不受影响） */
  burnSubtitles?: boolean;
}

/** 本地产品设置。连接凭据不再放这里，见 features/connection 的 manimcat_connection。 */
export interface RenderingConfig {
  /** 云端仍是默认值；浏览器设置只影响 Workflow 视频。 */
  target: RenderTarget;
}

export interface SettingsConfig {
  video: VideoConfig;
  /** 旧 blob 可能没有这一节；loadSettings 会把它规范化为 cloud。 */
  rendering?: RenderingConfig;
}

/** 任务状态 */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

/** 处理阶段 */
export type ProcessingStage =
  | 'queued'
  | 'analyzing'
  | 'designing'
  | 'generating'
  | 'narrating'
  | 'refining'
  | 'rendering'
  | 'muxing'
  | 'retrying'
  | 'still-rendering';

export interface JobStageHistoryEntry {
  stage: ProcessingStage;
  started_at: string;
  ended_at: string;
  duration_ms: number;
}

export interface JobTimings {
  queue?: number;
  analyze?: number;
  generate?: number;
  edit?: number;
  retry?: number;
  render?: number;
  mux?: number;
  store?: number;
  total?: number;
}

export interface JobTokenUsageCall {
  label: string;
  model?: string;
  mode: 'stream' | 'stream-partial' | 'non-stream';
  maxTokens?: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface JobTokenUsageSummary {
  totals: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    measuredCalls: number;
    unmeasuredCalls: number;
  };
  calls: JobTokenUsageCall[];
}

/** 生成请求 */
export interface GenerateRequest extends ConceptInput {
  problemPlan?: ProblemFramingPlan;
  outputMode: OutputMode;
  quality?: Quality;
  /** 预生成的代码（使用自定义 AI 时） */
  code?: string;
  /** 视频配置 */
  videoConfig?: VideoConfig;
  /** Prompt overrides */
  promptOverrides?: PromptOverrides;
  customApiConfig?: CustomApiConfig;
  renderCacheKey?: string;
  /** 提交时捕获的渲染位置，后台后续阶段只读这个值。 */
  renderTarget?: RenderTarget;
}

export interface ProblemFramingStep {
  title: string;
  content: string;
  phase?: 'background' | 'phenomenon' | 'derivation' | 'closing';
}

export interface ProblemFramingPlan {
  mode: ProblemFramingMode;
  headline: string;
  summary: string;
  steps: ProblemFramingStep[];
  visualMotif: string;
  designerHint: string;
  question?: string;
  answer?: string;
  audience?: string;
  backgroundRules?: string;
  selectedRoute?: string;
  alternativeRoutes?: string;
  outOfScope?: string;
  specialCases?: string;
}

export interface ProblemFramingRequest extends ConceptInput {
  feedback?: string;
  feedbackHistory?: string[];
  locale?: PromptLocale;
  currentPlan?: ProblemFramingPlan;
  promptOverrides?: PromptOverrides;
  customApiConfig?: CustomApiConfig;
}

export interface ProblemFramingResponse {
  success: boolean;
  plan: ProblemFramingPlan;
}

/** AI 修改请求 */
export interface ModifyRequest extends ConceptInput {
  outputMode: OutputMode;
  quality?: Quality;
  instructions: string;
  code: string;
  videoConfig?: VideoConfig;
  promptOverrides?: PromptOverrides;
  customApiConfig?: CustomApiConfig;
  renderCacheKey?: string;
  renderTarget?: RenderTarget;
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
  stage_started_at?: string | null;
  stage_history?: JobStageHistoryEntry[];
  message?: string;
  success?: boolean;
  submitted_at?: string;
  finished_at?: string;
  updated_at?: string;
  revision?: number;
  attempt?: number;
  output_mode?: OutputMode;
  /** 云端任务返回媒体 URL；浏览器任务返回可移植 payload，二者不要混淆。 */
  render_target?: RenderTarget;
  browser_render?: BrowserRenderPreparedPayload | null;
  video_url?: string | null;
  hardsub_url?: string | null;
  image_urls?: string[];
  image_count?: number;
  code?: string;
  used_ai?: boolean;
  render_quality?: string;
  generation_type?: string;
  render_peak_memory_mb?: number;
  timings?: JobTimings;
  token_usage?: JobTokenUsageSummary;

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

/** Browser-render DTO: paths stay on the server; the host receives a same-origin URL. */
export interface BrowserRenderCueManifest {
  version: 1;
  duration: number;
  cues: Record<string, number>;
  segments?: Array<{
    id: string;
    start: number;
    duration: number;
    cues?: Record<string, number>;
  }>;
}

export interface BrowserRenderNarrationPayload {
  manifest: BrowserRenderCueManifest;
  audioUrl: string;
  mimeType: 'audio/wav';
  byteLength: number;
  /** SHA-256 of the exact published bytes; also the immutable asset identity in audioUrl. */
  sha256: string;
}

/** One independent image-mode source block, already parsed and ordered by index. */
export interface BrowserRenderImageBlock {
  index: number;
  source: string;
}

interface BrowserRenderPreparedBase {
  frameRate: number;
  resolution: { width: number; height: number };
  quality: Quality;
}

/** Video browser take: playable, optionally narrated, never an MP4 artifact. */
export interface BrowserRenderVideoPreparedPayload extends BrowserRenderPreparedBase {
  /** Optional only for payloads stored before image output existed. */
  outputMode?: 'video';
  source: string;
  sceneName?: string;
  narration?: BrowserRenderNarrationPayload;
}

/** Image browser result: ordered source blocks; never narration and never an MP4. */
export interface BrowserRenderImagePreparedPayload extends BrowserRenderPreparedBase {
  outputMode: 'image';
  blocks: BrowserRenderImageBlock[];
}

export type BrowserRenderPreparedPayload =
  | BrowserRenderVideoPreparedPayload
  | BrowserRenderImagePreparedPayload;

export function isBrowserImagePayload(
  payload: BrowserRenderPreparedPayload | null | undefined,
): payload is BrowserRenderImagePreparedPayload {
  return Boolean(
    payload &&
      payload.outputMode === 'image' &&
      Array.isArray((payload as BrowserRenderImagePreparedPayload).blocks),
  );
}

export function isBrowserVideoPayload(
  payload: BrowserRenderPreparedPayload | null | undefined,
): payload is BrowserRenderVideoPreparedPayload {
  return Boolean(
    payload &&
      payload.outputMode !== 'image' &&
      typeof (payload as BrowserRenderVideoPreparedPayload).source === 'string',
  );
}

/** API 错误 */
export interface ApiError {
  error: string;
}
