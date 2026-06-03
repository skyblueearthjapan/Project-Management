import { useEffect, useState } from "react";
import type { AxisRead } from "../api/jobs";

interface Props {
  axis: AxisRead;
  onRelease: () => void;
  // Phase H: 詳細画面の PDF 領域を広く取るため、進捗サブヘッダーをデフォルト折りたたみ可能にする
  jobId?: string;
  defaultCollapsed?: boolean;
}

// Phase H: 折りたたみ状態を localStorage で軸単位に記憶。
// キー設計: pm.axisProgress.collapsed.{jobId}.{axisId}
const storageKey = (jobId: string | undefined, axisId: number) =>
  `pm.axisProgress.collapsed.${jobId ?? "_"}.${axisId}`;

/**
 * 詳細画面の軸進捗サブヘッダー (モック準拠)。
 * - 折りたたみ時 (32-40px): シェブロン + 軸名 + 現工程ピル + ミニバー + % + [軸を出図]
 * - 展開時 (~80-100px): 10工程ティック + ラベル + 各種バッジ + [軸を出図]
 * - 状態は localStorage `pm.axisProgress.collapsed.{jobId}.{axisId}` で記憶
 */
export function AxisProgressSubHeader({
  axis,
  onRelease,
  jobId,
  defaultCollapsed = true,
}: Props) {
  const total = axis.progress.length || 10;
  const done = axis.progress.filter((p) => p.state === "done").length;
  const inprogIdx = axis.progress.findIndex((p) => p.state === "inprogress");
  const currentIdx = inprogIdx >= 0 ? inprogIdx : done > 0 ? done - 1 : -1;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const dotPct = currentIdx >= 0 ? ((currentIdx + 0.5) / total) * 100 : 0;
  const fillPct = total ? (done / total) * 100 : 0;
  const currentLabel =
    inprogIdx >= 0
      ? axis.progress[inprogIdx]?.short_label
      : currentIdx >= 0
      ? `${axis.progress[currentIdx]?.short_label} 完了`
      : "未着手";

  // Phase H: 初期値は localStorage から復元。SSR は考慮不要 (Vite SPA)。
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey(jobId, axis.id));
      if (v === null) return defaultCollapsed;
      return v === "true";
    } catch {
      return defaultCollapsed;
    }
  });

  // 軸切り替え時に localStorage から再読み込み
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey(jobId, axis.id));
      setCollapsed(v === null ? defaultCollapsed : v === "true");
    } catch {
      setCollapsed(defaultCollapsed);
    }
  }, [axis.id, jobId, defaultCollapsed]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey(jobId, axis.id), String(next));
      } catch {
        // localStorage 不可環境は無視
      }
      return next;
    });
  };

  if (collapsed) {
    return (
      <div className="bg-white border-b border-hair px-6 py-1.5 flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          title="進捗を展開"
          className="flex items-center gap-2 text-ink2 hover:text-accent min-w-0"
        >
          <span className="text-accent text-xs" aria-hidden="true">
            ▸
          </span>
          <span className="font-medium text-sm text-ink truncate">{axis.name}</span>
        </button>
        <span className="text-[11px] px-2 py-0.5 rounded-pill bg-cyan-50 border border-accent text-accent whitespace-nowrap">
          {currentLabel}
        </span>
        {axis.third_party_required && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-pill bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
            第三者
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="relative h-1 bg-hair rounded-pill">
            <div
              className="absolute inset-y-0 left-0 bg-accent rounded-pill"
              style={{ width: `${fillPct}%` }}
            />
          </div>
        </div>
        <span className="text-sm font-semibold tabular-nums text-ink whitespace-nowrap">
          {pct}
          <span className="text-[10px] text-ink3 font-normal">%</span>
        </span>
        <button
          type="button"
          onClick={onRelease}
          className="px-3 py-1 rounded-md bg-accent text-white text-xs hover:bg-cyan-600 whitespace-nowrap"
        >
          軸を出図
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border-b border-hair px-6 py-3 flex items-center gap-6">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={true}
          title="進捗を折りたたむ"
          className="flex items-center gap-2 text-ink2 hover:text-accent"
        >
          <span className="text-accent text-xs" aria-hidden="true">
            ▾
          </span>
          <span className="font-medium text-ink">{axis.name}</span>
        </button>
        <span className="text-xs px-2 py-0.5 rounded-pill bg-cyan-50 border border-accent text-accent">
          {currentLabel}
        </span>
        {axis.third_party_required && (
          <span className="text-[10px] px-2 py-0.5 rounded-pill bg-amber-50 text-amber-700 border border-amber-200">
            第三者
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="relative h-1 bg-hair rounded-pill">
          <div
            className="absolute inset-y-0 left-0 bg-accent rounded-pill"
            style={{ width: `${fillPct}%` }}
          />
          {axis.progress.map((p, i) => (
            <div
              key={p.step_id}
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-1.5 bg-white"
              style={{ left: `${((i + 1) / total) * 100}%` }}
            />
          ))}
          {currentIdx >= 0 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-accent shadow"
              style={{ left: `${dotPct}%` }}
            />
          )}
        </div>
        <div
          className="grid text-[10px] text-ink4 mt-1"
          style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
        >
          {axis.progress.map((p, i) => (
            <span
              key={p.step_id}
              className={`text-center truncate ${
                i === currentIdx
                  ? "text-accent font-medium"
                  : p.state === "done"
                  ? "text-ink3"
                  : "text-ink4"
              }`}
            >
              {p.short_label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">
            {pct}
            <span className="text-xs text-ink3 font-normal">%</span>
          </div>
          <div className="text-[10px] text-ink4">
            {done}/{total}
          </div>
        </div>
        <button
          type="button"
          onClick={onRelease}
          className="px-3 py-1.5 rounded-md bg-accent text-white text-sm hover:bg-cyan-600 whitespace-nowrap"
        >
          軸を出図
        </button>
      </div>
    </div>
  );
}
