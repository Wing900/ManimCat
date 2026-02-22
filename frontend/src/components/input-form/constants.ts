import type { Quality } from '../../types/api';

export const MAX_IMAGES = 3;
export const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB

export const QUALITY_OPTIONS: Array<{ value: Quality; label: string; desc: string }> = [
  { value: 'low', label: '低 (480p)', desc: '最快' },
  { value: 'medium', label: '中 (720p)', desc: '' },
  { value: 'high', label: '高 (1080p)', desc: '最慢' },
];
