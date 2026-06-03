// Phase F: Marin-PDF コアの型定義を移植。
// 元コード: Marin-PDF-Workspace/src/types.ts
// 変更点:
//   - PM v1 では split / merge / rotate モードは持ち込まない (Phase F スコープ外)
//   - ModeId から split/merge/rotate を削除
import type { PDFDocumentProxy } from "pdfjs-dist";

/** PM v1 で許可するモード。Marin-PDF にあった split/merge/rotate は v1 スコープ外。 */
export type ModeId = "view" | "print" | "replace";

export interface DocSource {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  pageCount: number;
  /** 差替ピッカーで色分けするためのアクセントカラー。 */
  accent: string;
}

export interface PageRef {
  srcDocId: string;
  srcPageIndex: number;
}

export interface PageSlot extends PageRef {
  replacedBy?: PageRef;
  rotation?: number;
}

/** Zoom is a percentage relative to "fit-width" (100 = fits the viewer width). */
export type ZoomPercent = number;

export const ZOOM_MIN = 30;
export const ZOOM_MAX = 300;
export const ZOOM_STEP = 25;
export const ZOOM_DEFAULT = 100;
export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300];

export interface ToastMsg {
  id: number;
  text: string;
}
