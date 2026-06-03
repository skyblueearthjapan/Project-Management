// Phase D: 行末に表示する「リンク切れ」共通バッジ。
// 4 つの View (関連資料 / 差替 / 部品リスト / PDF placeholder) で再利用する。
//
// title 属性で該当ファイルパスを tooltip 表示する。
// 色は CLAUDE.md §7 のグレースケール + 赤 (Tailwind red-500 系) を最小限に使用。

import { useEffect, useState } from "react";

interface Props {
  filePath: string;
  className?: string;
}

export function LinkBrokenBadge({ filePath, className = "" }: Props) {
  return (
    <span
      title={`リンク切れ: ${filePath}`}
      role="img"
      aria-label={`リンク切れ: ${filePath}`}
      className={
        "inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 " +
        "rounded bg-red-50 text-red-700 border border-red-300 whitespace-nowrap " +
        className
      }
    >
      <span aria-hidden>🔗❌</span>
      <span>リンク切れ</span>
    </span>
  );
}

// 行コンテナの左ボーダーを赤くするためのクラス文字列ヘルパ。
// 各 View 側で `<li className={... + linkBrokenRowClass(is_link_broken)}>` のように使う。
export function linkBrokenRowClass(broken: boolean): string {
  return broken ? " border-l-4 border-red-500 bg-red-50/40" : "";
}

// 「再チェック」ヘッダボタン。各 View / ヘッダエリアから呼ぶ。
interface RecheckButtonProps {
  onClick: () => void;
  busy: boolean;
  className?: string;
}

export function RecheckButton({
  onClick,
  busy,
  className = "",
}: RecheckButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="参照先ファイルの存在を即時確認"
      className={
        "text-xs px-2 py-0.5 rounded-md border border-hair text-ink2 " +
        "hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-wait " +
        className
      }
    >
      {busy ? "再チェック中…" : "🔄 再チェック"}
    </button>
  );
}

// Phase D Major-4: 軸 recheck の結果 (checked / ok / missing) を 3 秒だけ表示する toast。
// View ヘッダ右上に absolute 配置することで、リスト中身を覆わず結果を伝える。
export interface RecheckToastData {
  checked: number;
  ok: number;
  missing: number;
}

interface RecheckToastProps {
  data: RecheckToastData | null;
  onDismiss: () => void;
  durationMs?: number;
}

export function RecheckToast({
  data,
  onDismiss,
  durationMs = 3000,
}: RecheckToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (data === null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => {
      setVisible(false);
      // transition 完了を待たず即 dismiss してよい (state 同期だけ)
      onDismiss();
    }, durationMs);
    return () => window.clearTimeout(t);
  }, [data, durationMs, onDismiss]);

  if (data === null) return null;

  const hasMissing = data.missing > 0;
  const tone = hasMissing
    ? "bg-red-50 text-red-700 border-red-300"
    : "bg-cyan-50 text-accent border-accent";

  return (
    <span
      role="status"
      aria-live="polite"
      className={
        "pointer-events-none absolute top-2 right-2 text-[10px] font-bold " +
        "px-2 py-0.5 rounded border whitespace-nowrap transition-opacity duration-200 " +
        tone +
        " " +
        (visible ? "opacity-100" : "opacity-0")
      }
    >
      {hasMissing
        ? `🔗❌ ${data.missing} 件リンク切れ (${data.ok}/${data.checked} OK)`
        : `✅ ${data.ok}/${data.checked} OK`}
    </span>
  );
}
