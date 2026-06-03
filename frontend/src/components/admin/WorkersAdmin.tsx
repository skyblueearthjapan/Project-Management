import { useState } from "react";
import {
  useCreateWorker,
  useUpdateWorker,
  useWorkers,
  type Worker,
  type WorkerCreate,
} from "../../api/workers";
import { DataNameStamp } from "../DataNameStamp";

const empty: WorkerCreate = {
  name: "",
  department: null,
  stamp_color: "#c0392b",
  active: true,
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function WorkersAdmin() {
  const { data } = useWorkers(true);
  const create = useCreateWorker();
  const update = useUpdateWorker();
  const [draft, setDraft] = useState<WorkerCreate>(empty);
  const today = todayIso();

  return (
    <div className="space-y-4 text-sm">
      <h2 className="font-medium">作業者 (電子印鑑)</h2>
      <p className="text-xs text-ink3">
        工番一覧に表示される電子データネーム印 (シヤチハタ風) の作業者マスタ。
        無効化すると押印選択肢から外れます (履歴は残ります)。
      </p>

      {/* 新規追加フォーム + プレビュー */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name) return;
          create.mutate(draft, { onSuccess: () => setDraft(empty) });
        }}
        className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_80px] gap-2 items-end"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink3">名前 (印面)</span>
          <input
            required
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="例: 山田"
            className="border border-hair rounded-md px-3 py-1.5"
            maxLength={32}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink3">所属 (下アーク)</span>
          <input
            value={draft.department ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, department: e.target.value || null })
            }
            placeholder="例: 設計部"
            className="border border-hair rounded-md px-3 py-1.5"
            maxLength={32}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink3">印影色</span>
          <input
            type="color"
            value={draft.stamp_color ?? "#c0392b"}
            onChange={(e) =>
              setDraft({ ...draft, stamp_color: e.target.value })
            }
            className="h-9 w-full border border-hair rounded-md"
          />
        </label>
        <div className="flex flex-col items-center gap-1">
          <span className="text-[11px] text-ink3">プレビュー</span>
          <DataNameStamp
            name={draft.name || "印"}
            department={draft.department}
            color={draft.stamp_color ?? "#c0392b"}
            date={today}
            size={56}
          />
        </div>
        <button
          type="submit"
          disabled={create.isPending}
          className="md:col-span-4 px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
        >
          追加
        </button>
      </form>

      {/* 一覧 */}
      <table className="w-full text-xs">
        <thead className="bg-bg text-ink3 text-left">
          <tr>
            <th className="p-2">印影</th>
            <th className="p-2">名前</th>
            <th className="p-2">所属</th>
            <th className="p-2">色</th>
            <th className="p-2">状態</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((w: Worker) => (
            <tr key={w.id} className="border-b border-hair">
              <td className="p-2">
                <DataNameStamp
                  name={w.name}
                  department={w.department}
                  color={w.stamp_color}
                  date={today}
                  size={48}
                />
              </td>
              <td className="p-2">{w.name}</td>
              <td className="p-2">{w.department ?? "-"}</td>
              <td className="p-2">
                <span
                  className="inline-block w-4 h-4 rounded border border-hair align-middle"
                  style={{ backgroundColor: w.stamp_color }}
                />
                <span className="ml-2 font-mono text-[11px]">
                  {w.stamp_color}
                </span>
              </td>
              <td className="p-2">
                <button
                  type="button"
                  onClick={() =>
                    update.mutate({
                      id: w.id,
                      body: { active: !w.active },
                    })
                  }
                  className={`px-2 py-0.5 rounded-pill text-[11px] border ${
                    w.active
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : "bg-slate-50 border-hair text-ink3"
                  }`}
                >
                  {w.active ? "有効" : "無効"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
