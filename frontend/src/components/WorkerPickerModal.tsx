import { useWorkers, type Worker } from "../api/workers";
import { DataNameStamp } from "./DataNameStamp";
import { Modal } from "./Modal";
import { workersForPhase } from "./phaseWorkers";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (worker: Worker) => void;
  /** 今日の日付 (プレビュー用 YYYY-MM-DD) */
  today: string;
  /** どの工程の押印か (short_label)。指定があればその工程の担当者だけを表示する。 */
  phaseShortLabel?: string;
}

export function WorkerPickerModal({
  open,
  onClose,
  onPick,
  today,
  phaseShortLabel,
}: Props) {
  const { data, isLoading } = useWorkers(false);

  // 工程ごとに押印できる作業員を絞り込む。
  // workersForPhase が null (未定義) なら全員許可で従来挙動。
  const allowedNames = phaseShortLabel ? workersForPhase(phaseShortLabel) : null;
  const filtered = !data
    ? undefined
    : allowedNames === null
      ? data
      : data.filter((w) => allowedNames.includes(w.name));

  const title = phaseShortLabel
    ? `${phaseShortLabel} の押印者を選択`
    : "押印する作業者を選択";

  return (
    <Modal open={open} title={title} onClose={onClose} width="760px">
      {isLoading && <p className="text-ink3 text-sm">読み込み中…</p>}
      {filtered && filtered.length === 0 && (
        <p className="text-ink3 text-sm">
          この工程には押印を担当できる作業者が登録されていません。
        </p>
      )}
      {/* 5 名一行を基本とする。
          1 行 5 列、各セルは最小 120px (印影 64 + 余白)。画面が狭くなれば
          auto-fit が自動的に列数を減らして折返す。 */}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        }}
      >
        {filtered?.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => {
              onPick(w);
            }}
            className="flex flex-col items-center gap-1 p-2 border border-hair rounded-md hover:border-accent hover:bg-bg transition"
          >
            <DataNameStamp
              name={w.name}
              department={w.department}
              color={w.stamp_color}
              date={today}
              size={64}
            />
            <span className="text-xs text-ink font-medium">{w.name}</span>
            {w.department && (
              <span className="text-[10px] text-ink3">{w.department}</span>
            )}
          </button>
        ))}
      </div>
    </Modal>
  );
}
