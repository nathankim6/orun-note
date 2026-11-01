export type PdfPageSize = { width: number; height: number };
export type PdfInfo = { pageCount: number; pages: PdfPageSize[]; title?: string };
export type PdfOutlineItem = { title: string; pageIndex: number; level: number };
