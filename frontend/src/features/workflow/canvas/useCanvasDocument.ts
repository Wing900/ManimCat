import { useCallback, useReducer } from 'react';
import { createPage } from './constants';
import { canvasHistoryReducer, createCanvasHistory } from './canvas-history';
import type { CanvasObject, CanvasPage } from './types';

export function useCanvasDocument() {
  const [history, dispatch] = useReducer(canvasHistoryReducer, undefined, () => createCanvasHistory(createPage()));
  const reset = useCallback(() => dispatch({ type: 'reset', page: createPage() }), []);
  const selectObject = useCallback((id: string | null) => dispatch({ type: 'selectObject', id }), []);
  const selectPage = useCallback((id: string) => dispatch({ type: 'selectPage', id }), []);
  const updateObjects = useCallback((update: (objects: CanvasObject[]) => CanvasObject[]) => dispatch({ type: 'updateObjects', update }), []);
  const saveObject = useCallback((object: CanvasObject) => dispatch({ type: 'saveObject', object }), []);
  const deleteSelected = useCallback(() => dispatch({ type: 'deleteSelected' }), []);
  const addPage = useCallback(() => dispatch({ type: 'addPage', page: createPage() }), []);
  const deletePage = useCallback(() => dispatch({ type: 'deletePage', replacement: createPage() }), []);
  const beginTransaction = useCallback(() => dispatch({ type: 'beginTransaction' }), []);
  const commitTransaction = useCallback(() => dispatch({ type: 'commitTransaction' }), []);
  const cancelTransaction = useCallback(() => dispatch({ type: 'cancelTransaction' }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const activePage: CanvasPage = history.present.pages.find((p) => p.id === history.present.activePageId)!;
  const transactionChanged = !!history.transaction && history.present.pages !== history.transaction.pages;
  return {
    ...history.present, activePage, historyRevision: history.revision,
    canUndo: transactionChanged || history.past.length > 0,
    canRedo: !transactionChanged && history.future.length > 0,
    reset, selectPage, selectObject, saveObject, updateObjects, deleteSelected, addPage, deletePage,
    beginTransaction, commitTransaction, cancelTransaction, undo, redo,
  };
}
