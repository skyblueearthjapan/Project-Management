// Phase F: Marin-PDF の 1 ページレンダラを移植。
// 元コード: Marin-PDF-Workspace/src/components/PdfPageView.tsx
// 変更点:
//   - クラス名ベース (`.pdf-page`) → Tailwind ユーティリティに置換
//   - sourceLabel / hideForPrint / replacing / badge の見た目は本アプリ shell に合わせて簡素化
//   - IntersectionObserver による仮想化ロジックは原則そのまま
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DocSource, PageSlot, ZoomPercent } from "../types";
import { evictCanvas, renderPage } from "../pdf/renderer";

interface Props {
  slot: PageSlot;
  docs: DocSource[];
  zoom: ZoomPercent;
  viewerWidth: number;
  pageNumber: number;
  totalPages: number;
  sourceLabel?: string | null;
  selectable?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  hideForPrint?: boolean;
  replacing?: boolean;
  badge?: ReactNode;
  onClick?: () => void;
}

const MIN_PAGE_WIDTH = 120;
// Render pages within this margin of the viewport; pages outside are evicted to release memory.
const RENDER_MARGIN_PX = 800;

export default function PdfPageView({
  slot,
  docs,
  zoom,
  viewerWidth,
  pageNumber,
  totalPages,
  sourceLabel,
  selectable,
  selected,
  dimmed,
  hideForPrint,
  replacing,
  badge,
  onClick,
}: Props) {
  // 既定の見え方を従来の 75% 相当に縮小して「100% = ビューア幅の 0.75 倍」に。
  // これで初期表示でも左右の端が見切れず、必要なら ＋ ボタンで広げられる。
  const FIT_RATIO = 0.75;
  const pageWidthCss = Math.max(
    MIN_PAGE_WIDTH,
    Math.round(viewerWidth * (zoom / 100) * FIT_RATIO),
  );
  const cardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState(false);
  const [inView, setInView] = useState(false);
  const [rendered, setRendered] = useState(false);

  const effective = slot.replacedBy ?? slot;
  const targetDoc = docs.find((d) => d.id === effective.srcDocId);
  const rotation = slot.rotation ?? 0;

  // Visibility observer — render only when nearby, evict canvas when far.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting);
      },
      {
        rootMargin: `${RENDER_MARGIN_PX}px 0px ${RENDER_MARGIN_PX}px 0px`,
        threshold: 0,
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Render / cancel / evict
  useEffect(() => {
    if (!targetDoc) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!inView) {
      // Out of range — release GPU/CPU memory tied to this canvas.
      evictCanvas(canvas);
      setRendered(false);
      return;
    }
    setError(false);
    const handle = renderPage(targetDoc.pdf, {
      pageIndex: effective.srcPageIndex,
      maxWidthCss: pageWidthCss,
      canvas,
      rotation,
    });
    let cancelled = false;
    handle.promise
      .then((res) => {
        if (cancelled) return;
        setSize({ w: res.cssWidth, h: res.cssHeight });
        setRendered(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        if (name === "AbortError") return;
        console.error("renderPage failed", e);
        setError(true);
        setRendered(false);
      });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [targetDoc, effective.srcPageIndex, pageWidthCss, rotation, inView]);

  // Reserve the page footprint via aspect-ratio. Fall back to A4 portrait until we know.
  const aspectRatio = size ? `${size.w} / ${size.h}` : `1 / 1.414`;

  // 選択 / ハイライト / 印刷除外などの状態を Tailwind クラスで合成。
  const borderCls = selected
    ? "ring-2 ring-accent"
    : replacing
      ? "ring-2 ring-amber-400"
      : "ring-1 ring-hair";
  const cursorCls = selectable ? "cursor-pointer hover:ring-accent" : "";
  const opacityCls = dimmed ? "opacity-40" : "";

  return (
    <div
      ref={cardRef}
      data-pdf-page=""
      className={`relative bg-white shadow-sm rounded-sm mb-4 mx-auto ${borderCls} ${cursorCls} ${opacityCls} transition`}
      onClick={onClick}
      style={{ aspectRatio, width: `${pageWidthCss}px` }}
    >
      {sourceLabel && (
        <div className="absolute top-1 left-1 z-10 text-[10px] px-1.5 py-0.5 rounded-sm bg-white/85 border border-hair text-ink3">
          {sourceLabel}
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className="block max-w-full max-h-full"
          style={{ visibility: rendered ? "visible" : "hidden" }}
        />
        {!rendered && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-ink4 text-xs">
            <div className="w-4 h-4 border-2 border-hair border-t-accent rounded-pill animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-red-500 text-xs">
            ページの表示に失敗しました
          </div>
        )}
      </div>
      <div className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-white/85 border border-hair text-ink3 font-mono">
        {pageNumber} / {totalPages}
      </div>
      {hideForPrint && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/55 pointer-events-none">
          <span className="text-xs px-2 py-1 rounded-pill bg-white border border-hair text-ink3 shadow-sm">
            印刷対象外
          </span>
        </div>
      )}
      {replacing && (
        <div className="absolute inset-x-0 top-0 flex justify-center pointer-events-none">
          <div className="mt-1 text-[10px] px-2 py-0.5 rounded-pill bg-amber-100 border border-amber-300 text-amber-700">
            差し替え対象のページ
          </div>
        </div>
      )}
      {badge && <div className="absolute top-1 right-1 z-10">{badge}</div>}
    </div>
  );
}
