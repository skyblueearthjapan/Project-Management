// Phase M: バックエンド ezdxf のレスポンス契約。
// Three.js / dxf-viewer を廃して SVG 直描画方式に切替えたため、
// パース結果は完全にサーバ側で JSON 化されてくる。
// 参考: 材料取りCADソフト/web/src/types/dxf.ts

export type DxfEntityType =
  | "LINE"
  | "CIRCLE"
  | "ARC"
  | "LWPOLYLINE"
  | "POLYLINE"
  | "ELLIPSE"
  | "SPLINE"
  | "TEXT"
  | "MTEXT"
  | "INSERT"
  | "DIMENSION"
  | "LEADER"
  | "POINT"
  | "SOLID";

export interface DxfBoundingBox {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface DxfEntity {
  id: string;
  type: DxfEntityType | string;
  color: number;
  layer: string;
  geom: Record<string, unknown>;
  /**
   * アノテーション (寸法線 / 引出線 / 注釈テキスト 等)。
   *   - TEXT / MTEXT / DIMENSION / LEADER 本体 → true
   *   - DIMENSION / LEADER の仮想子 (構成要素の LINE/ARC 等) → true
   *   - INSERT の中身は実部品ありうるので false
   * フロントは計測のスナップから除外 + 淡色で描画する。
   */
  is_annotation?: boolean;
}

export interface DxfLayer {
  name: string;
  color: number;
  rgb: string | null;
  visible: boolean;
}

export interface DxfParsed {
  name: string;
  bounding_box: DxfBoundingBox;
  entities: DxfEntity[];
  layers: DxfLayer[];
  units: string;
  stats: { total: number; by_type: Record<string, number> };
}
