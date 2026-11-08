import type { CanvasObject, CanvasPage } from './types';

const HISTORY_LIMIT = 100;

interface DocumentSnapshot {
  pages: CanvasPage[];
  activePageId: string;
  selectedId: string | null;
  isDirty: boolean;
}

export interface CanvasHistory {
  present: DocumentSnapshot;
  past: DocumentSnapshot[];
  future: DocumentSnapshot[];
  transaction: DocumentSnapshot | null;
  revision: number;
}

type Action =
  | { type: 'selectObject'; id: string | null }
  | { type: 'selectPage'; id: string }
  | { type: 'updateObjects'; update: (objects: CanvasObject[]) => CanvasObject[] }
  | { type: 'saveObject'; object: CanvasObject }
  | { type: 'deleteSelected' }
  | { type: 'addPage'; page: CanvasPage }
  | { type: 'deletePage'; replacement: CanvasPage }
  | { type: 'reset'; page: CanvasPage }
  | { type: 'beginTransaction' | 'commitTransaction' | 'cancelTransaction' | 'undo' | 'redo' };

export function createCanvasHistory(page: CanvasPage): CanvasHistory {
  return {
    present: { pages: [page], activePageId: page.id, selectedId: null, isDirty: false },
    past: [], future: [], transaction: null, revision: 0,
  };
}

function pushPast(past: DocumentSnapshot[], snapshot: DocumentSnapshot) {
  return [...past.slice(-(HISTORY_LIMIT - 1)), snapshot];
}

function commit(state: CanvasHistory, present: DocumentSnapshot): CanvasHistory {
  if (present.pages === state.present.pages) return { ...state, present };
  if (state.transaction) return { ...state, present };
  return { ...state, present, past: pushPast(state.past, state.present), future: [] };
}

function replaceObjects(present: DocumentSnapshot, objects: CanvasObject[]): DocumentSnapshot {
  const page = present.pages.find((p) => p.id === present.activePageId)!;
  if (objects === page.objects) return present;
  return {
    ...present, isDirty: true,
    pages: present.pages.map((p) => p.id === page.id ? { ...p, objects } : p),
  };
}

/** Immutable snapshots share unchanged pages/objects; transient edits can be grouped. */
export function canvasHistoryReducer(state: CanvasHistory, action: Action): CanvasHistory {
  const { present } = state;
  switch (action.type) {
    case 'selectObject': return { ...state, present: { ...present, selectedId: action.id } };
    case 'selectPage':
      return present.pages.some((p) => p.id === action.id)
        ? { ...state, present: { ...present, activePageId: action.id, selectedId: null } } : state;
    case 'updateObjects': {
      const page = present.pages.find((p) => p.id === present.activePageId)!;
      return commit(state, replaceObjects(present, action.update(page.objects)));
    }
    case 'saveObject': {
      const page = present.pages.find((p) => p.id === present.activePageId)!;
      const existing = page.objects.find((o) => o.id === action.object.id);
      const objects = existing === action.object ? page.objects : existing
        ? page.objects.map((o) => o.id === action.object.id ? action.object : o)
        : [...page.objects, action.object];
      return commit(state, { ...replaceObjects(present, objects), selectedId: action.object.id });
    }
    case 'deleteSelected': {
      const page = present.pages.find((p) => p.id === present.activePageId)!;
      if (!page.objects.some((o) => o.id === present.selectedId)) return state;
      return commit(state, { ...replaceObjects(present, page.objects.filter((o) => o.id !== present.selectedId)), selectedId: null });
    }
    case 'addPage': return commit(state, {
      pages: [...present.pages, action.page], activePageId: action.page.id, selectedId: null, isDirty: true,
    });
    case 'deletePage': {
      const index = present.pages.findIndex((p) => p.id === present.activePageId);
      const pages = present.pages.length === 1 ? [action.replacement] : present.pages.filter((p) => p.id !== present.activePageId);
      return commit(state, { pages, activePageId: pages[Math.max(0, index - 1)].id, selectedId: null, isDirty: true });
    }
    case 'beginTransaction': return state.transaction ? state : { ...state, transaction: present };
    case 'commitTransaction':
      if (!state.transaction) return state;
      return present.pages === state.transaction.pages ? { ...state, transaction: null } : {
        ...state, transaction: null, past: pushPast(state.past, state.transaction), future: [],
      };
    case 'cancelTransaction':
      return state.transaction ? { ...state, present: state.transaction, transaction: null } : state;
    case 'undo': {
      // An in-progress transaction is one undoable edit, even before pointerup.
      const changed = state.transaction && present.pages !== state.transaction.pages;
      const previous = changed ? state.transaction : state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state, present: previous, transaction: null, revision: state.revision + 1,
        past: changed ? state.past : state.past.slice(0, -1),
        future: [present, ...state.future].slice(0, HISTORY_LIMIT),
      };
    }
    case 'redo': {
      if (!state.future.length || (state.transaction && present.pages !== state.transaction.pages)) return state;
      return {
        ...state, present: state.future[0], future: state.future.slice(1), transaction: null,
        past: pushPast(state.past, present), revision: state.revision + 1,
      };
    }
    case 'reset': return { ...createCanvasHistory(action.page), revision: state.revision + 1 };
  }
}
