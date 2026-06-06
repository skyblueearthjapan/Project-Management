import { useState } from "react";
import {
  useJobInstructions,
  useDeleteJobInstruction,
  jobInstructionFileUrl,
  type JobInstruction,
} from "../../api/jobInstructions";

// 出図お知らせ×DOVE連携 (WS-B): 工番別指示書 View。
// - RelatedDocsView を雛形にしつつ Job 単位 (axisId 無し) — 契約 §3.2。
// - 一覧 + 閲覧 + ソフトデリートが主機能。初版は EXE 登録が主経路のため「+ 追加」UI は持たない。
// - 開くリンクは DB-id 解決型の専用配信 (契約 §2.3): /api/v1/files/job-instruction/${id}。
//   /files/fileserver は job_id をパスに含まない指示書では使えない。
// - 🗑️ はソフトデリート (DB 行のみ非表示化、ファイル実体は保持 — CLAUDE.md §2.1)。

interface Props {
  jobId: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fileNameOf(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

export function KobanInstructionView({ jobId }: Props) {
  const { data, isLoading } = useJobInstructions(jobId);
  const delInstruction = useDeleteJobInstruction(jobId);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected: JobInstruction | undefined = data?.find(
    (d) => d.id === selectedId,
  );

  return (
    <div className="flex flex-col h-full text-sm">
      <header className="relative flex items-center gap-2 px-4 py-2 border-b border-hair shrink-0">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
          工番別指示書
        </h3>
        <span className="text-xs text-ink3">{data?.length ?? 0} 件</span>
      </header>

      <div className="flex-1 overflow-auto">
        {isLoading && <p className="p-4 text-ink3">読み込み中…</p>}
        {data && data.length === 0 && (
          <p className="p-4 text-ink3">工番別指示書はまだありません。</p>
        )}
        <ul className="divide-y divide-hair">
          {data?.map((d) => {
            const isSelected = d.id === selectedId;
            const fileUrl = jobInstructionFileUrl(d.id);
            return (
              <li
                key={d.id}
                className={`px-4 py-2 cursor-pointer hover:bg-cyan-50 ${
                  isSelected ? "bg-cyan-50" : ""
                }`}
                onClick={() => setSelectedId(isSelected ? null : d.id)}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden>📄</span>
                  <span className="font-medium truncate">
                    {d.original_name ?? fileNameOf(d.file_path)}
                  </span>
                  <span className="ml-auto text-xs text-ink3 shrink-0">
                    {formatDate(d.created_at)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          "この工番別指示書を一覧から削除しますか？\n(ファイル実体は残ります、表示のみ非表示になります)",
                        )
                      ) {
                        delInstruction.mutate(d.id);
                      }
                    }}
                    title="一覧から削除 (ファイル実体は保持)"
                    className="text-xs text-ink3 hover:text-red-600 px-1 shrink-0"
                    aria-label="削除"
                  >
                    🗑️
                  </button>
                </div>
                <div className="text-xs text-ink3 font-mono truncate pl-6">
                  {d.file_path}
                </div>
                {isSelected && (
                  <div className="mt-2 pl-6 space-y-1 text-xs">
                    {d.note && (
                      <div className="text-ink2 whitespace-pre-wrap">{d.note}</div>
                    )}
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-block text-accent hover:underline"
                    >
                      指示書PDFを開く →
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {selected && (
        <div className="sr-only">selected: {selected.file_path}</div>
      )}
    </div>
  );
}
