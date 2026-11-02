export type Rect = { x: number; y: number; w: number; h: number };
export type Tool = 'pen' | 'pencil' | 'highlighter' | 'fountain' | 'brush' | 'eraser' | 'vectorEraser' | 'lasso' | 'shape' | 'text' | 'laser' | 'hand' | 'image';
export type ShapeKind = 'line' | 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'arrow';
export type Point = { x: number; y: number; p?: number };
export type Stroke = { id: string; tool: Tool; color: string; width: number; opacity: number; points: Point[]; shape?: ShapeKind; createdAt: number };
export type TextBox = { id: string; rect: Rect; text: string; color: string; size: number; font?: string; createdAt: number };
export type ImageBox = { id: string; rect: Rect; uri: string; createdAt: number };
export type InkVersion = { id: string; createdAt: string; strokes: Stroke[]; textBoxes: TextBox[]; images?: ImageBox[]; label: string };

export type PdfPage = { index: number; width: number; height: number }; // PDF points
export type Doc = {
  id: string; title: string; fileName: string; uri: string; size: number; pageCount: number; pages: PdfPage[];
  createdAt: string; updatedAt: string; lastOpenedAt?: string; lastPage: number; bookmarks: number[]; folderId?: string; coverColor: string;
  cycle: number; maxCycle: number; subject?: string; tags: string[]; favorite?: boolean; materialId?: string;
  // 'pdf' (default) renders pages from the file; 'blank' is a free-drawing notebook (no file) with a paper template per page.
  kind?: 'pdf' | 'blank'; template?: 'plain' | 'lined' | 'grid' | 'dot';
  // Split documents: pages[i].index points into the source file; the file itself is shared with sourceDocId.
  sourceDocId?: string; coverUri?: string;
};
export type Folder = { id: string; name: string; color: string; createdAt: string };
