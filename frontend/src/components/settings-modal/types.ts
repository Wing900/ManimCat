export type TabType = 'api' | 'video';

export interface TestResult {
  status: 'idle' | 'testing' | 'success' | 'error';
  message: string;
  details?: {
    statusCode?: number;
    statusText?: string;
    responseBody?: string;
    headers?: Record<string, string>;
    duration?: number;
    error?: string;
  };
}
