export type ToolMode = 'select' | 'pen' | 'eraser';

export interface Point {
  x: number;
  y: number;
}

export interface StrokeObject {
  id: string;
  color: string;
  width: number;
  points: Point[];
}

export interface CanvasPage {
  id: string;
  strokes: StrokeObject[];
}

export interface PreviewImage {
  id: string;
  dataUrl: string;
}
