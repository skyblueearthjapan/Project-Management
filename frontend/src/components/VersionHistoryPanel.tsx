// Phase I → Phase J: 履歴パネルは「閲覧 + DL + アーカイブ済の復元」に簡素化。
//
// 仕様 (Phase J):
//   - kind="pdf"  : versions API (一覧 + DL + unarchive のみ)
//   - kind="dxf"  : dxf-files API (一覧 + DL + unarchive のみ)
//   - 一覧はアクティブ (archived_at IS NULL) を先頭、アーカイブ済みを下部にグレーアウト表示
//   - アクティブ行: DL のみ
//   - アーカイブ行: DL + ✓ 復元
//   - 「除外/現行に戻す/新バージョン追加」は EditDocumentModal に移動
//
// CLAUDE.md §2.1 整合: archive は EditDocumentModal 側で実施 (このパネルでは触らない)。
import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import {
  useUnarchiveVersion,
  useVersions,
  type VersionRead,
} from "../api/jobs";
import {
  useDxfFiles,
  useUnarchiveDxfFile,
  type DxfFile,
} from "../api/dxf";
import { LinkBrokenBadge } from "./LinkBrokenBadge";

type Kind = "pdf" | "dxf";

interface Props {
  open: boolean;
  onClose: () => void;
  jobId: string;
  axisId: number;
  /** 現行とみなしている版/ファイルの id (= active で最大採番のもの)。 */
  currentVersionId: number | null;
  kind: Kind;
}

interface Row {
  id: number;
  primary: string;
  secondary: string;
  archived: boolean;
  isCurrent: boolean;
  isLinkBroken: boolean;
  filePath: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function pdfRow(v: VersionRead, currentId: number | null): Row {
  const name = v.pdf_path.split("/").pop() ?? v.pdf_path;
  const parts: string[] = [`v${v.version_no}`];
  if (v.label) parts.push(v.label);
  parts.push(`登録 ${fmtDate(v.created_at)}`);
  if (v.pdf_size != null) parts.push(`${(v.pdf_size / 1024).toFixed(0)} KB`);
  return {
    id: v.id,
    primary: name,
    secondary: parts.join(" · "),
    archived: v.archived_at !== null,
    isCurrent: v.id === currentId,
    isLinkBroken: v.is_link_broken,
    filePath: v.pdf_path,
  };
}

function dxfRow(d: DxfFile, currentId: number | null): Row {
  const name = d.file_path.split("/").pop() ?? d.file_path;
  const parts: string[] = [];
  if (d.label) parts.push(d.label);
  parts.push(`登録 ${fmtDate(d.created_at)}`);
  if (d.size != null) parts.push(`${(d.size / 1024).toFixed(0)} KB`);
  return {
    id: d.id,
    primary: name,
    secondary: parts.join(" · "),
    archived: d.archived_at !== null,
    isCurrent: d.id === currentId,
    isLinkBroken: d.is_link_broken,
    filePath: d.file_path,
  };
}

export function VersionHistoryPanel({
  open,
  onClose,
  jobId,
  axisId,
  currentVersionId,
  kind,
}: Props) {
  // 履歴パネルは常に include_archived=true で取得する (= 全件)
  const versionsQuery = useVersions(jobId, kind === "pdf" ? axisId : undefined, true);
  const dxfQuery = useDxfFiles(jobId, kind === "dxf" ? axisId : undefined, true);

  const unarchiveVersion = useUnarchiveVersion(jobId, axisId);
  const unarchiveDxf = useUnarchiveDxfFile(jobId, axisId);

  const [err, setErr] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<number | null>(null);

  const rows: Row[] = useMemo(() => {
    if (kind === "pdf") {
      return (versionsQuery.data ?? []).map((v) => pdfRow(v, currentVersionId));
    }
    return (dxfQuery.data ?? []).map((d) => dxfRow(d, currentVersionId));
  }, [kind, versionsQuery.data, dxfQuery.data, currentVersionId]);

  const isLoading = kind === "pdf" ? versionsQuery.isLoading : dxfQuery.isLoading;
  const queryError = kind === "pdf" ? versionsQuery.error : dxfQuery.error;

  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);

  const downloadUrl = (row: Row): string => {
    if (kind === "pdf") return `/api/v1/files/version/${row.id}`;
    return `/api/v1/files/dxf/${row.id}`;
  };

  async function onUnarchive(row: Row) {
    setErr(null);
    setBusyRowId(row.id);
    try {
      if (kind === "pdf") {
        await unarchiveVersion.mutateAsync(row.id);
      } else {
        await unarchiveDxf.mutateAsync(row.id);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyRowId(null);
    }
  }

  const title = kind === "pdf" ? "PDF バージョン履歴 (閲覧)" : "DXF 履歴 (閲覧)";

  return (
    <Modal open={open} onClose={onClose} title={title} width="640px">
      <div className="space-y-3 text-sm">
        <p className="text-[11px] text-ink3">
          このパネルは閲覧専用です。削除・入替・現行に戻す操作は「⚙ 編集」ボタンから行ってください。
        </p>

        {isLoading && <p className="text-ink3 text-xs">読み込み中…</p>}
        {queryError && (
          <p className="text-red-600 text-xs">
            一覧の取得に失敗しました ({(queryError as Error).message})
          </p>
        )}

        {/* アクティブ行 */}
        {active.length === 0 && !isLoading && (
          <p className="text-ink3 text-xs">アクティブなファイルがありません。</p>
        )}
        {active.length > 0 && (
          <section className="space-y-1">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink3">
              アクティブ
            </h4>
            <ul className="space-y-1">
              {active.map((row) => (
                <li
                  key={row.id}
                  className="border border-hair rounded-md px-2 py-1.5 bg-white"
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] rounded-pill ${
                        row.isCurrent
                          ? "bg-cyan-50 text-accent border border-accent"
                          : "bg-slate-100 text-ink3 border border-hair"
                      }`}
                    >
                      {row.isCurrent ? "現行" : "過去版"}
                    </span>
                    <span
                      className="font-mono text-xs truncate flex-1"
                      title={row.filePath}
                    >
                      {row.primary}
                    </span>
                    {row.isLinkBroken && (
                      <LinkBrokenBadge filePath={row.filePath} />
                    )}
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5 pl-1 text-[10px] text-ink4">
                    {row.secondary}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <a
                      href={downloadUrl(row)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-1 border border-hair rounded-md text-ink2 hover:border-accent hover:text-accent"
                    >
                      📥 DL
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* アーカイブ行 */}
        {archived.length > 0 && (
          <section className="space-y-1">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink3 mt-3">
              アーカイブ済 ({archived.length})
            </h4>
            <ul className="space-y-1 opacity-70">
              {archived.map((row) => (
                <li
                  key={row.id}
                  className="border border-dashed border-hair rounded-md px-2 py-1.5 bg-slate-50"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="px-1.5 py-0.5 text-[10px] rounded-pill bg-slate-200 text-ink3 border border-hair">
                      アーカイブ
                    </span>
                    <span
                      className="font-mono text-xs truncate flex-1 line-through"
                      title={row.filePath}
                    >
                      {row.primary}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5 pl-1 text-[10px] text-ink4">
                    {row.secondary}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <a
                      href={downloadUrl(row)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] px-2 py-1 border border-hair rounded-md text-ink2 hover:border-accent hover:text-accent"
                    >
                      📥 DL
                    </a>
                    <button
                      type="button"
                      disabled={busyRowId === row.id}
                      onClick={() => onUnarchive(row)}
                      className="text-[11px] px-2 py-1 border border-accent rounded-md text-accent hover:bg-cyan-50 disabled:opacity-50"
                      title="アーカイブから復帰させる"
                    >
                      ✓ 復元
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {err && <p className="text-red-600 text-xs">{err}</p>}

        <div className="flex justify-end pt-2 border-t border-hair">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-hair text-ink2"
          >
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
