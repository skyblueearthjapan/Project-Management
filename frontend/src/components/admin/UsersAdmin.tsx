import { useState } from "react";
import { useCreateUser, useUpdateUser, useUsers, type User } from "../../api/admin";

const empty: Omit<User, "id"> = {
  code: "",
  display_name: "",
  email: null,
  department: null,
  is_active: true,
};

export function UsersAdmin() {
  const { data } = useUsers();
  const create = useCreateUser();
  const update = useUpdateUser();
  const [draft, setDraft] = useState<Omit<User, "id">>(empty);

  return (
    <div className="space-y-4 text-sm">
      <h2 className="font-medium">ユーザー (社員名簿)</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.code || !draft.display_name) return;
          create.mutate(draft, { onSuccess: () => setDraft(empty) });
        }}
        className="grid grid-cols-1 md:grid-cols-4 gap-2"
      >
        <input
          required
          value={draft.code}
          onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          placeholder="社員番号"
          className="border border-hair rounded-md px-3 py-1.5"
        />
        <input
          required
          value={draft.display_name}
          onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
          placeholder="表示名"
          className="border border-hair rounded-md px-3 py-1.5"
        />
        <input
          type="email"
          value={draft.email ?? ""}
          onChange={(e) => setDraft({ ...draft, email: e.target.value || null })}
          placeholder="email"
          className="border border-hair rounded-md px-3 py-1.5"
        />
        <input
          value={draft.department ?? ""}
          onChange={(e) => setDraft({ ...draft, department: e.target.value || null })}
          placeholder="部署"
          className="border border-hair rounded-md px-3 py-1.5"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="md:col-span-4 px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
        >
          追加
        </button>
      </form>
      <table className="w-full text-xs">
        <thead className="bg-bg text-ink3 text-left">
          <tr>
            <th className="p-2">社員番号</th>
            <th className="p-2">表示名</th>
            <th className="p-2">email</th>
            <th className="p-2">部署</th>
            <th className="p-2">有効</th>
          </tr>
        </thead>
        <tbody>
          {data?.map((u) => (
            <tr key={u.id} className="border-b border-hair">
              <td className="p-2 font-mono">{u.code}</td>
              <td className="p-2">{u.display_name}</td>
              <td className="p-2">{u.email}</td>
              <td className="p-2">{u.department}</td>
              <td className="p-2">
                <button
                  onClick={() => update.mutate({ ...u, is_active: !u.is_active })}
                  className={`px-2 py-0.5 rounded-pill text-[11px] border ${
                    u.is_active ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-slate-50 border-hair text-ink3"
                  }`}
                >
                  {u.is_active ? "有効" : "無効"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
