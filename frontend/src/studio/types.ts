export interface StudioAssetItem {
  id: string;
  title: string;
  meta: string;
  state?: 'ready' | 'editing' | 'draft';
}

export interface StudioTaskItem {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'queued';
  detail: string;
  progress?: number;
}

export interface StudioMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  formula?: string;
  code?: string;
}
