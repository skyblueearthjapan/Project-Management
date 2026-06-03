import { useState } from "react";
import {
  LinkBrokenBadge,
  RecheckButton,
  RecheckToast,
  linkBrokenRowClass,
  type RecheckToastData,
} from "../LinkBrokenBadge";
import {
  useRelatedDocs,
  useRecheckAxisLinks,
  useDeleteRelatedDoc,
  type RelatedDoc,
} from "../../api/attachments";
import { LinkModal } from "../LinkModal";

// Phase B: 関連資料 View (VIEW-FIRST: コンテンツ一覧が主役、追加は LinkModal で行う)
// 要件§6.1 (1) — 軸に紐づく関連資料を一覧表示し、行クリックでパス情報を表示する。
// Stock Management 移植: 旧アコーディオン AddForm は廃止、ヘッダの「+ 追加」で
// LinkModal (4 モードのうち A/P/U) を開く。

interface Props {
  jobId: string;
  axisId: number;
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

export function RelatedDocsView({ jobId, axisId }: Props) {
  const { data, isLoading } = useRelatedDocs(jobId, axisId);
  const recheck = useRecheckAxisLinks(jobId);
  const delDoc = useDeleteRelatedDoc(jobId, axisId);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  // Phase D Major-4: recheck 結果を 3 秒だけヘッダに toast 表示する。
  const [toast, setToast] = useState<RecheckToastData | null>(null);

  const selected: RelatedDoc | undefined = data?.find((d) => d.id === selectedId);
  const brokenCount = data?.filter((d) => d.is_link_broken).length ?? 0;

  return (
    <div className="flex flex-col h-full text-sm">
      <header className="relative flex items-center gap-2 px-4 py-2 border-b border-hair shrink-0">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
          関連資料
        </h3>
        <span className="text-xs text-ink3">{data?.length ?? 0} 件</span>
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
        {data && data.length === 0 && (
          <p className="p-4 text-ink3">関連資料はまだありません。</p>
        )}
        <ul className="divide-y divide-hair">
          {data?.map((d) => {
            const isSelected = d.id === selectedId;
            // H-3: job_id 必須化されたためクエリに添付。
            const fileUrl = `/api/v1/files/fileserver?job_id=${encodeURIComponent(jobId)}&path=${encodeURIComponent(d.file_path)}`;
            return (
              <li
                key={d.id}
                className={`px-4 py-2 cursor-pointer hover:bg-cyan-50 ${
                  isSelected ? "bg-cyan-50" : ""
                }${linkBrokenRowClass(d.is_link_broken)}`}
                onClick={() => setSelectedId(isSelected ? null : d.id)}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden>📄</span>
                  <span className="font-medium truncate">
                    {d.title ?? fileNameOf(d.file_path)}
                  </span>
                  {d.is_link_broken && (
                    <LinkBrokenBadge filePath={d.file_path} />
                  )}
                  <span className="ml-auto text-xs text-ink3 shrink-0">
                    {formatDate(d.created_at)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          "この関連資料を一覧から削除しますか？\n(ファイル実体は残ります、表示のみ非表示になります)",
                        )
                      ) {
                        delDoc.mutate(d.id);
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
                      ファイルサーバで開く →
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* 選択行のプレビュー領域 (Phase F で Marin-PDF 統合予定) は親で同領域を使うため、
          ここでは note とパスを大きく出すだけに留める。 */}
      {selected && (
        <div className="sr-only">selected: {selected.file_path}</div>
      )}

      <LinkModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        kind="related"
        jobId={jobId}
        axisId={axisId}
      />
    </div>
  );
}
