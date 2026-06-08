import { useState } from "react";
import {
  usePdfReplacements,
  useRecheckAxisLinks,
  useDeletePdfReplacement,
} from "../../api/attachments";
import { LinkModal } from "../LinkModal";
import { FilePreviewModal, openFile } from "../FilePreviewModal";
import {
  LinkBrokenBadge,
  RecheckButton,
  RecheckToast,
  linkBrokenRowClass,
  type RecheckToastData,
} from "../LinkBrokenBadge";

// Phase B: 差替図面 View (VIEW-FIRST)
// 要件§6.1 (2) — 時系列で履歴を表示し、(a)履歴 (b)パスリンク (c)クリックでファイルが開く を満たす。

interface Props {
  jobId: string;
  axisId: number;
  currentVersionId: number | null;
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

export function ReplacementsView({ jobId, axisId, currentVersionId }: Props) {
  const { data, isLoading } = usePdfReplacements(jobId, axisId);
  const recheck = useRecheckAxisLinks(jobId);
  const delRep = useDeletePdfReplacement(jobId, axisId);
  // LinkModal の表示制御。kind を保持して、差替登録 / 済受領取込の両方を 1 つのモーダルでさばく。
  const [linkModal, setLinkModal] = useState<"replacement" | "scan-receipt" | null>(null);
  // Phase D Major-4: recheck 結果を 3 秒だけヘッダに toast 表示する。
  const [toast, setToast] = useState<RecheckToastData | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(
    null,
  );

  const brokenCount = data?.filter((r) => r.is_link_broken).length ?? 0;

  return (
    <div className="flex flex-col h-full text-sm">
      <header className="relative flex items-center gap-2 px-4 py-2 border-b border-hair shrink-0">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink">
          差替図面
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
        <span className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLinkModal("replacement")}
            disabled={currentVersionId === null}
            title={
              currentVersionId === null
                ? "差替対象のバージョンが存在しません (先に出図してください)"
                : "差替図面を登録"
            }
            className="text-xs px-2 py-1 rounded-md bg-accent text-white hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + 差替
          </button>
          <button
            type="button"
            onClick={() => setLinkModal("scan-receipt")}
            title="「済」スキャン PDF を取り込み"
            className="text-xs px-2 py-1 rounded-md border border-accent text-accent hover:bg-cyan-50"
          >
            + 済受領
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
          <p className="p-4 text-ink3">差替図面はまだ登録されていません。</p>
        )}
        <ul className="divide-y divide-hair">
          {data?.map((r) => {
            const fileUrl = `/api/v1/files/uploads?path=${encodeURIComponent(r.replaced_pdf_path)}`;
            return (
              <li
                key={r.id}
                className={`px-4 py-2${linkBrokenRowClass(r.is_link_broken)}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span aria-hidden>🔄</span>
                  <span className="text-xs text-ink3">
                    {formatDate(r.created_at)}
                  </span>
                  {r.created_by && (
                    <span className="text-xs text-ink2">| {r.created_by}</span>
                  )}
                  <span className="text-xs text-ink3">
                    | 元 v{r.version_id /* 表示上は version_id (バージョン参照) */}
                  </span>
                  {r.is_link_broken && (
                    <LinkBrokenBadge filePath={r.replaced_pdf_path} />
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        window.confirm(
                          "この差替図面を一覧から削除しますか？\n(ファイル実体は残ります、表示のみ非表示になります)",
                        )
                      ) {
                        delRep.mutate(r.id);
                      }
                    }}
                    title="一覧から削除 (ファイル実体は保持)"
                    className="ml-auto text-xs text-ink3 hover:text-red-600 px-1 shrink-0"
                    aria-label="削除"
                  >
                    🗑️
                  </button>
                </div>
                <div className="pl-6 mt-1">
                  <button
                    type="button"
                    onClick={() =>
                      openFile(
                        fileUrl,
                        fileNameOf(r.replaced_pdf_path),
                        setPreview,
                      )
                    }
                    title="クリックで拡大表示"
                    className="text-xs font-mono text-accent hover:underline break-all text-left"
                  >
                    {fileNameOf(r.replaced_pdf_path)}
                  </button>
                  <div className="text-[10px] text-ink3 font-mono break-all">
                    {r.replaced_pdf_path}
                  </div>
                  {r.note && (
                    <div className="text-xs text-ink2 mt-1 whitespace-pre-wrap">
                      {r.note}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {preview && (
        <FilePreviewModal
          url={preview.url}
          name={preview.name}
          onClose={() => setPreview(null)}
        />
      )}

      {linkModal && (
        <LinkModal
          open
          onClose={() => setLinkModal(null)}
          kind={linkModal}
          jobId={jobId}
          axisId={axisId}
          currentVersionId={currentVersionId}
          onSaved={() => setLinkModal(null)}
        />
      )}
    </div>
  );
}
