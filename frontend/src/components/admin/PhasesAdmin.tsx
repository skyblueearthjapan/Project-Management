import { useProgressSteps, useUpdateProgressStep } from "../../api/admin";

export function PhasesAdmin() {
  const { data } = useProgressSteps();
  const update = useUpdateProgressStep();
  return (
    <div className="space-y-3 text-sm">
      <h2 className="font-medium">工程マスタ (10工程固定 / 表示名と並び順は変更可)</h2>
      <table className="w-full text-xs">
        <thead className="bg-bg text-ink3 text-left">
          <tr>
            <th className="p-2">並び順</th>
            <th className="p-2">コード</th>
            <th className="p-2">名称</th>
            <th className="p-2">略称</th>
            <th className="p-2">有効</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((s) => (
            <tr key={s.id} className="border-b border-hair">
              <td className="p-2">{s.sort_order}</td>
              <td className="p-2 font-mono">{s.code}</td>
              <td className="p-2">
                <input
                  defaultValue={s.name}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== s.name) update.mutate({ ...s, name: v });
                  }}
                  className="border border-transparent hover:border-hair focus:border-accent rounded-md px-2 py-0.5"
                />
              </td>
              <td className="p-2">
                <input
                  defaultValue={s.short_label}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== s.short_label) update.mutate({ ...s, short_label: v });
                  }}
                  className="w-16 border border-transparent hover:border-hair focus:border-accent rounded-md px-2 py-0.5"
                />
              </td>
              <td className="p-2">
                <button
                  onClick={() => update.mutate({ ...s, is_active: !s.is_active })}
                  className={`px-2 py-0.5 rounded-pill text-[11px] border ${
                    s.is_active ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-slate-50 border-hair text-ink3"
                  }`}
                >
                  {s.is_active ? "有効" : "無効"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
