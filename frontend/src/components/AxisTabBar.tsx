// Phase N-2: 工番一覧の各行で、押印グリッドを軸ごとに切替えるタブバー。
//
// 5 軸あっても 5 行に並べず、1 行 (タブ + 選択中の軸の押印グリッド) で省スペース化する。
// 進捗バーラベルと近い視覚で違和感なく使えるよう、コンパクトなボタン列にする。
import type { AxisRead } from "../api/jobs";

interface Props {
  axes: AxisRead[];
  selectedAxisId: number;
  onSelect: (axisId: number) => void;
}

export function AxisTabBar({ axes, selectedAxisId, onSelect }: Props) {
  if (axes.length === 0) return null;
  return (
    <div
      className="flex gap-1 overflow-x-auto pb-0.5"
      // 親 article は onClick で navigate するので、タブ操作が伝播しないように
      onClick={(e) => e.stopPropagation()}
    >
      {axes.map((ax) => {
        const isActive = ax.id === selectedAxisId;
        return (
          <button
            key={ax.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(ax.id);
            }}
            className={`px-3 py-1 text-xs rounded-t-md shrink-0 border-b-0 transition ${
              isActive
                ? "bg-accent text-white font-medium border border-accent"
                : "border border-hair text-ink2 hover:border-accent bg-bg"
            }`}
            title={ax.name}
          >
            {ax.name}
          </button>
        );
      })}
    </div>
  );
}
