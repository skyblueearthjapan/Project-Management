// Phase N-2: 軸単位の電子データネーム印グリッド。
// 1 軸 × 10 工程の押印枠を 1 行に並べる。タブで軸を切り替えると本コンポーネント
// が axis prop を入れ替えて再描画される。
import { useState } from "react";
import type { AxisRead } from "../api/jobs";
import type { AxisPhaseStamp } from "../api/axis-stamps";
import {
  useApplyAxisStamp,
  useCancelAxisStamp,
  useSetAxisDueDate,
} from "../api/axis-stamps";
import type { Worker } from "../api/workers";
import { DataNameStamp } from "./DataNameStamp";
import { WorkerPickerModal } from "./WorkerPickerModal";

interface PhaseSlot {
  step_id: number;
  short_label: string;
  sort_order: number;
}

interface Props {
  axis: AxisRead;
  /** MasterProgressBar が集約済みの 10 工程順 (step_id / short_label / sort_order). */
  phases: PhaseSlot[];
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function stampByStepId(
  stamps: AxisPhaseStamp[],
  stepId: number,
): AxisPhaseStamp | undefined {
  return stamps.find((s) => s.step_id === stepId);
}

function formatDueDateShort(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}/${Number(m[2])}`;
}

/**
 * 工番一覧の各軸タブに連動する 10 工程の電子データネーム印グリッド。
 *   - 各セル: 期日 + 印影 (or 押印ボタン)
 *   - クリック (印影セル) → ワーカー選択モーダル / 取消確認
 *   - 期日ラベル クリック → 日付ピッカー表示 (簡易)
 *
 * 押印すると「この軸の」 axis_progress.state が done に同期される (他軸は不変)。
 */
export function StampGrid({ axis, phases }: Props) {
  const [pickerStepId, setPickerStepId] = useState<number | null>(null);
  const [dueEditStepId, setDueEditStepId] = useState<number | null>(null);
  const today = todayIso();

  const applyMut = useApplyAxisStamp(axis.id);
  const cancelMut = useCancelAxisStamp(axis.id);
  const dueDateMut = useSetAxisDueDate(axis.id);

  const onCellClick = (
    stepId: number,
    existing: AxisPhaseStamp | undefined,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (existing && existing.worker_id !== null) {
      if (window.confirm(`${existing.worker_name} の印を取消しますか?`)) {
        cancelMut.mutate(stepId);
      }
    } else {
      setPickerStepId(stepId);
    }
  };

  const onPick = (worker: Worker) => {
    if (pickerStepId === null) return;
    applyMut.mutate(
      { step_id: pickerStepId, worker_id: worker.id },
      { onSettled: () => setPickerStepId(null) },
    );
  };

  return (
    <div
      className="grid gap-1 mt-1"
      style={{
        gridTemplateColumns: `repeat(${phases.length || 10}, minmax(0, 1fr))`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {phases.map((p) => {
        const existing = stampByStepId(axis.phase_stamps, p.step_id);
        const stamped = Boolean(existing && existing.worker_id !== null);
        const dueShort = existing
          ? formatDueDateShort(existing.due_date)
          : null;

        return (
          <div
            key={p.step_id}
            className="flex flex-col items-stretch border border-hair rounded-md bg-white overflow-hidden"
          >
            {/* 上段: 期日 */}
            {dueEditStepId === p.step_id ? (
              <input
                type="date"
                autoFocus
                defaultValue={existing?.due_date ?? ""}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const v = e.target.value || null;
                  dueDateMut.mutate(
                    { step_id: p.step_id, due_date: v },
                    { onSettled: () => setDueEditStepId(null) },
                  );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setDueEditStepId(null);
                }}
                className="text-[10px] px-1 py-0.5 border-b border-hair w-full"
              />
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDueEditStepId(p.step_id);
                }}
                className={`text-[10px] px-1 py-0.5 border-b border-hair text-center hover:bg-bg ${
                  dueShort ? "text-ink2" : "text-ink4"
                }`}
                title="期日を設定"
              >
                {dueShort ? `期日 ${dueShort}` : "期日 -"}
              </button>
            )}

            {/* 下段: 印影 or 押印プレースホルダ。
                文字をはっきり見せるため、印影 64px × セル h-20 (80px) を確保。 */}
            <button
              type="button"
              onClick={(e) => onCellClick(p.step_id, existing, e)}
              className="flex items-center justify-center h-20 hover:bg-bg transition"
              title={
                stamped
                  ? `${existing!.worker_name} ${existing!.stamped_at} (クリックで取消)`
                  : "クリックして押印"
              }
            >
              {stamped ? (
                <DataNameStamp
                  name={existing!.worker_name ?? "?"}
                  department={existing!.worker_department}
                  color={existing!.stamp_color ?? "#c0392b"}
                  date={existing!.stamped_at}
                  size={64}
                />
              ) : (
                <span className="text-[11px] text-ink4">押印</span>
              )}
            </button>
          </div>
        );
      })}

      <WorkerPickerModal
        open={pickerStepId !== null}
        onClose={() => setPickerStepId(null)}
        onPick={onPick}
        today={today}
        // 該当工程の short_label を渡してピッカーをその工程の担当者だけに絞る
        phaseShortLabel={
          phases.find((p) => p.step_id === pickerStepId)?.short_label
        }
      />
    </div>
  );
}
