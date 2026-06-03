import type { FilterValue } from "../api/jobs";

// Phase A 刈り込み: "starred" タブは廃止 (★ お気に入り機能廃止 — Round 3 合意)
const tabs: { value: FilterValue; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "inprog", label: "進行中" },
  { value: "over", label: "納期超過" },
  { value: "thisweek", label: "今週" },
];

export function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  counts?: Record<FilterValue, number>;
}) {
  return (
    <div role="tablist" className="flex gap-2 flex-wrap">
      {tabs.map((t) => {
        const n = counts?.[t.value];
        const isWarn = t.value === "over" && (n ?? 0) > 0;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className="filter-tab inline-flex items-center gap-1.5"
          >
            <span>{t.label}</span>
            {n !== undefined && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-pill ${
                  isWarn
                    ? "bg-red-50 text-red-600 border border-red-200"
                    : "bg-bg text-ink3 border border-hair"
                }`}
              >
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
