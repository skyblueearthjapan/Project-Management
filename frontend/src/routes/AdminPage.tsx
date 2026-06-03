import { useState } from "react";
import { PhasesAdmin } from "../components/admin/PhasesAdmin";
import { UsersAdmin } from "../components/admin/UsersAdmin";
import { WorkersAdmin } from "../components/admin/WorkersAdmin";

// メール廃止 (REFACTOR_REMOVE_MAIL.md) に伴い「連絡先 / テンプレ / メール履歴」タブは撤去。
// Phase N: 「作業者 (電子印鑑)」タブ。
const TABS = ["phases", "users", "workers"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = {
  phases: "工程",
  users: "ユーザー",
  workers: "作業者",
};

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("phases");
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">管理</h1>
      <div className="flex gap-1 border-b border-hair">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
              tab === t
                ? "border-accent text-accent font-medium"
                : "border-transparent text-ink3 hover:text-ink"
            }`}
          >
            {LABELS[t]}
          </button>
        ))}
      </div>
      <section className="bg-white border border-hair rounded-md p-4">
        {tab === "phases" && <PhasesAdmin />}
        {tab === "users" && <UsersAdmin />}
        {tab === "workers" && <WorkersAdmin />}
      </section>
    </div>
  );
}
