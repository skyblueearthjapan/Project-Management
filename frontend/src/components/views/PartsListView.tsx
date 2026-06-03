import { useState } from "react";
import {
  usePartsList,
  useRecheckAxisLinks,
  useDeletePartsListVersion,
} from "../../api/attachments";
import { LinkModal } from "../LinkModal";
import {
  LinkBrokenBadge,
  RecheckButton,
  RecheckToast,
  linkBrokenRowClass,
  type RecheckToastData,
} from "../LinkBrokenBadge";

// Phase B: 部品リスト View (VIEW-FIRST)
// 要件§6.1 (3) — バージョン履歴 (新しい順)、最新行に LATEST バッジ。
// クリックで該当ファイルを別タブで開く。
// Stock Management 移植: 旧アコーディオン AddForm は廃止、ヘッダの「+ 追加」で
// LinkModal (A/P/U モード) を開く。

interface Props {
  jobId: string;
  axisId: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function PartsListView({ jobId, axisId }: Props) {
  const { data, isLoading } = usePartsList(jobId, axisId);
  const recheck = useRecheckAxisLinks(jobId);
  const delVer = useDeletePartsListVersion(jobId, axisId);
  const [linkOpen, setLinkOpen] = useState(false);
  // Phase D Major-4: recheck 結果を 3 秒だけヘッダに toast 表示する。
  const [toast, setToast] = useState<RecheckToastData | null>(null);

  // versions は API 上 ASC で返るかもしれない。新しい順 (version_no desc) で再ソート。
  const versions = [...(data?.versions ?? [])].sort(
    (a, b) => b.version_no - a.version_no,
  );
  const latestNo = versions[0]?.version_no ?? null;
  const brokenCount = versions.filter((v) => v.is_link_broken).length;

  return (
    <div className="flex flex-col h-full text-sm">
      <header className="relative flex items-center gap-2 px-4 py-2 border-b border-hair shrink-0">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
          部品リスト
        </h3>
        <span className="text-xs text-ink3">{versions.length} バージョン</span>
        {brokenCount > 0 && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-300"
            title={`${brokenCount} 件がリンク切れ`}
          >
            🔗❌ {brokenCount}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLinkOpen(true)}
            className="text-xs px-2 py-1 rounded-md border border-accent text-accent hover:bg-cyan-50"
          >
            + 追加
          </button>
          <RecheckButton
            onClick={() =>
              recheck.mutate(axisId, {
                onSuccess: (d) => setToast(d),
              })
            }
            busy={recheck.isPending}
          />
        </span>
        <RecheckToast data={toast} onDismiss={() => setToast(null)} />
      </header>

      <div className="flex-1 overflow-auto">
        {isLoading && <p className="p-4 text-ink3">読み込み中…</p>}
        {!isLoading && versions.length === 0 && (
          <p className="p-4 text-ink3">部品リストはまだ登録されていません。</p>
        )}
        <ul className="divide-y divide-hair">
          {versions.map((v) => {
            const isLatest = v.version_no === latestNo;
            // H-3: job_id 必須化されたためクエリに添付。
            const fileUrl = `/api/v1/files/fileserver?job_id=${encodeURIComponent(jobId)}&path=${encodeURIComponent(v.file_path)}`;
            return (
              <li
                key={v.id}
                className={`px-4 py-2${linkBrokenRowClass(v.is_link_broken)}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span aria-hidden>📋</span>
                  <span className="font-medium">v{v.version_no}</span>
                  {isLatest && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-50 text-accent border border-accent">
                      LATEST
                    </span>
                  )}
                  {v.is_link_broken && (
                    <LinkBrokenBadge filePath={v.file_path} />
                  )}
                  {v.label && (
                    <span className="text-xs text-ink2">— {v.label}</span>
                  )}
                  <span className="ml-auto text-xs text-ink3 shrink-0">
                    {formatDate(v.created_at)}
                    {v.created_by && ` | ${v.created_by}`}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          `部品リスト v${v.version_no} を一覧から削除しますか？\n(ファイル実体は残ります、表示のみ非表示になります)`,
                        )
                      ) {
                        delVer.mutate(v.id);
                      }
                    }}
                    title="一覧から削除 (ファイル実体は保持)"
                    className="text-xs text-ink3 hover:text-red-600 px-1 shrink-0"
                    aria-label="削除"
                  >
                    🗑️
                  </button>
                </div>
                <div className="pl-6 mt-1">
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-accent hover:underline break-all"
                  >
                    {v.file_path}
                  </a>
                  {v.note && (
                    <div className="text-xs text-ink2 mt-1 whitespace-pre-wrap">
                      {v.note}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <LinkModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        kind="parts"
        jobId={jobId}
        axisId={axisId}
      />
    </div>
  );
}
