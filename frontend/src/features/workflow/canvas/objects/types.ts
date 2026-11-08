export interface Point { x: number; y: number }
export interface Bounds { x: number; y: number; width: number; height: number }

export interface ObjectTransform { a: number; b: number; c: number; d: number; e: number; f: number }
interface ObjectStyle { id: string; color: string; width: number; transform?: ObjectTransform }
export interface StrokeObject extends ObjectStyle { kind: 'stroke'; points: Point[] }
export interface EllipseObject extends ObjectStyle {
  kind: 'ellipse'; bounds: Bounds; constrained: boolean;
}
export interface LineObject extends ObjectStyle { kind: 'line' | 'arrow'; start: Point; end: Point }
export interface RectangleObject extends ObjectStyle { kind: 'rectangle'; bounds: Bounds }
export interface PolygonObject extends ObjectStyle { kind: 'polygon'; points: Point[]; closed: boolean }
export interface TextObject extends ObjectStyle {
  kind: 'text'; position: Point; text: string; fontSize: number; boxWidth?: number;
}
export interface PlotSettings {
  expression: string;
  xMin: number; xMax: number; yMin: number; yMax: number;
}
export interface FunctionPlotObject extends ObjectStyle, PlotSettings {
  kind: 'function'; bounds: Bounds;
}
export type CanvasObject = StrokeObject | EllipseObject | LineObject | RectangleObject | PolygonObject | TextObject | FunctionPlotObject;
export type EditableObject = TextObject | FunctionPlotObject;
export type ShapeKind = 'circle' | 'ellipse' | 'line' | 'arrow' | 'rectangle' | 'triangle' | 'polygon' | 'text' | 'function';
