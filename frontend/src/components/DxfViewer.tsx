// Phase M: DXF Viewer (SVG ベース)
//
// 旧実装は dxf-viewer + Three.js + WebGL だったが、
//  1) ブラウザ環境で WebGL コンテキストが生成されない/描画されない問題
//  2) Three.js の二重バンドル警告
// で安定描画が出来なかったため、サーバ側 (ezdxf) でパースして JSON 化し、
// フロントは SVG を React で直接組み立てる方式に転換した。
//
// 参考: 材料取りCADソフト/web/src/components/{CanvasArea,EntityRenderer}.vue
//
// 機能:
//   - パン / ズーム (wheel + drag)
//   - レイヤー表示切替
//   - 距離計測 (2 点クリック)
//   - 角度計測 (3 点クリック: 頂点 → 辺端 → 辺端)
//   - 計測リスト
//
// DXF は Y-up 座標系なので、親 <g transform="translate(0 yMid) scale(1,-1)">
// で Y を反転させ、TEXT だけ自身の Y を中心に counter-flip して文字を立てる。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DxfEntity, DxfParsed } from "../types/dxf";

interface DxfViewerProps {
  /** /api/v1/files/dxf/{id} のような raw DXF URL。`/parsed` を内部で追加する */
  url: string;
  fullHeight?: boolean;
}

// pan モードは撤去。距離/角度/径モードでも左ドラッグでパン可能 (5px 以上動いたらパン)、
// 動かずに離した場合のみピンを置く ← AutoCAD / Google Maps と同じ挙動。
//   distance: 2 点を選んで ΔX/ΔY 寸法
//   angle:    3 点 (頂点+辺端 2 つ) で角度
//   diameter: 円/弧を 1 つ選んで直径 φ
type Mode = "distance" | "angle" | "diameter";

interface PinPoint {
  x: number;
  y: number;
}

interface Measurement {
  kind: "distance" | "angle" | "diameter";
  points: PinPoint[];
  /** ΔX 用 (水平) 寸法線の Y 座標 (DXF 単位)。distance のみ。 */
  dimYForX?: number;
  /** ΔY 用 (垂直) 寸法線の X 座標 (DXF 単位)。distance のみ。 */
  dimXForY?: number;
  /** 角度寸法の円弧半径 (DXF 単位)。angle のみ。ドラッグで調整可能。 */
  arcRadius?: number;
  /** 円の中心。diameter のみ。 */
  centerPoint?: PinPoint;
  /** 円の半径 (DXF 単位)。diameter のみ。 */
  circleRadius?: number;
  /** 互換: angle の値表示用。distance は廃止 (XY 別表示) */
  value: number;
  label: string;
}

function parsedUrl(rawUrl: string): string {
  // /api/v1/files/dxf/123 → /api/v1/files/dxf/123/parsed
  // /api/v1/files/fileserver?...&path=... → /api/v1/files/dxf/parsed?... + path 移植
  if (rawUrl.match(/\/files\/dxf\/\d+/)) {
    return rawUrl.replace(/(\/files\/dxf\/\d+)/, "$1/parsed");
  }
  if (rawUrl.includes("/files/fileserver")) {
    return rawUrl.replace("/files/fileserver", "/files/dxf/parsed");
  }
  return rawUrl + "/parsed";
}

function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// LWPOLYLINE: bulge ≠ 0 の場合は弧に変換しながら SVG path を組み立てる
function polylinePath(vertices: number[][], closed: boolean): string {
  if (!vertices?.length) return "";
  const first = vertices[0]!;
  let d = `M ${num(first[0])} ${num(first[1])}`;
  const seg = (a: number[], b: number[]): string => {
    const x1 = num(a[0]);
    const y1 = num(a[1]);
    const x2 = num(b[0]);
    const y2 = num(b[1]);
    const bulge = num(a[2]);
    if (!bulge) return ` L ${x2} ${y2}`;
    const theta = 4 * Math.atan(Math.abs(bulge));
    const chord = Math.hypot(x2 - x1, y2 - y1);
    if (chord === 0) return ` L ${x2} ${y2}`;
    const r = chord / (2 * Math.sin(theta / 2));
    const largeArc = theta > Math.PI ? 1 : 0;
    // 親 scale(1,-1) があるので sweep は反転
    const sweep = bulge > 0 ? 0 : 1;
    return ` A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
  };
  for (let i = 1; i < vertices.length; i++) {
    d += seg(vertices[i - 1]!, vertices[i]!);
  }
  if (closed && vertices.length > 1) {
    d += seg(vertices[vertices.length - 1]!, vertices[0]!);
    d += " Z";
  }
  return d;
}

// ARC: 端点 → 端点 を A コマンドで結ぶ
function arcPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  const x2 = cx + r * Math.cos(rad(a2));
  const y2 = cy + r * Math.sin(rad(a2));
  let sweep = a2 - a1;
  while (sweep < 0) sweep += 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function ellipseSpec(g: Record<string, unknown>): {
  cx: number; cy: number; rx: number; ry: number; angle: number;
} {
  const cx = num(g.cx);
  const cy = num(g.cy);
  const mx = num(g.major_x);
  const my = num(g.major_y);
  const ratio = num(g.ratio, 1);
  const rx = Math.hypot(mx, my);
  const ry = rx * ratio;
  const angle = (Math.atan2(my, mx) * 180) / Math.PI;
  return { cx, cy, rx, ry, angle };
}

function splinePath(controlPoints: number[][]): string {
  if (!controlPoints?.length) return "";
  const first = controlPoints[0]!;
  let d = `M ${num(first[0])} ${num(first[1])}`;
  for (let i = 1; i < controlPoints.length; i++) {
    d += ` L ${num(controlPoints[i]![0])} ${num(controlPoints[i]![1])}`;
  }
  return d;
}

function leaderPath(vertices: number[][]): string {
  if (!vertices?.length) return "";
  const first = vertices[0]!;
  let d = `M ${num(first[0])} ${num(first[1])}`;
  for (let i = 1; i < vertices.length; i++) {
    d += ` L ${num(vertices[i]![0])} ${num(vertices[i]![1])}`;
  }
  return d;
}

function entityShape(ent: DxfEntity, stroke: string): React.ReactElement | null {
  const g = ent.geom ?? {};
  const common = {
    stroke,
    fill: "none",
    strokeWidth: 1,
    style: { vectorEffect: "non-scaling-stroke" as const },
  };
  switch (ent.type) {
    case "LINE":
      return (
        <line
          x1={num(g.x1)}
          y1={num(g.y1)}
          x2={num(g.x2)}
          y2={num(g.y2)}
          {...common}
        />
      );
    case "CIRCLE":
      return <circle cx={num(g.cx)} cy={num(g.cy)} r={num(g.r)} {...common} />;
    case "ARC":
      return (
        <path
          d={arcPath(
            num(g.cx),
            num(g.cy),
            num(g.r),
            num(g.start_angle),
            num(g.end_angle),
          )}
          {...common}
        />
      );
    case "LWPOLYLINE":
    case "POLYLINE":
      return (
        <path
          d={polylinePath((g.vertices as number[][]) ?? [], Boolean(g.closed))}
          {...common}
        />
      );
    case "ELLIPSE": {
      const s = ellipseSpec(g);
      return (
        <ellipse
          cx={s.cx}
          cy={s.cy}
          rx={s.rx}
          ry={s.ry}
          transform={`rotate(${s.angle} ${s.cx} ${s.cy})`}
          {...common}
        />
      );
    }
    case "SPLINE":
      return (
        <path d={splinePath((g.control_points as number[][]) ?? [])} {...common} />
      );
    case "LEADER":
      return <path d={leaderPath((g.vertices as number[][]) ?? [])} {...common} />;
    case "POINT":
      return <circle cx={num(g.x)} cy={num(g.y)} r={0.5} fill={stroke} stroke="none" />;
    case "SOLID": {
      const vs = ((g.vertices as number[][]) ?? []).map((v) => `${num(v[0])},${num(v[1])}`).join(" ");
      return <polygon points={vs} fill={stroke} stroke="none" opacity={0.4} />;
    }
    case "DIMENSION": {
      const anchors = ((g.anchors as number[][]) ?? []);
      if (anchors.length < 2) return null;
      const a = anchors[0]!;
      const b = anchors[1]!;
      return (
        <line x1={num(a[0])} y1={num(a[1])} x2={num(b[0])} y2={num(b[1])} {...common} opacity={0.5} />
      );
    }
    case "INSERT":
      // virtual_entities で展開済みなので、親の INSERT は描かない
      return null;
    case "TEXT":
    case "MTEXT": {
      const y = num(g.y);
      const h = num(g.height, 9) || 9;
      // 親 scale(1,-1) を打ち消すために、self 中心で counter flip
      return (
        <g transform={`scale(1, -1) translate(0, ${-2 * y})`}>
          <text
            x={num(g.x)}
            y={y}
            fontSize={h}
            fill={stroke}
            style={{ vectorEffect: "non-scaling-stroke" as const }}
          >
            {String(g.text ?? "")}
          </text>
        </g>
      );
    }
    default:
      return null;
  }
}

// スナップ候補。優先度: endpoint > center/midpoint/quadrant > nearest
interface SnapCandidate {
  point: PinPoint;
  distance: number;
  priority: number;
  type: "endpoint" | "midpoint" | "center" | "quadrant" | "nearest";
}

export function DxfViewer({ url, fullHeight = true }: DxfViewerProps): React.ReactElement {
  const [data, setData] = useState<DxfParsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [mode, setMode] = useState<Mode>("distance");
  const [pinPoints, setPinPoints] = useState<PinPoint[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  const [cursor, setCursor] = useState<PinPoint | null>(null);
  const [snap, setSnap] = useState<SnapCandidate | null>(null);
  // タッチ操作向け「2 タップ確定」方式の中間状態。
  //   1 タップ目: ここに候補点 (snap がかかればそこ) をセット → 画面に表示し続ける
  //   2 タップ目: ここの近く (~40 画面 px) を再タップしたら確定 → pinPoints に push
  //   ↑ 別の場所をタップしたら本 state を新しい位置に置き換え (確定はキャンセル)
  const [pendingPin, setPendingPin] = useState<{
    point: PinPoint;
    type: SnapCandidate["type"] | "free";
    // 直径モード時のみ: 対象円の半径 (これがあれば確定時に直径計測になる)
    circleRadius?: number;
  } | null>(null);
  // pendingPin をセットした時刻。直後 (350ms 以内) の確定タップは指の震えによる
  // 誤発火とみなして無視する (1 回のつもりが 2 回判定になるのを防ぐ)。
  const pendingPinTsRef = useRef<number>(0);
  // タッチ操作で「タップ選択 → マーカー → ドラッグ」を実現する選択状態。
  // 寸法線/円弧をタップすると selectedDim がセットされ、ドラッグ用マーカーが表示される。
  // 別の場所をタップすると解除。
  const [selectedDim, setSelectedDim] = useState<{
    measIdx: number;
    axis: "x" | "y" | "arc";
  } | null>(null);

  // SVG 要素の実サイズ (画面 px)。レイアウト変更時に ResizeObserver で更新する。
  // これと view (state) から pxScale を導出すれば、getScreenCTM() の同期問題
  // (zoom 直後に CTM が古いままになる) を回避できる。
  const [svgSize, setSvgSize] = useState({ width: 1, height: 1 });
  // touchend が実行された時刻。同時刻付近の onMouseUp はブラウザが触覚イベントから
  // 合成したマウスアップなので、500ms 以内は二重発火回避のため無視する。
  const touchHandledTsRef = useRef<number>(0);

  const svgRef = useRef<SVGSVGElement | null>(null);
  // mousedown 時点の情報を保持。mouseup で「動いた距離」が閾値超えならパン、
  // 超えなければクリック (ピン配置) とみなす。
  const pressRef = useRef<{
    startX: number;
    startY: number;
    startView: typeof view;
    dragging: boolean;
  } | null>(null);
  const DRAG_THRESHOLD_PX = 5;
  // タッチ 2 本でのピンチズーム + 2 本指パン用 ref。
  // lastDist / lastCx,Cy で 1 フレーム前の指間距離と中心を持ち、差分から
  // 拡大率・移動量を毎フレーム計算する (相対値駆動で安定)。
  const pinchRef = useRef<{
    lastDist: number;
    lastCx: number;
    lastCy: number;
  } | null>(null);
  // 寸法線ドラッグ。
  //   axis="x"   : 水平寸法線 (distance.dimYForX) を上下に
  //   axis="y"   : 垂直寸法線 (distance.dimXForY) を左右に
  //   axis="arc" : 角度寸法の円弧 (angle.arcRadius) を放射方向に伸縮
  // ドラッグ中はパン/スナップ判定をスキップする。
  const dimDragRef = useRef<{
    idx: number;
    axis: "x" | "y" | "arc";
    startClientX: number;
    startClientY: number;
    startOffset: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(parsedUrl(url))
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return (await res.json()) as DxfParsed;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        const bb = json.bounding_box;
        const w = bb.max_x - bb.min_x;
        const h = bb.max_y - bb.min_y;
        const m = Math.max(w, h) * 0.08;
        setView({ x: bb.min_x - m, y: bb.min_y - m, w: w + m * 2, h: h + m * 2 });
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // SVG 要素の実サイズを ResizeObserver で追跡。
  // pxScale = svgSize / view.w → ズーム/リサイズ即時に正しい値が得られる。
  useLayoutEffect(() => {
    if (!svgRef.current) return;
    const el = svgRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSvgSize({ width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]); // data ロード完了で SVG が初めて描画される。それ以降は ResizeObserver で追従

  // viewBox 1 単位 = ? 画面 px。preserveAspectRatio="xMidYMid meet" のため
  // viewBox の縦横比と SVG 要素の縦横比のうち厳しい方が支配的 (= min)。
  // view と svgSize の両方が state なので、ズーム直後でも次の render 時に
  // 必ず最新の値が反映される (getScreenCTM の同期遅れを回避)。
  const pxPerDxf = useMemo(() => {
    if (!view) return 1;
    return Math.min(svgSize.width / view.w, svgSize.height / view.h);
  }, [view, svgSize]);
  const pxToDxf = 1 / Math.max(pxPerDxf, 1e-9);

  // SVG クライアント座標 → DXF 座標。
  // 旧実装は rect.width で線形補間していたが `preserveAspectRatio=meet` で
  // SVG にレターボックスが入ると座標がずれる (カーソル位置と snap マーカーの
  // 視覚位置が一致しない原因)。SVG ネイティブの getScreenCTM() を逆変換して
  // viewBox 座標を厳密に求める。
  const clientToDxf = (cx: number, cy: number): PinPoint | null => {
    const svg = svgRef.current;
    if (!svg || !data) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const inSvg = pt.matrixTransform(ctm.inverse());
    // inSvg は viewBox 上の座標 (Y は画面下方向が +)。
    // 描画側は <g translate(0 yMid) scale(1,-1)> で DXF Y を反転しているので、
    // 逆変換: DXF Y = yMid - viewBox Y。
    const yMidVal = data.bounding_box.max_y + data.bounding_box.min_y;
    return { x: inSvg.x, y: yMidVal - inSvg.y };
  };

  const yMid = useMemo(() => {
    if (!data) return 0;
    return data.bounding_box.max_y + data.bounding_box.min_y;
  }, [data]);

  const viewBox = view ? `${view.x} ${view.y} ${view.w} ${view.h}` : "0 0 1 1";

  // クリック箇所近傍の特徴点 (端点 / 中点 / 中心 / 象限 / 線上最近点) を返す。
  // 計測モードで「線を正確にクリック」できない問題への対策。
  // snapRadiusDxf は画面 14px 相当 (DXF 座標に換算)。
  const findSnap = (p: PinPoint, snapRadiusDxf: number): SnapCandidate | null => {
    if (!data) return null;
    let best: SnapCandidate | null = null;
    const consider = (
      x: number,
      y: number,
      priority: number,
      type: SnapCandidate["type"],
    ): void => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > snapRadiusDxf) return;
      if (
        !best ||
        priority > best.priority ||
        (priority === best.priority && d < best.distance)
      ) {
        best = { point: { x, y }, distance: d, priority, type };
      }
    };
    for (const ent of data.entities) {
      // 寸法線・引出線・注釈テキストは計測対象外 (誤クリック防止)
      if (ent.is_annotation) continue;
      const g = ent.geom;
      if (ent.type === "LINE") {
        const x1 = num(g.x1), y1 = num(g.y1), x2 = num(g.x2), y2 = num(g.y2);
        consider(x1, y1, 3, "endpoint");
        consider(x2, y2, 3, "endpoint");
        consider((x1 + x2) / 2, (y1 + y2) / 2, 2, "midpoint");
        const dx = x2 - x1, dy = y2 - y1;
        const ll = dx * dx + dy * dy;
        if (ll > 0) {
          const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / ll));
          consider(x1 + t * dx, y1 + t * dy, 1, "nearest");
        }
      } else if (ent.type === "CIRCLE") {
        const cx = num(g.cx), cy = num(g.cy), r = num(g.r);
        consider(cx, cy, 2, "center");
        consider(cx + r, cy, 2, "quadrant");
        consider(cx - r, cy, 2, "quadrant");
        consider(cx, cy + r, 2, "quadrant");
        consider(cx, cy - r, 2, "quadrant");
        const dx = p.x - cx, dy = p.y - cy;
        const d = Math.hypot(dx, dy);
        if (d > 0) consider(cx + (dx / d) * r, cy + (dy / d) * r, 1, "nearest");
      } else if (ent.type === "ARC") {
        const cx = num(g.cx), cy = num(g.cy), r = num(g.r);
        const a1 = num(g.start_angle), a2 = num(g.end_angle);
        const rad = (deg: number): number => (deg * Math.PI) / 180;
        consider(cx + r * Math.cos(rad(a1)), cy + r * Math.sin(rad(a1)), 3, "endpoint");
        consider(cx + r * Math.cos(rad(a2)), cy + r * Math.sin(rad(a2)), 3, "endpoint");
        consider(cx, cy, 2, "center");
        const dx = p.x - cx, dy = p.y - cy;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          const ang = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
          const s = ((a1 % 360) + 360) % 360;
          const en = ((a2 % 360) + 360) % 360;
          const inRange = s <= en ? ang >= s && ang <= en : ang >= s || ang <= en;
          if (inRange) consider(cx + (dx / d) * r, cy + (dy / d) * r, 1, "nearest");
        }
      } else if (ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") {
        const verts = ((g.vertices as number[][]) ?? []);
        const closed = Boolean(g.closed);
        for (let i = 0; i < verts.length; i++) {
          const v = verts[i]!;
          consider(num(v[0]), num(v[1]), 3, "endpoint");
          const nx = i + 1 < verts.length ? verts[i + 1] : (closed ? verts[0] : null);
          if (!nx) continue;
          const x1 = num(v[0]), y1 = num(v[1]), x2 = num(nx[0]), y2 = num(nx[1]);
          consider((x1 + x2) / 2, (y1 + y2) / 2, 2, "midpoint");
          const dx = x2 - x1, dy = y2 - y1, ll = dx * dx + dy * dy;
          if (ll > 0) {
            const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / ll));
            consider(x1 + t * dx, y1 + t * dy, 1, "nearest");
          }
        }
      }
    }
    return best;
  };

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    pressRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startView: view,
      dragging: false,
    };
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    // 寸法線ドラッグ中 → 寸法線オフセットだけ更新して終了
    const dimDrag = dimDragRef.current;
    if (dimDrag && svgRef.current) {
      const ctm = svgRef.current.getScreenCTM();
      const sx = ctm ? Math.abs(ctm.a) : 1; // 画面 px / DXF 単位 (X)
      const sy = ctm ? Math.abs(ctm.d) : sx; // 画面 px / DXF 単位 (Y、flip 含み絶対値)
      if (dimDrag.axis === "x") {
        const dyScreen = e.clientY - dimDrag.startClientY;
        const dyDxf = -dyScreen / Math.max(sy, 1e-9);
        setMeasurements((prev) =>
          prev.map((mm, i) =>
            i === dimDrag.idx ? { ...mm, dimYForX: dimDrag.startOffset + dyDxf } : mm,
          ),
        );
      } else if (dimDrag.axis === "y") {
        const dxScreen = e.clientX - dimDrag.startClientX;
        const dxDxf = dxScreen / Math.max(sx, 1e-9);
        setMeasurements((prev) =>
          prev.map((mm, i) =>
            i === dimDrag.idx ? { ...mm, dimXForY: dimDrag.startOffset + dxDxf } : mm,
          ),
        );
      } else if (dimDrag.axis === "arc") {
        // 円弧ドラッグ: 頂点からカーソルまでの距離 = 新しい円弧半径
        const c = clientToDxf(e.clientX, e.clientY);
        if (!c) return;
        setMeasurements((prev) =>
          prev.map((mm, i) => {
            if (i !== dimDrag.idx) return mm;
            if (mm.kind !== "angle" || mm.points.length < 1) return mm;
            const v = mm.points[0]!;
            const r = Math.hypot(c.x - v.x, c.y - v.y);
            return { ...mm, arcRadius: Math.max(0.5, r) };
          }),
        );
      }
      return;
    }

    const c = clientToDxf(e.clientX, e.clientY);
    if (c) setCursor(c);

    const press = pressRef.current;
    // ドラッグ判定: 閾値超えで「パン」に格上げ
    if (press && press.startView) {
      const dx = e.clientX - press.startX;
      const dy = e.clientY - press.startY;
      if (!press.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        press.dragging = true;
      }
      if (press.dragging && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const ddx = (dx / rect.width) * press.startView.w;
        const ddy = (dy / rect.height) * press.startView.h;
        setView({
          x: press.startView.x - ddx,
          y: press.startView.y - ddy,
          w: press.startView.w,
          h: press.startView.h,
        });
        return;
      }
    }
    // パン中でなければスナップ計算 (常時 ON にして見やすく)。
    // ctm.a が viewBox 1 単位あたりの画面 px 数。28 画面 px ≒ 28/ctm.a viewBox 単位
    // (= DXF 単位)。これでレターボックスがあっても正確。
    if (c && svgRef.current) {
      const ctm = svgRef.current.getScreenCTM();
      const scale = ctm ? Math.abs(ctm.a) : 1;
      const radius = 28 / Math.max(scale, 1e-9);
      setSnap(findSnap(c, radius));
    } else if (snap) {
      setSnap(null);
    }
  };
  const onMouseUp = (e: React.MouseEvent<SVGSVGElement>): void => {
    // 寸法線ドラッグ終了
    if (dimDragRef.current) {
      dimDragRef.current = null;
      return;
    }
    // touchend 直後の合成 mouseup を無視 (二重発火防止)
    if (Date.now() - touchHandledTsRef.current < 500) {
      pressRef.current = null;
      return;
    }
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;
    // ドラッグでなければクリック (PC マウスは即時確定)
    if (!press.dragging) {
      handleMousePin(e.clientX, e.clientY);
    }
  };

  // 寸法線ハンドル mousedown: ドラッグ開始 (パン/ピンとは独立)
  const onDimMouseDown = (
    e: React.MouseEvent<SVGElement>,
    idx: number,
    axis: "x" | "y" | "arc",
    startOffset: number,
  ): void => {
    e.stopPropagation();
    if (e.button !== 0) return;
    dimDragRef.current = {
      idx,
      axis,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffset,
    };
  };

  // タッチ操作 (iPad / Android タブレット) 対応。
  //   1 本指: パン (閾値超え時) または タップ (寸法ピン配置)
  //   2 本指: ピンチでズーム + 中心移動で 2 本指パンも併用
  const onTouchStart = (e: React.TouchEvent<SVGSVGElement>): void => {
    if (e.touches.length === 2) {
      // ピンチ開始: 1 本指の press は無効化して衝突を防ぐ
      const t1 = e.touches[0]!;
      const t2 = e.touches[1]!;
      pinchRef.current = {
        lastDist: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
        lastCx: (t1.clientX + t2.clientX) / 2,
        lastCy: (t1.clientY + t2.clientY) / 2,
      };
      pressRef.current = null;
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    pressRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      startView: view,
      dragging: false,
    };
  };
  const onTouchMove = (e: React.TouchEvent<SVGSVGElement>): void => {
    // 寸法線ドラッグ中 (タッチ): onMouseMove と同じロジックを再利用
    const dimDrag = dimDragRef.current;
    if (dimDrag && svgRef.current && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0]!;
      const ctm = svgRef.current.getScreenCTM();
      const sx = ctm ? Math.abs(ctm.a) : 1;
      const sy = ctm ? Math.abs(ctm.d) : sx;
      if (dimDrag.axis === "x") {
        const dyScreen = t.clientY - dimDrag.startClientY;
        const dyDxf = -dyScreen / Math.max(sy, 1e-9);
        setMeasurements((prev) =>
          prev.map((mm, i) =>
            i === dimDrag.idx ? { ...mm, dimYForX: dimDrag.startOffset + dyDxf } : mm,
          ),
        );
      } else if (dimDrag.axis === "y") {
        const dxScreen = t.clientX - dimDrag.startClientX;
        const dxDxf = dxScreen / Math.max(sx, 1e-9);
        setMeasurements((prev) =>
          prev.map((mm, i) =>
            i === dimDrag.idx ? { ...mm, dimXForY: dimDrag.startOffset + dxDxf } : mm,
          ),
        );
      } else if (dimDrag.axis === "arc") {
        const c = clientToDxf(t.clientX, t.clientY);
        if (!c) return;
        setMeasurements((prev) =>
          prev.map((mm, i) => {
            if (i !== dimDrag.idx) return mm;
            if (mm.kind !== "angle" || mm.points.length < 1) return mm;
            const v = mm.points[0]!;
            const r = Math.hypot(c.x - v.x, c.y - v.y);
            return { ...mm, arcRadius: Math.max(0.5, r) };
          }),
        );
      }
      return;
    }
    // === 2 本指ピンチ ===
    if (e.touches.length === 2 && pinchRef.current && view && svgRef.current) {
      e.preventDefault();
      const t1 = e.touches[0]!;
      const t2 = e.touches[1]!;
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const factor = dist / Math.max(pinchRef.current.lastDist, 1);
      const clamped = clampZoom(view.w / factor, view.h / factor);
      const newW = clamped.w;
      const newH = clamped.h;
      // 中心を不動点としてズーム + 2 本指の中心移動でパンも反映
      const centroidDxf = clientToDxf(cx, cy);
      if (centroidDxf) {
        const rect = svgRef.current.getBoundingClientRect();
        const fx = (cx - rect.left) / rect.width;
        const fy = (cy - rect.top) / rect.height;
        const newX = centroidDxf.x - fx * newW;
        const newY = centroidDxf.y - newH + fy * newH;
        setView({ x: newX, y: newY, w: newW, h: newH });
      }
      pinchRef.current = { lastDist: dist, lastCx: cx, lastCy: cy };
      return;
    }
    // ピンチ終了後・指 1 本に戻った場合はパン継続のために state リセット
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const c = clientToDxf(t.clientX, t.clientY);
    if (c) setCursor(c);
    const press = pressRef.current;
    if (press && press.startView) {
      const dx = t.clientX - press.startX;
      const dy = t.clientY - press.startY;
      if (!press.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        press.dragging = true;
      }
      if (press.dragging && svgRef.current) {
        e.preventDefault();
        const rect = svgRef.current.getBoundingClientRect();
        const ddx = (dx / rect.width) * press.startView.w;
        const ddy = (dy / rect.height) * press.startView.h;
        setView({
          x: press.startView.x - ddx,
          y: press.startView.y - ddy,
          w: press.startView.w,
          h: press.startView.h,
        });
        return;
      }
    }
    if (c && svgRef.current) {
      const ctm = svgRef.current.getScreenCTM();
      const scale = ctm ? Math.abs(ctm.a) : 1;
      const radius = 28 / Math.max(scale, 1e-9);
      setSnap(findSnap(c, radius));
    }
  };
  const onTouchEnd = (e: React.TouchEvent<SVGSVGElement>): void => {
    // 寸法線ドラッグ終了 (タッチ)
    if (dimDragRef.current && e.touches.length === 0) {
      dimDragRef.current = null;
      touchHandledTsRef.current = Date.now();
      return;
    }
    // ピンチ終了
    if (e.touches.length < 2) {
      pinchRef.current = null;
    }
    // 指 0 本になった時に「タップ」だったらピン配置
    if (e.touches.length === 0) {
      const press = pressRef.current;
      pressRef.current = null;
      if (press && !press.dragging) {
        const t = e.changedTouches[0];
        if (t) handleTouchPin(t.clientX, t.clientY);
      }
      // touchend が処理されたことを記録 → 直後の合成 mouseup を抑止
      touchHandledTsRef.current = Date.now();
    }
  };

  // ズーム範囲クランプ。極端拡縮で viewBox が縮退/巨大化すると SVG レンダラが
  // 描画失敗 (画面真っ白) する事象があるため、図面 bbox を基準に上下限を強制。
  const clampZoom = (w: number, h: number): { w: number; h: number } => {
    if (!data) return { w, h };
    const bb = data.bounding_box;
    const baseW = Math.max(bb.max_x - bb.min_x, 1);
    const baseH = Math.max(bb.max_y - bb.min_y, 1);
    const minW = baseW / 500;
    const maxW = baseW * 50;
    const minH = baseH / 500;
    const maxH = baseH * 50;
    if (w < minW) { const k = minW / w; w *= k; h *= k; }
    else if (w > maxW) { const k = maxW / w; w *= k; h *= k; }
    if (h < minH) { const k = minH / h; w *= k; h *= k; }
    else if (h > maxH) { const k = maxH / h; w *= k; h *= k; }
    return { w, h };
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>): void => {
    if (!view || !data) return;
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const c = clientToDxf(e.clientX, e.clientY);
    if (!c) return;
    const clamped = clampZoom(view.w * factor, view.h * factor);
    const newW = clamped.w;
    const newH = clamped.h;
    if (Math.abs(newW - view.w) < 1e-6 && Math.abs(newH - view.h) < 1e-6) {
      return;
    }

    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const newX = c.x - fx * newW;
    const newY = c.y - newH + fy * newH;
    setView({ x: newX, y: newY, w: newW, h: newH });
  };

  // DXF 座標 → 画面 (client) 座標。pendingPin の近接判定で利用。
  const dxfToClient = (
    dxfX: number,
    dxfY: number,
  ): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg || !data) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const yMidVal = data.bounding_box.max_y + data.bounding_box.min_y;
    const viewBoxX = dxfX;
    const viewBoxY = yMidVal - dxfY;
    return {
      x: ctm.a * viewBoxX + ctm.e,
      y: ctm.d * viewBoxY + ctm.f,
    };
  };

  // ピン確定のコア処理。
  //   diameter モード + circleRadius あり: 1 タップで直径 measurement 生成
  //   distance/angle: 既存ロジックで pinPoints に積み、必要数集まったら生成
  const commitPin = (p: PinPoint, circleRadius?: number): void => {
    if (mode === "diameter" && circleRadius !== undefined && circleRadius > 0) {
      const d = circleRadius * 2;
      const u = data?.units ?? "";
      setMeasurements((m) => [
        ...m,
        {
          kind: "diameter",
          points: [p],
          centerPoint: p,
          circleRadius,
          value: d,
          label: `φ ${fmtNum(d)} ${u}`,
        },
      ]);
      setPinPoints([]);
      return;
    }
    const next = [...pinPoints, p];
    commitWithPins(next);
  };

  const commitWithPins = (next: PinPoint[]): void => {
    if (mode === "distance" && next.length >= 2) {
      const a = next[0]!;
      const b = next[1]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      // 寸法線の初期オフセット = view.w の 6% (画面で適度に離れた位置)。
      const offset = view ? view.w * 0.06 : 10;
      const dimYForX = Math.min(a.y, b.y) - offset;
      const dimXForY = Math.max(a.x, b.x) + offset;
      const u = data?.units ?? "";
      setMeasurements((m) => [
        ...m,
        {
          kind: "distance",
          points: [a, b],
          dimYForX,
          dimXForY,
          value: d,
          label: `Δ ${fmtNum(d)} ${u}`,
        },
      ]);
      setPinPoints([]);
    } else if (mode === "angle" && next.length >= 3) {
      const v = next[0]!;
      const a = next[1]!;
      const b = next[2]!;
      const va = { x: a.x - v.x, y: a.y - v.y };
      const vb = { x: b.x - v.x, y: b.y - v.y };
      const dot = va.x * vb.x + va.y * vb.y;
      const ma = Math.hypot(va.x, va.y);
      const mb = Math.hypot(vb.x, vb.y);
      const cos = dot / (ma * mb || 1);
      const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      // 円弧半径の初期値: 短い方の辺の 40% (画面で適度に視認できるサイズ)
      const arcRadius = Math.min(ma, mb) * 0.4;
      setMeasurements((m) => [
        ...m,
        {
          kind: "angle",
          points: [v, a, b],
          value: ang,
          arcRadius,
          label: `${fmtNum(ang, 1)}°`,
        },
      ]);
      setPinPoints([]);
    } else {
      setPinPoints(next);
    }
  };

  // クリック / タップ位置の snap 計算 (戻り値: スナップ候補があれば候補、なければ raw)
  // 直径モード: タップ位置 p に最も近い CIRCLE / ARC エンティティを返す。
  // 中心からの距離 と 円周からの距離 のうち近い方で判定する。
  const findCircleNear = (
    p: PinPoint,
    snapRadiusDxf: number,
  ): { center: PinPoint; radius: number } | null => {
    if (!data) return null;
    let best: { center: PinPoint; radius: number; dist: number } | null = null;
    for (const ent of data.entities) {
      if (ent.is_annotation) continue;
      if (ent.type !== "CIRCLE" && ent.type !== "ARC") continue;
      const cx = num(ent.geom.cx);
      const cy = num(ent.geom.cy);
      const r = num(ent.geom.r);
      if (r <= 0) continue;
      const distCenter = Math.hypot(p.x - cx, p.y - cy);
      const distPerim = Math.abs(distCenter - r);
      const minDist = Math.min(distCenter, distPerim);
      if (minDist > snapRadiusDxf) continue;
      if (!best || minDist < best.dist) {
        best = { center: { x: cx, y: cy }, radius: r, dist: minDist };
      }
    }
    return best ? { center: best.center, radius: best.radius } : null;
  };

  const computeTapPoint = (
    clientX: number,
    clientY: number,
  ): {
    point: PinPoint;
    type: SnapCandidate["type"] | "free";
    circleRadius?: number;
  } | null => {
    const raw = clientToDxf(clientX, clientY);
    if (!raw) return null;
    if (svgRef.current) {
      const ctm = svgRef.current.getScreenCTM();
      const scale = ctm ? Math.abs(ctm.a) : 1;
      const radius = 28 / Math.max(scale, 1e-9);
      // 直径モードでは円を最優先で検出
      if (mode === "diameter") {
        const circle = findCircleNear(raw, radius);
        if (circle) {
          return {
            point: circle.center,
            type: "center",
            circleRadius: circle.radius,
          };
        }
      }
      const candidate = findSnap(raw, radius);
      if (candidate) return { point: candidate.point, type: candidate.type };
    }
    return { point: raw, type: "free" };
  };

  // PC マウス: タッチと同じ「2 クリック確定」方式に統一。
  //   - 寸法線が選択中 (selectedDim) の状態で空き領域クリック → 選択解除
  //   - pendingPin あり + 近いクリック (20px 以内) → 確定
  //   - pendingPin あり + 別の場所 → pendingPin を移動
  //   - pendingPin なし → 新規にセット
  // PC はマウス操作の精度が高いので、近接判定は 20px (タッチは 40px)、
  // 誤発火デバウンス (500ms) は不要のためかけない。
  const handleMousePin = (clientX: number, clientY: number): void => {
    if (selectedDim) {
      setSelectedDim(null);
      return;
    }
    const c = computeTapPoint(clientX, clientY);
    if (!c) return;
    if (pendingPin) {
      const screen = dxfToClient(pendingPin.point.x, pendingPin.point.y);
      if (screen) {
        const screenDist = Math.hypot(
          clientX - screen.x,
          clientY - screen.y,
        );
        if (screenDist < 20) {
          commitPin(pendingPin.point, pendingPin.circleRadius);
          setPendingPin(null);
          return;
        }
      }
    }
    setPendingPin(c);
    pendingPinTsRef.current = Date.now();
  };

  // タッチ: 「2 タップ確定」方式 + 指の震え対策デバウンス。
  //   1 タップ目 → snap 候補を pendingPin にセット (黄色マーカーが残る)
  //   2 タップ目 (~40 画面 px 内, **500ms 以上経過** 後) → pendingPin を確定
  //   別の場所をタップ → pendingPin を新しい位置に置き換え
  //
  // 「コンマ数秒以内」の連続タップは確定不可:
  //   - 500ms 以内の確定タップは 「1 回の動作で 2 回判定された誤発火」 として無視
  //   - これにより指の震えやタッチパネルの感度暴走で即確定されてしまう問題を抑止
  const CONFIRM_MIN_INTERVAL_MS = 500;
  const handleTouchPin = (clientX: number, clientY: number): void => {
    // 寸法線が選択中 (マーカー表示中) なら、別の場所のタップでは選択解除して終了。
    // これにより寸法線をタップ → マーカー → ドラッグ → 完了後にキャンセル の流れができる。
    if (selectedDim) {
      setSelectedDim(null);
      return;
    }
    const c = computeTapPoint(clientX, clientY);
    if (!c) return;
    if (pendingPin) {
      const sincePending = Date.now() - pendingPinTsRef.current;
      // pendingPin をセット直後の 「即確定」 は誤発火扱いで完全無視
      if (sincePending < CONFIRM_MIN_INTERVAL_MS) {
        return;
      }
      const screen = dxfToClient(pendingPin.point.x, pendingPin.point.y);
      if (screen) {
        const screenDist = Math.hypot(
          clientX - screen.x,
          clientY - screen.y,
        );
        if (screenDist < 40) {
          // 2 タップ目: 確定
          commitPin(pendingPin.point, pendingPin.circleRadius);
          setPendingPin(null);
          return;
        }
      }
    }
    // 1 タップ目 / 別の場所をタップ: pending を更新 (時刻も記録)
    setPendingPin(c);
    pendingPinTsRef.current = Date.now();
  };

  const fitView = (): void => {
    if (!data) return;
    const bb = data.bounding_box;
    const w = bb.max_x - bb.min_x;
    const h = bb.max_y - bb.min_y;
    const m = Math.max(w, h) * 0.08;
    setView({ x: bb.min_x - m, y: bb.min_y - m, w: w + m * 2, h: h + m * 2 });
  };

  const zoom = (factor: number): void => {
    if (!view) return;
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const clamped = clampZoom(view.w * factor, view.h * factor);
    setView({
      x: cx - clamped.w / 2,
      y: cy - clamped.h / 2,
      w: clamped.w,
      h: clamped.h,
    });
  };

  // ACI 色 7 は CAD で「BYLAYER (黒/白)」を意味し、ezdxf は #ffffff にマップする。
  // 白背景に白を描くと見えないので、白っぽい色は濃い ink2 に差し替える。
  // また rgb が null のレイヤー (色未指定) も同様に ink2 で代用する。
  const layerColor = (name: string): string => {
    const l = data?.layers.find((x) => x.name === name);
    const rgb = l?.rgb;
    if (!rgb) return "#1f2937";
    const norm = rgb.toLowerCase();
    if (norm === "#ffffff" || norm === "#fefefe" || norm === "#fff") {
      return "#1f2937";
    }
    return rgb;
  };

  const visibleEntities = data?.entities ?? [];

  const zoomPercent = useMemo(() => {
    if (!data || !view) return 100;
    const bb = data.bounding_box;
    const baseW = bb.max_x - bb.min_x;
    return Math.round(((baseW || 1) / view.w) * 100);
  }, [data, view]);

  return (
    <div
      className={`relative flex flex-col bg-white border border-hair rounded-md overflow-hidden ${
        fullHeight ? "h-full min-h-0" : ""
      }`}
    >
      {/* ツールバー。モバイルは超コンパクト化:
          - 計測モード切替 (📏 / 📐) + ⟲ フィット + ✖ クリア のみ
          - ＋/－ ボタン (ピンチで代替) と統計表示は md 以上
          - 余白も詰めて高さを最小化 */}
      <div className="flex items-center gap-1 px-1 md:px-2 py-0.5 md:py-1 border-b border-hair bg-bg shrink-0 text-[11px] md:text-xs">
        <button
          type="button"
          onClick={() => setMode("distance")}
          className={`px-2 py-0.5 md:py-1 rounded ${mode === "distance" ? "bg-accent text-white" : "border border-hair text-ink2"}`}
        >
          📏 距離
        </button>
        <button
          type="button"
          onClick={() => setMode("angle")}
          className={`px-2 py-0.5 md:py-1 rounded ${mode === "angle" ? "bg-accent text-white" : "border border-hair text-ink2"}`}
        >
          📐 角度
        </button>
        <button
          type="button"
          onClick={() => setMode("diameter")}
          className={`px-2 py-0.5 md:py-1 rounded ${mode === "diameter" ? "bg-accent text-white" : "border border-hair text-ink2"}`}
          title="円/弧をタップで直径を計測"
        >
          φ 径
        </button>
        <span className="mx-1 text-ink3 hidden md:inline">|</span>
        {/* ＋/－ ズーム: PC のみ (モバイルはピンチで代替) */}
        <button
          type="button"
          onClick={() => zoom(1 / 1.25)}
          className="hidden md:inline-block px-2 py-1 rounded border border-hair text-ink2"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={() => zoom(1.25)}
          className="hidden md:inline-block px-2 py-1 rounded border border-hair text-ink2"
        >
          －
        </button>
        <button
          type="button"
          onClick={fitView}
          className="px-2 py-0.5 md:py-1 rounded border border-hair text-ink2"
          title="全体表示にフィット"
        >
          {/* PC: ⟲ フィット / モバイル: ⟲ FIT (英字 3 文字なら横長を抑えて収まる) */}
          ⟲
          <span className="ml-0.5 md:hidden">FIT</span>
          <span className="hidden md:inline ml-0.5">フィット</span>
        </button>
        <span className="mx-1 text-ink3 hidden md:inline">|</span>
        <button
          type="button"
          onClick={() => {
            setMeasurements([]);
            setPinPoints([]);
            setPendingPin(null);
            setSelectedDim(null);
          }}
          className="px-2 py-0.5 md:py-1 rounded border border-hair text-ink2"
        >
          ✖
          <span className="hidden md:inline ml-0.5">計測クリア</span>
        </button>
        {/* 統計表示: PC のみ (モバイルは省略してビューア領域を確保) */}
        <span className="hidden md:inline ml-auto mr-8 text-ink3 font-mono truncate">
          {data ? `${data.stats.total} 要素 / 単位: ${data.units}` : ""}
        </span>
      </div>

      <div className="flex-1 min-h-0 relative">
        {/* モバイル専用: 2 タップ確定方式の操作ヒント。
            「今 何点目を選んでいるか」 と 「pendingPin が確定待ちか」 の両方を明示。
            すべての点 (距離=2点, 角度=3点) で 2 タップ確定方式が共通適用される。 */}
        {(() => {
          const placed = pinPoints.length; // 確定済の点の数
          const needed =
            mode === "angle" ? 3 : mode === "diameter" ? 1 : 2;
          const pointNo = placed + 1;
          const labelByMode =
            mode === "angle"
              ? ["頂点", "辺の端 1", "辺の端 2"][placed] ?? "次の点"
              : mode === "diameter"
                ? "円/弧"
                : ["1 点目", "2 点目"][placed] ?? "次の点";
          if (pointNo > needed) return null;
          return (
            <div className="absolute top-1 left-1 right-1 z-10 bg-amber-50/95 border border-amber-300 text-amber-900 text-[11px] px-2 py-1 rounded shadow-sm pointer-events-none leading-tight">
              <div className="flex items-center gap-2">
                {/* 進捗バッジ。「辺の端 1」 等 漢字 + 数字 が 1 行に収まる幅を確保。
                    - shrink-0: flex 親に圧縮されない
                    - whitespace-nowrap: 文字列内の自動折返しを禁止 */}
                <span className="shrink-0 whitespace-nowrap font-bold text-amber-900 bg-amber-200 px-2 py-0.5 rounded">
                  {pointNo}/{needed} {labelByMode}
                </span>
                {pendingPin ? (
                  <span>
                    🟡 黄色マーカーを <b>もう一度クリック/タップ</b> で確定 / 別の場所で移動
                  </span>
                ) : (
                  <span>
                    線の近くを <b>クリック/タップ</b> → マーカー出たら <b>再クリック/タップ</b> で確定
                  </span>
                )}
              </div>
            </div>
          );
        })()}
        {loading && (
          <div className="absolute inset-0 grid place-items-center text-ink3 text-sm">
            DXF をパース中…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center text-red-600 text-sm">
            DXF 読み込みエラー: {error}
          </div>
        )}
        {!loading && !error && data && view && (
          <svg
            ref={svgRef}
            viewBox={viewBox}
            preserveAspectRatio="xMidYMid meet"
            className="w-full h-full bg-white cursor-crosshair select-none"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            style={{ touchAction: "none" }}
          >
            <g transform={`translate(0 ${yMid}) scale(1 -1)`}>
              {visibleEntities.map((ent) => (
                <g key={ent.id}>
                  {entityShape(
                    ent,
                    // 寸法線・注釈は淡いグレーで描画して図形と明確に区別。
                    // これによりユーザーは「測りたい線」と「寸法/注釈」を視覚的に
                    // 識別でき、加えてスナップは findSnap 側でも除外済 (二重防御)。
                    ent.is_annotation ? "#94a3b8" : layerColor(ent.layer),
                  )}
                </g>
              ))}

              {pinPoints.map((p, i) => (
                <circle
                  key={`pin-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={3}
                  fill="#06b6d4"
                  style={{ vectorEffect: "non-scaling-stroke" }}
                />
              ))}

              {/* 2 タップ確定方式 (タッチ専用) の中間状態。pendingPin が存在する間は
                  黄色マーカーがその場所に残る。ユーザーは同じ場所を再タップして確定する。
                  視認性のため、緑色のリングをかぶせて「タップで確定」を促す。 */}
              {pendingPin && (() => {
                // pxToDxf は state ベース (view + svgSize) なのでズーム直後でも最新
                const s = 10 * pxToDxf;
                return (
                  <g
                    transform={`translate(${pendingPin.point.x} ${pendingPin.point.y})`}
                    pointerEvents="none"
                  >
                    {/* 外側の緑リング。
                        vector-effect: non-scaling-stroke 使用時、strokeWidth は
                        画面 px として直接解釈される → 定数を渡す (pxToDxf を
                        掛けるとズームアウト時に線が太くなりリングが塗りつぶされる)。 */}
                    <circle
                      cx={0}
                      cy={0}
                      r={s * 1.6}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      style={{ vectorEffect: "non-scaling-stroke" }}
                    />
                    {/* 内側のスナップ種別マーカー。同じ理由で non-scaling-stroke + 定数 strokeWidth */}
                    {pendingPin.type === "endpoint" && (
                      <rect x={-s * 0.7} y={-s * 0.7} width={s * 1.4} height={s * 1.4} fill="#fde047" stroke="#000" strokeWidth={1} style={{ vectorEffect: "non-scaling-stroke" }} />
                    )}
                    {pendingPin.type === "midpoint" && (
                      <polygon points={`0,${-s * 0.7} ${s * 0.7},${s * 0.5} ${-s * 0.7},${s * 0.5}`} fill="#fde047" stroke="#000" strokeWidth={1} style={{ vectorEffect: "non-scaling-stroke" }} />
                    )}
                    {(pendingPin.type === "center" || pendingPin.type === "quadrant") && (
                      <circle cx={0} cy={0} r={s * 0.7} fill="#fde047" stroke="#000" strokeWidth={1} style={{ vectorEffect: "non-scaling-stroke" }} />
                    )}
                    {pendingPin.type === "nearest" && (
                      <>
                        <circle cx={0} cy={0} r={s * 0.55} fill="#fde047" stroke="#000" strokeWidth={1} style={{ vectorEffect: "non-scaling-stroke" }} />
                        <line x1={-s * 0.4} y1={-s * 0.4} x2={s * 0.4} y2={s * 0.4} stroke="#000" strokeWidth={1} style={{ vectorEffect: "non-scaling-stroke" }} />
                        <line x1={-s * 0.4} y1={s * 0.4} x2={s * 0.4} y2={-s * 0.4} stroke="#000" strokeWidth={1} style={{ vectorEffect: "non-scaling-stroke" }} />
                      </>
                    )}
                    {pendingPin.type === "free" && (
                      <circle cx={0} cy={0} r={s * 0.5} fill="#fde047" stroke="#000" strokeWidth={1} style={{ vectorEffect: "non-scaling-stroke" }} />
                    )}
                  </g>
                );
              })()}

              {measurements.map((m, i) => {
                if (m.kind === "angle" && m.points.length >= 3) {
                  // === 角度計測: 頂点 + 2 辺端 → 円弧 (ドラッグ可) + 矢印 + ラベル ===
                  const v = m.points[0]!;
                  const a = m.points[1]!;
                  const b = m.points[2]!;
                  // state ベースの pxToDxf を使い、ズーム直後でも最新の値で計算
                  const pxToDxf2 = pxToDxf;
                  // タッチ操作で確実に掴めるよう、ヒットエリアを 28 画面 px 相当に拡大
                  // (寸法線本体は 2px のままなので視覚的には変化なし、当たり判定だけ拡張)。
                  const handleHit2 = 28 * pxToDxf2;
                  const COL2 = "#06b6d4";
                  const COL_DARK2 = "#0e7490";
                  const vaDx = a.x - v.x, vaDy = a.y - v.y;
                  const vbDx = b.x - v.x, vbDy = b.y - v.y;
                  const ma2 = Math.hypot(vaDx, vaDy);
                  const mb2 = Math.hypot(vbDx, vbDy);
                  const angA = Math.atan2(vaDy, vaDx);
                  const angB = Math.atan2(vbDy, vbDx);
                  // 内角方向への正規化された差分 [-π, π]
                  let diff = angB - angA;
                  while (diff > Math.PI) diff -= 2 * Math.PI;
                  while (diff < -Math.PI) diff += 2 * Math.PI;
                  // 円弧半径
                  const defaultR = Math.min(ma2, mb2) * 0.4;
                  const arcR = m.arcRadius ?? defaultR;
                  // 円弧の両端点
                  const arcSx = v.x + arcR * Math.cos(angA);
                  const arcSy = v.y + arcR * Math.sin(angA);
                  const arcEx = v.x + arcR * Math.cos(angA + diff);
                  const arcEy = v.y + arcR * Math.sin(angA + diff);
                  // 円弧パス: SVG arc コマンドの sweep/largeArc フラグが
                  // <g scale(1,-1)> の影響で意図通りに描かれないケースがあるため、
                  // 確実性を優先してポリラインでサンプリングする方式にする。
                  // (angA → angA+diff へ等間隔で点を打ち、L コマンドで結ぶ)
                  const arcSteps = Math.max(8, Math.ceil(Math.abs(diff) * 16));
                  let arcPath = "";
                  for (let k = 0; k <= arcSteps; k++) {
                    const t = k / arcSteps;
                    const ak = angA + diff * t;
                    const xk = v.x + arcR * Math.cos(ak);
                    const yk = v.y + arcR * Math.sin(ak);
                    arcPath += `${k === 0 ? "M" : "L"} ${xk} ${yk} `;
                  }
                  // ラベル位置: 円弧中央 (頂点 + 角度中点方向に少し外側)
                  const midAng = angA + diff / 2;
                  // ラベル位置: 円弧の外側。ドラッグマーカー (半径 18px) +
                  // 文字高さ (~13px) を考慮し、48px 外側に置いて完全に被らないようにする。
                  const labelR = arcR + 48 * pxToDxf2;
                  const labelX = v.x + labelR * Math.cos(midAng);
                  const labelY = v.y + labelR * Math.sin(midAng);
                  // 矢印 (各端点に小さな三角形)。円弧の接線方向に沿わせる。
                  // 接線の方向: 端点の半径方向ベクトル ⊥ 回転方向
                  // 矢印サイズ: 旧 5x3 では小さくて方向が分からなかったため、
                  // 12x7 (画面 px 相当) に拡大して「どの辺を指しているか」を明確にする。
                  const arrowLen = 12 * pxToDxf2;
                  const arrowWidth = 7 * pxToDxf2;
                  const sign = diff > 0 ? 1 : -1;
                  // 始点側矢印: 半径方向 = (cos a, sin a)、接線 (sweep 方向) = sign * (-sin a, cos a)
                  const tanSx = sign * -Math.sin(angA);
                  const tanSy = sign * Math.cos(angA);
                  const normSx = Math.cos(angA);
                  const normSy = Math.sin(angA);
                  const sArrowTip = { x: arcSx, y: arcSy };
                  const sArrowBack1 = {
                    x: arcSx - tanSx * arrowLen + normSx * arrowWidth,
                    y: arcSy - tanSy * arrowLen + normSy * arrowWidth,
                  };
                  const sArrowBack2 = {
                    x: arcSx - tanSx * arrowLen - normSx * arrowWidth,
                    y: arcSy - tanSy * arrowLen - normSy * arrowWidth,
                  };
                  // 終点側矢印 (sweep 方向は反転、接線は逆)
                  const angE = angA + diff;
                  const tanEx = -sign * -Math.sin(angE);
                  const tanEy = -sign * Math.cos(angE);
                  const normEx = Math.cos(angE);
                  const normEy = Math.sin(angE);
                  const eArrowTip = { x: arcEx, y: arcEy };
                  const eArrowBack1 = {
                    x: arcEx - tanEx * arrowLen + normEx * arrowWidth,
                    y: arcEy - tanEy * arrowLen + normEy * arrowWidth,
                  };
                  const eArrowBack2 = {
                    x: arcEx - tanEx * arrowLen - normEx * arrowWidth,
                    y: arcEy - tanEy * arrowLen - normEy * arrowWidth,
                  };

                  return (
                    <g key={`meas-${i}`}>
                      {/* 2 本の辺 (頂点から各点まで、薄めの実線) */}
                      <line
                        x1={v.x}
                        y1={v.y}
                        x2={a.x}
                        y2={a.y}
                        stroke={COL2}
                        style={{ vectorEffect: "non-scaling-stroke", opacity: 0.6 }}
                      />
                      <line
                        x1={v.x}
                        y1={v.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={COL2}
                        style={{ vectorEffect: "non-scaling-stroke", opacity: 0.6 }}
                      />

                      {/* ピン (頂点 + 2 端点) */}
                      {[v, a, b].map((p, j) => (
                        <circle
                          key={`p${j}`}
                          cx={p.x}
                          cy={p.y}
                          r={3 * pxToDxf2}
                          fill={COL2}
                        />
                      ))}

                      {/* 角度を示す円弧 (本体) */}
                      <path
                        d={arcPath}
                        stroke={COL2}
                        strokeWidth={2}
                        fill="none"
                        style={{ vectorEffect: "non-scaling-stroke" }}
                      />
                      {/* 矢印 (両端) */}
                      <polygon
                        points={`${sArrowTip.x},${sArrowTip.y} ${sArrowBack1.x},${sArrowBack1.y} ${sArrowBack2.x},${sArrowBack2.y}`}
                        fill={COL2}
                      />
                      <polygon
                        points={`${eArrowTip.x},${eArrowTip.y} ${eArrowBack1.x},${eArrowBack1.y} ${eArrowBack2.x},${eArrowBack2.y}`}
                        fill={COL2}
                      />
                      {/* ドラッグ用ヒットエリア (太い透明 path、円弧上を放射方向ドラッグ) */}
                      <path
                        d={arcPath}
                        stroke="transparent"
                        strokeWidth={handleHit2}
                        fill="none"
                        style={{ cursor: "pointer" }}
                        onMouseDown={(e) => {
                          // PC でもタッチと同様に「クリックで選択 → マーカードラッグ」方式に統一。
                          // 直接ドラッグを開始せず、selectedDim をセットしてマーカーを出す。
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          setSelectedDim({ measIdx: i, axis: "arc" });
                        }}
                        onTouchStart={(e) => {
                          // タッチではタップで選択 → マーカーをドラッグ方式
                          e.stopPropagation();
                          setSelectedDim({ measIdx: i, axis: "arc" });
                        }}
                      />

                      {/* タッチ操作用ドラッグマーカー: 選択中のみ表示。円弧中点に配置。 */}
                      {selectedDim?.measIdx === i &&
                        selectedDim.axis === "arc" && (() => {
                          const mx = v.x + arcR * Math.cos(midAng);
                          const my = v.y + arcR * Math.sin(midAng);
                          const r = 18 * pxToDxf2;
                          return (
                            <g pointerEvents="all">
                              <circle
                                cx={mx}
                                cy={my}
                                r={r}
                                fill={COL2}
                                stroke="#fff"
                                strokeWidth={2 * pxToDxf2}
                                style={{ cursor: "move" }}
                                onMouseDown={(ev) =>
                                  onDimMouseDown(ev, i, "arc", arcR)
                                }
                                onTouchStart={(ev) => {
                                  ev.stopPropagation();
                                  const tch = ev.touches[0];
                                  if (!tch) return;
                                  dimDragRef.current = {
                                    idx: i,
                                    axis: "arc",
                                    startClientX: tch.clientX,
                                    startClientY: tch.clientY,
                                    startOffset: arcR,
                                  };
                                }}
                              />
                              {/* マーカー内の「⇕」アイコン */}
                              <text
                                x={mx}
                                y={my}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={r * 1.3}
                                fill="#fff"
                                pointerEvents="none"
                              >
                                ⇕
                              </text>
                            </g>
                          );
                        })()}

                      {/* ラベル (R 円弧の少し外側に counter-flip で配置) */}
                      <g transform={`scale(1 -1) translate(0 ${-2 * labelY})`}>
                        <text
                          x={labelX}
                          y={labelY}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={13 * pxToDxf2}
                          fill={COL_DARK2}
                          fontFamily="'Yu Gothic', sans-serif"
                          fontWeight={600}
                          style={{ vectorEffect: "non-scaling-stroke" }}
                        >
                          {m.label}
                        </text>
                      </g>
                    </g>
                  );
                }
                if (
                  m.kind === "diameter" &&
                  m.centerPoint &&
                  m.circleRadius
                ) {
                  // === 直径計測: 円の中心を通る水平な直径線 + φ ラベル ===
                  const c = m.centerPoint;
                  const r = m.circleRadius;
                  const COL = "#06b6d4";
                  const COL_DARK = "#0e7490";
                  const left = { x: c.x - r, y: c.y };
                  const right = { x: c.x + r, y: c.y };
                  const tickLenD = 4 * pxToDxf;
                  return (
                    <g key={`meas-${i}`}>
                      {/* 円の輪郭をハイライト */}
                      <circle
                        cx={c.x}
                        cy={c.y}
                        r={r}
                        fill="none"
                        stroke={COL}
                        strokeWidth={2}
                        style={{
                          vectorEffect: "non-scaling-stroke",
                          opacity: 0.5,
                        }}
                      />
                      {/* 直径線 (中心を通る水平) */}
                      <line
                        x1={left.x}
                        y1={left.y}
                        x2={right.x}
                        y2={right.y}
                        stroke={COL}
                        strokeWidth={2}
                        style={{ vectorEffect: "non-scaling-stroke" }}
                      />
                      {/* 両端の小さな矢印代わりの縦ティック */}
                      <line
                        x1={left.x}
                        y1={left.y - tickLenD}
                        x2={left.x}
                        y2={left.y + tickLenD}
                        stroke={COL}
                        strokeWidth={1.5}
                        style={{ vectorEffect: "non-scaling-stroke" }}
                      />
                      <line
                        x1={right.x}
                        y1={right.y - tickLenD}
                        x2={right.x}
                        y2={right.y + tickLenD}
                        stroke={COL}
                        strokeWidth={1.5}
                        style={{ vectorEffect: "non-scaling-stroke" }}
                      />
                      {/* 中心ピン */}
                      <circle
                        cx={c.x}
                        cy={c.y}
                        r={3 * pxToDxf}
                        fill={COL}
                      />
                      {/* ラベル: 直径線のすぐ上 */}
                      <g transform={`scale(1 -1) translate(0 ${-2 * c.y})`}>
                        <text
                          x={c.x}
                          y={c.y - 5 * pxToDxf}
                          textAnchor="middle"
                          dominantBaseline="alphabetic"
                          fontSize={13 * pxToDxf}
                          fill={COL_DARK}
                          fontFamily="'Yu Gothic', sans-serif"
                          fontWeight={700}
                          style={{ vectorEffect: "non-scaling-stroke" }}
                        >
                          {m.label}
                        </text>
                      </g>
                    </g>
                  );
                }
                if (m.kind !== "distance" || m.points.length < 2) return null;
                // === 距離計測: ΔX / ΔY それぞれの寸法線をドラッグ可能で描画 ===
                const a = m.points[0]!;
                const b = m.points[1]!;
                const dxAbs = Math.abs(b.x - a.x);
                const dyAbs = Math.abs(b.y - a.y);
                // 寸法線オフセット (DXF 単位)
                const dimYForX = m.dimYForX ?? Math.min(a.y, b.y) - (view ? view.w * 0.06 : 10);
                const dimXForY = m.dimXForY ?? Math.max(a.x, b.x) + (view ? view.w * 0.06 : 10);
                // ↑外側スコープの pxToDxf (state ベース) を直接利用するため、
                //  ここでは shadow しないように何も宣言しない。ズーム直後でも最新値が反映される。
                const tickLen = 4 * pxToDxf; // 寸法線端の小さなティック
                // タッチで確実に掴めるよう、ヒットエリアを 28 画面 px 相当に拡大。
                // (寸法線本体は 2px のままで視覚は変化せず、当たり判定だけ広がる)
                const handleHit = 28 * pxToDxf;
                // ラベル位置: ドラッグマーカー (半径 18px) と被らないよう
                // 寸法線から十分離す。文字高 ~13px も考慮し 26px 外側に置く。
                const labelOffset = 26 * pxToDxf;
                const unit = data?.units ?? "";
                const COL = "#06b6d4";
                const COL_DARK = "#0e7490";
                // 描画用の各座標
                const leftX = Math.min(a.x, b.x);
                const rightX = Math.max(a.x, b.x);
                const topY = Math.max(a.y, b.y);
                const bottomY = Math.min(a.y, b.y);
                const xMid = (a.x + b.x) / 2;
                const yMid2 = (a.y + b.y) / 2;
                const showX = dxAbs > 1e-4;
                const showY = dyAbs > 1e-4;
                return (
                  <g key={`meas-${i}`}>
                    {/* 軽い対角ガイド (うっすら) */}
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="#94a3b8"
                      strokeDasharray="2 3"
                      style={{ vectorEffect: "non-scaling-stroke", opacity: 0.5 }}
                    />

                    {/* ピン (2 点) */}
                    {[a, b].map((p, j) => (
                      <circle
                        key={`p${j}`}
                        cx={p.x}
                        cy={p.y}
                        r={3 * pxToDxf}
                        fill={COL}
                      />
                    ))}

                    {/* ===== ΔX 寸法線 (水平) ===== */}
                    {showX && (
                      <>
                        {/* 延長線 (各点から寸法線まで垂直に下ろす) */}
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={a.x}
                          y2={dimYForX}
                          stroke={COL}
                          style={{ vectorEffect: "non-scaling-stroke", opacity: 0.6 }}
                        />
                        <line
                          x1={b.x}
                          y1={b.y}
                          x2={b.x}
                          y2={dimYForX}
                          stroke={COL}
                          style={{ vectorEffect: "non-scaling-stroke", opacity: 0.6 }}
                        />
                        {/* 端ティック (寸法線端の短い縦棒) */}
                        <line
                          x1={leftX}
                          y1={dimYForX - tickLen}
                          x2={leftX}
                          y2={dimYForX + tickLen}
                          stroke={COL}
                          strokeWidth={1.5}
                          style={{ vectorEffect: "non-scaling-stroke" }}
                        />
                        <line
                          x1={rightX}
                          y1={dimYForX - tickLen}
                          x2={rightX}
                          y2={dimYForX + tickLen}
                          stroke={COL}
                          strokeWidth={1.5}
                          style={{ vectorEffect: "non-scaling-stroke" }}
                        />
                        {/* 寸法線本体 (見える線) */}
                        <line
                          x1={leftX}
                          y1={dimYForX}
                          x2={rightX}
                          y2={dimYForX}
                          stroke={COL}
                          strokeWidth={2}
                          style={{ vectorEffect: "non-scaling-stroke" }}
                        />
                        {/* ヒットエリア (透明)。クリックで選択 → マーカー表示。
                            PC でもタッチと同じ「タップ → マーカー → ドラッグ」に統一。 */}
                        <line
                          x1={leftX}
                          y1={dimYForX}
                          x2={rightX}
                          y2={dimYForX}
                          stroke="transparent"
                          strokeWidth={handleHit}
                          style={{ cursor: "pointer" }}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            setSelectedDim({ measIdx: i, axis: "x" });
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            setSelectedDim({ measIdx: i, axis: "x" });
                          }}
                        />
                        {/* タッチ操作用ドラッグマーカー (X 寸法線): 選択中のみ表示 */}
                        {selectedDim?.measIdx === i &&
                          selectedDim.axis === "x" && (
                            <g pointerEvents="all">
                              <circle
                                cx={xMid}
                                cy={dimYForX}
                                r={18 * pxToDxf}
                                fill={COL}
                                stroke="#fff"
                                strokeWidth={2 * pxToDxf}
                                style={{ cursor: "ns-resize" }}
                                onMouseDown={(ev) =>
                                  onDimMouseDown(ev, i, "x", dimYForX)
                                }
                                onTouchStart={(ev) => {
                                  ev.stopPropagation();
                                  const tch = ev.touches[0];
                                  if (!tch) return;
                                  dimDragRef.current = {
                                    idx: i,
                                    axis: "x",
                                    startClientX: tch.clientX,
                                    startClientY: tch.clientY,
                                    startOffset: dimYForX,
                                  };
                                }}
                              />
                              <text
                                x={xMid}
                                y={dimYForX}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={18 * pxToDxf * 1.2}
                                fill="#fff"
                                pointerEvents="none"
                              >
                                ⇕
                              </text>
                            </g>
                          )}
                        {/* ラベル (counter-flip で文字を上向きに) */}
                        <g transform={`scale(1 -1) translate(0 ${-2 * dimYForX})`}>
                          <text
                            x={xMid}
                            y={dimYForX - labelOffset}
                            textAnchor="middle"
                            fontSize={13 * pxToDxf}
                            fill={COL_DARK}
                            fontFamily="'Yu Gothic', sans-serif"
                            fontWeight={600}
                            style={{ vectorEffect: "non-scaling-stroke" }}
                          >
                            X {fmtNum(dxAbs)} {unit}
                          </text>
                        </g>
                      </>
                    )}

                    {/* ===== ΔY 寸法線 (垂直) ===== */}
                    {showY && (
                      <>
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={dimXForY}
                          y2={a.y}
                          stroke={COL}
                          style={{ vectorEffect: "non-scaling-stroke", opacity: 0.6 }}
                        />
                        <line
                          x1={b.x}
                          y1={b.y}
                          x2={dimXForY}
                          y2={b.y}
                          stroke={COL}
                          style={{ vectorEffect: "non-scaling-stroke", opacity: 0.6 }}
                        />
                        <line
                          x1={dimXForY - tickLen}
                          y1={bottomY}
                          x2={dimXForY + tickLen}
                          y2={bottomY}
                          stroke={COL}
                          strokeWidth={1.5}
                          style={{ vectorEffect: "non-scaling-stroke" }}
                        />
                        <line
                          x1={dimXForY - tickLen}
                          y1={topY}
                          x2={dimXForY + tickLen}
                          y2={topY}
                          stroke={COL}
                          strokeWidth={1.5}
                          style={{ vectorEffect: "non-scaling-stroke" }}
                        />
                        <line
                          x1={dimXForY}
                          y1={bottomY}
                          x2={dimXForY}
                          y2={topY}
                          stroke={COL}
                          strokeWidth={2}
                          style={{ vectorEffect: "non-scaling-stroke" }}
                        />
                        <line
                          x1={dimXForY}
                          y1={bottomY}
                          x2={dimXForY}
                          y2={topY}
                          stroke="transparent"
                          strokeWidth={handleHit}
                          style={{ cursor: "pointer" }}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            setSelectedDim({ measIdx: i, axis: "y" });
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation();
                            setSelectedDim({ measIdx: i, axis: "y" });
                          }}
                        />
                        {/* タッチ操作用ドラッグマーカー (Y 寸法線): 選択中のみ表示 */}
                        {selectedDim?.measIdx === i &&
                          selectedDim.axis === "y" && (
                            <g pointerEvents="all">
                              <circle
                                cx={dimXForY}
                                cy={yMid2}
                                r={18 * pxToDxf}
                                fill={COL}
                                stroke="#fff"
                                strokeWidth={2 * pxToDxf}
                                style={{ cursor: "ew-resize" }}
                                onMouseDown={(ev) =>
                                  onDimMouseDown(ev, i, "y", dimXForY)
                                }
                                onTouchStart={(ev) => {
                                  ev.stopPropagation();
                                  const tch = ev.touches[0];
                                  if (!tch) return;
                                  dimDragRef.current = {
                                    idx: i,
                                    axis: "y",
                                    startClientX: tch.clientX,
                                    startClientY: tch.clientY,
                                    startOffset: dimXForY,
                                  };
                                }}
                              />
                              <text
                                x={dimXForY}
                                y={yMid2}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fontSize={18 * pxToDxf * 1.2}
                                fill="#fff"
                                pointerEvents="none"
                              >
                                ⇔
                              </text>
                            </g>
                          )}
                        <g transform={`scale(1 -1) translate(0 ${-2 * yMid2})`}>
                          <text
                            x={dimXForY + labelOffset}
                            y={yMid2}
                            textAnchor="start"
                            dominantBaseline="middle"
                            fontSize={13 * pxToDxf}
                            fill={COL_DARK}
                            fontFamily="'Yu Gothic', sans-serif"
                            fontWeight={600}
                            style={{ vectorEffect: "non-scaling-stroke" }}
                          >
                            Y {fmtNum(dyAbs)} {unit}
                          </text>
                        </g>
                      </>
                    )}
                  </g>
                );
              })}

              {/* スナップインジケータ。種類別形状: */}
              {/*  endpoint=塗り■  midpoint=塗り▲  center/quadrant=塗り●  nearest=⊕ */}
              {/* 強いコントラストを得るため: 黄色塗り + 黒縁 + ガイドライン */}
              {(() => {
                if (!snap) return null;
                const s = 8 * pxToDxf; // 半サイズ (画面 8px 相当)
                const FILL = "#fde047"; // yellow-300
                const STROKE = "#000";
                const sw = 2 * pxToDxf; // 線幅 2px 相当
                return (
                  <g
                    transform={`translate(${snap.point.x} ${snap.point.y})`}
                    pointerEvents="none"
                  >
                    {/* 視認性アップ: snap 中心から外側に伸ばすガイドクロス (常時) */}
                    <line x1={-s * 2.5} y1={0} x2={s * 2.5} y2={0} stroke={STROKE} strokeWidth={sw * 0.5} />
                    <line x1={0} y1={-s * 2.5} x2={0} y2={s * 2.5} stroke={STROKE} strokeWidth={sw * 0.5} />
                    {snap.type === "endpoint" && (
                      <rect x={-s} y={-s} width={2 * s} height={2 * s} fill={FILL} stroke={STROKE} strokeWidth={sw} />
                    )}
                    {snap.type === "midpoint" && (
                      <polygon points={`0,${-s} ${s},${s * 0.6} ${-s},${s * 0.6}`} fill={FILL} stroke={STROKE} strokeWidth={sw} />
                    )}
                    {(snap.type === "center" || snap.type === "quadrant") && (
                      <circle cx={0} cy={0} r={s} fill={FILL} stroke={STROKE} strokeWidth={sw} />
                    )}
                    {snap.type === "nearest" && (
                      <>
                        <circle cx={0} cy={0} r={s * 0.8} fill={FILL} stroke={STROKE} strokeWidth={sw} />
                        <line x1={-s * 0.5} y1={-s * 0.5} x2={s * 0.5} y2={s * 0.5} stroke={STROKE} strokeWidth={sw} />
                        <line x1={-s * 0.5} y1={s * 0.5} x2={s * 0.5} y2={-s * 0.5} stroke={STROKE} strokeWidth={sw} />
                      </>
                    )}
                  </g>
                );
              })()}
            </g>
          </svg>
        )}

        {measurements.length > 0 && (
          <div className="absolute bottom-2 right-2 bg-white/90 border border-hair rounded-md shadow-sm p-2 text-xs max-h-48 overflow-auto">
            <div className="font-medium text-ink2 mb-1">計測結果</div>
            {measurements.map((m, i) => {
              if (m.kind === "distance" && m.points.length >= 2) {
                const a = m.points[0]!;
                const b = m.points[1]!;
                const dx = Math.abs(b.x - a.x);
                const dy = Math.abs(b.y - a.y);
                const unit = data?.units ?? "";
                return (
                  <div key={i} className="font-mono text-ink2">
                    {i + 1}. 📏 X {fmtNum(dx)} / Y {fmtNum(dy)} / {fmtNum(m.value)} {unit}
                  </div>
                );
              }
              if (m.kind === "diameter") {
                return (
                  <div key={i} className="font-mono text-ink2">
                    {i + 1}. φ {m.label.replace(/^φ\s*/, "")}
                  </div>
                );
              }
              return (
                <div key={i} className="font-mono text-ink2">
                  {i + 1}. 📐 {m.label}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ステータスバー: PC のみ (モバイルでは画面を最大化するため非表示) */}
      <div className="hidden md:flex items-center gap-3 px-2 py-1 border-t border-hair bg-bg text-[11px] text-ink3 font-mono shrink-0">
        {cursor && (
          <>
            <span>X: {fmtNum(cursor.x)}</span>
            <span>Y: {fmtNum(cursor.y)}</span>
          </>
        )}
        <span>Zoom: {zoomPercent}%</span>
        {snap && (
          <span className="text-amber-600">
            ⬚ {snap.type === "endpoint" ? "端点" : snap.type === "midpoint" ? "中点" : snap.type === "center" ? "中心" : snap.type === "quadrant" ? "象限" : "線上"}
          </span>
        )}
        <span className="ml-auto">
          ドラッグ=移動 / ホイール・2本指ピンチ=ズーム /{" "}
          {mode === "distance" && `クリックで 2 点指定 (${pinPoints.length}/2)`}
          {mode === "angle" && `クリックで頂点→辺端→辺端 (${pinPoints.length}/3)`}
        </span>
      </div>
    </div>
  );
}
