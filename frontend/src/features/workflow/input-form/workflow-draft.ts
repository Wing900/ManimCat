import { useSyncExternalStore } from 'react';
import type { OutputMode, Quality, ReferenceImage } from '../../../shared/types/api';
import { loadSettings } from '../../../infrastructure/storage/settings';

interface WorkflowDraft {
  concept: string;
  referenceImages: ReferenceImage[];
  quality: Quality;
  outputMode: OutputMode;
}

const STORAGE_KEY = 'manimcat_workflow_draft_v1';
const listeners = new Set<() => void>();
let snapshot: WorkflowDraft | undefined;

function emptyDraft(): WorkflowDraft {
  let quality: Quality = 'medium';
  try { quality = loadSettings().video.quality; } catch { /* Storage can be unavailable. */ }
  return { concept: '', referenceImages: [], quality, outputMode: 'video' };
}

function readStoredDraft(): WorkflowDraft {
  const defaults = emptyDraft();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return defaults;
    const saved = raw as Partial<WorkflowDraft>;
    const referenceImages: ReferenceImage[] = [];
    if (Array.isArray(saved.referenceImages)) {
      for (const image of saved.referenceImages) {
        if (!image || typeof image.url !== 'string' || !/^https?:\/\//i.test(image.url)) continue;
        referenceImages.push({
          url: image.url,
          detail: image.detail === 'low' || image.detail === 'high' ? image.detail : 'auto',
        });
      }
    }
    return {
      concept: typeof saved.concept === 'string' ? saved.concept : '',
      referenceImages,
      quality: saved.quality === 'low' || saved.quality === 'medium' || saved.quality === 'high'
        ? saved.quality : defaults.quality,
      outputMode: saved.outputMode === 'image' ? 'image' : 'video',
    };
  } catch {
    return defaults;
  }
}

export function getWorkflowDraft(): WorkflowDraft {
  return snapshot ??= readStoredDraft();
}

export function updateWorkflowDraft(changes: Partial<WorkflowDraft>): void {
  snapshot = { ...getWorkflowDraft(), ...changes };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* Keep the in-memory draft. */ }
  listeners.forEach((notify) => notify());
}

export function clearWorkflowDraft(): void {
  updateWorkflowDraft(emptyDraft());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

/** The draft belongs to the workflow, and survives its input component unmounting. */
export function useWorkflowDraft(): WorkflowDraft {
  return useSyncExternalStore(subscribe, getWorkflowDraft, getWorkflowDraft);
}
