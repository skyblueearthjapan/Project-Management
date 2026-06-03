import type { AxisRead } from "../api/jobs";

interface Props {
  axes: AxisRead[];
}

// DB の short_label (省略名) → 正規名称への対応。
// 工番一覧で「省略せずに正規の工程名を表示したい」という要件に応えるため、
// フロント側だけで完全名に展開する (admin 画面は short_label のまま運用)。
//
// DB 実値 (確認済): 前検, 設計, 在庫, 購入, 材料, M検, 工場, 水す, ボル, 組立。
// 表記揺れ (前件 / M件 / 組み立て) も同じ正規名に解決できるよう両方を登録しておく。
const FULL_LABEL: Record<string, string> = {
  前検: "出図前チェック",
  前件: "出図前チェック",
  設計: "出図",
  在庫: "在庫チェック",
  購入: "購入部品手配",
  材料: "材料取り",
  M検: "材料取りチェック",
  M件: "材料取りチェック",
  工場: "工場出図",
  水す: "水すまし",
  ボル: "ボルト取り",
  組立: "組立出図",
  "組み立て": "組立出図",
};

function fullLabel(shortLabel: string): string {
  return FULL_LABEL[shortLabel] ?? shortLabel;
}

export interface PhaseAggregate {
  step_id: number;
  short_label: string;
  sort_order: number;
  /** 全軸 done なら done、いずれかが inprogress なら inprogress、それ以外 notstarted */
  state: "notstarted" | "inprogress" | "done";
}

/**
 * StampGrid 等の外部呼出し用に同ロジックを公開。
 * MasterProgressBar と StampGrid で 10 工程の並びを完全に揃えるため共通化する。
 */
export function aggregatePhases(axes: AxisRead[]): PhaseAggregate[] {
  return aggregate(axes);
}

function aggregate(axes: AxisRead[]): PhaseAggregate[] {
  const byStep = new Map<number, { ax: AxisRead["progress"][number]; count: number; done: number; inprog: number }>();
  for (const a of axes) {
    for (const p of a.progress) {
      const cur = byStep.get(p.step_id);
      if (!cur) {
        byStep.set(p.step_id, {
          ax: p,
          count: 1,
          done: p.state === "done" ? 1 : 0,
          inprog: p.state === "inprogress" ? 1 : 0,
        });
      } else {
        cur.count += 1;
        if (p.state === "done") cur.done += 1;
        if (p.state === "inprogress") cur.inprog += 1;
      }
    }
  }
  return [...byStep.values()]
    .sort((a, b) => (a.ax.sort_order ?? 0) - (b.ax.sort_order ?? 0))
    .map((v) => ({
      step_id: v.ax.step_id,
      short_label: v.ax.short_label ?? "?",
      sort_order: v.ax.sort_order ?? 0,
      state:
        v.done === v.count ? "done" : v.inprog > 0 ? "inprogress" : "notstarted",
    }));
}

/**
 * 一覧画面 1行に出す全工程進捗バー。
 * - 10 工程のティック
 * - 現在 (inprogress または最後の done) の位置にドット
 * - 各工程のラベル (現在工程はアクセント色)
 */
export function MasterProgressBar({ axes }: Props) {
  const phases = aggregate(axes);
  const total = phases.length || 10;

  const doneCount = phases.filter((p) => p.state === "done").length;
  const inprogIdx = phases.findIndex((p) => p.state === "inprogress");
  const currentIdx = inprogIdx >= 0 ? inprogIdx : doneCount > 0 ? doneCount - 1 : -1;

  const fillPct = total > 0 ? (doneCount / total) * 100 : 0;
  const dotPct = currentIdx >= 0 ? ((currentIdx + 0.5) / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="relative h-1 bg-hair rounded-pill">
        <div
          className="absolute inset-y-0 left-0 bg-accent rounded-pill"
          style={{ width: `${fillPct}%` }}
        />
        {phases.map((p, i) => (
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
            title={`現在: ${fullLabel(phases[currentIdx]?.short_label ?? "")}`}
          />
        )}
      </div>
      {/* 工程名は正規名称をフル表示。狭い列幅でも崩れないよう 2 行折返し可。
          break-all で和文も安全に折り返す。leading-tight で 2 行でも詰めて見せる。 */}
      <div
        className="grid text-[10px] text-ink4 mt-1 gap-x-0.5"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {phases.map((p, i) => (
          <span
            key={p.step_id}
            title={fullLabel(p.short_label)}
            className={`text-center leading-tight whitespace-normal break-all ${
              i === currentIdx
                ? "text-accent font-medium"
                : p.state === "done"
                ? "text-ink3"
                : "text-ink4"
            }`}
          >
            {fullLabel(p.short_label)}
          </span>
        ))}
      </div>
    </div>
  );
}
