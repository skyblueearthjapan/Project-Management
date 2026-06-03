import { useCallback, useEffect, useRef, useState } from "react";
import { searchJobMaster, type JobMasterItem } from "../api/jobMaster";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** ユーザーが候補から確定した時に呼ばれる (件名/客先/納期を自動入力するため) */
  onPick?: (item: JobMasterItem) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * 日程表 (job_master_cache) を検索して工番を選ぶオートコンプリート。
 * Stock Management の `JobAutocomplete` と同じ操作感:
 *   - 200ms デバウンス
 *   - ↑↓ で候補移動、Enter で確定、Esc で閉じる
 *   - 該当なし時のメッセージ
 */
export function JobMasterAutocomplete({ value, onChange, onPick, placeholder, autoFocus }: Props) {
  const [items, setItems] = useState<JobMasterItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const lastPicked = useRef<string>("");

  const doSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await searchJobMaster(q);
      setItems(res.items);
      setHighlight(0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 200ms デバウンス
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => void doSearch(value), 200);
    return () => clearTimeout(id);
  }, [value, open, doSearch]);

  // 外側クリックで閉じる
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(item: JobMasterItem) {
    lastPicked.current = item.job_no;
    onChange(item.job_no);
    onPick?.(item);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        void doSearch(value);
      }
      setHighlight((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && items[highlight]) {
      e.preventDefault();
      choose(items[highlight]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          void doSearch(value);
        }}
        onKeyDown={onKey}
        placeholder={placeholder ?? "日程表から検索 (工番 / 件名 / 客先)"}
        className="w-full border border-hair rounded-md px-3 py-1.5 font-mono focus:outline-none focus:border-accent"
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-hair rounded-md shadow-lg max-h-72 overflow-auto">
          {loading && <div className="px-3 py-2 text-xs text-ink3">検索中…</div>}
          {!loading && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink3">
              該当する工番が日程表にありません{value && ` (${value})`}
            </div>
          )}
          {!loading &&
            items.map((it, i) => (
              <button
                key={it.job_no}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(it)}
                className={`block w-full text-left px-3 py-2 text-sm border-b border-hair last:border-b-0 ${
                  i === highlight ? "bg-cyan-50" : "bg-white hover:bg-bg"
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-medium">{it.job_no}</span>
                  {!it.is_active && (
                    <span className="text-[10px] text-ink4 border border-hair px-1 rounded">
                      終了
                    </span>
                  )}
                  <span className="text-ink3 text-xs">{it.customer}</span>
                  <span className="ml-auto text-[11px] text-ink4">
                    {it.delivery_date && `納期 ${it.delivery_date.slice(5).replace("-", "/")}`}
                  </span>
                </div>
                {it.title && <div className="text-xs text-ink2 mt-0.5">{it.title}</div>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
