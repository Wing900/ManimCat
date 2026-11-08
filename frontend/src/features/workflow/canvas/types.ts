import type { CanvasObject } from './objects/types';
export type { Point, StrokeObject, CanvasObject, ShapeKind } from './objects/types';
export type ToolMode = 'select' | 'pen' | 'eraser' | 'shape';

export interface CanvasPage {
  id: string;
  objects: CanvasObject[];
}

export interface PreviewImage {
  id: string;
  dataUrl: string;
}
