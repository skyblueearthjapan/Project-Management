// Phase F: Marin-PDF のサムネサイドペインを移植。
// 元コード: Marin-PDF-Workspace/src/components/Thumbpane.tsx
// 変更点:
//   - PM v1 では split は無いので splitAfter / onToggleSplit 関連は削除
//   - PM v1 では rotate / merge も無いのでサムネは「現在ページ」「印刷除外」「差替対象」のみハイライト
//   - クラス名を Tailwind に置換
import type { RefObject } from "react";
import type { DocSource, ModeId, PageSlot } from "../types";
import MiniThumb from "./MiniThumb";

interface Props {
  slots: PageSlot[];
  docs: DocSource[];
  currentPage: number;
  onJump: (idx: number) => void;
  mode: ModeId;
  printOff: Set<number>;
  onTogglePrint: (idx: number) => void;
  replaceTarget: number | null;
  sourceLabelFor: (idx: number) => string;
  listRef?: RefObject<HTMLDivElement>;
  onListScroll?: () => void;
}

export default function Thumbpane({
  slots,
  docs,
  currentPage,
  onJump,
  mode,
  printOff,
  onTogglePrint,
  replaceTarget,
  sourceLabelFor,
  listRef,
  onListScroll,
}: Props) {
  const checking = mode === "print";
  return (
    // モバイル/タブレット縦 (md 未満) では非表示。160px の幅が PDF を圧迫するため。
    // デスクトップ (md 以上) でのみ表示。
    <div className="hidden md:flex w-[160px] flex-col bg-white border-l border-hair">
      {/* 右端に小さな余白を確保。
          JobDetailPage の DXF タブボタン (右上に absolute 配置) が右端の
          サムネ列に被るのを避けるため、ヘッダ・サムネ列ともに右側へ余白を入れる。 */}
      <div className="px-2 py-2 pr-8 border-b border-hair text-xs text-ink2 font-medium shrink-0">
        ページ · {slots.length}
      </div>
      <div
        className="flex-1 overflow-y-auto px-2 pt-3 pb-2 pr-8 space-y-2"
        ref={listRef}
        onScroll={onListScroll}
      >
        {slots.length === 0 && (
          <div className="text-xs text-ink4 text-center py-4">ページがありません</div>
        )}
        {slots.map((slot, i) => {
          const cur = currentPage === i + 1;
          const off = printOff.has(i);
          const isTarget = replaceTarget === i;
          return (
            <button
              type="button"
              key={i}
              className={`w-full text-left bg-white rounded-md p-1.5 border transition ${
                cur ? "border-accent ring-1 ring-accent" : "border-hair"
              } ${isTarget ? "border-amber-400 ring-1 ring-amber-300" : ""} hover:border-accent`}
              onClick={() => {
                if (checking) onTogglePrint(i);
                else onJump(i);
              }}
            >
              <MiniThumb slot={slot} docs={docs} />
              <div className="flex items-center justify-between mt-1 text-[10px] text-ink3">
                <span className="font-mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="truncate ml-1">{sourceLabelFor(i)}</span>
              </div>
              {checking && (
                <div className="flex justify-end mt-0.5">
                  <span
                    className={`inline-block w-3 h-3 rounded-sm border ${
                      off
                        ? "border-hair bg-white"
                        : "border-accent bg-accent text-white"
                    }`}
                    aria-label={off ? "印刷対象外" : "印刷対象"}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
