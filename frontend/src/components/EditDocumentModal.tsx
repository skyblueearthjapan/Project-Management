// Phase J: PDF / DXF の「編集」モーダル。
// 4 操作:
//   1. 現行をアーカイブ (アプリから除外)
//   2. 入れ替え (現行を新しいものに置換)
//   3. アーカイブ済を復元
//   4. 過去版を現行に戻す (PDF のみ; DXF はフォルダ単位で曖昧なため非対応)
//
// CLAUDE.md §2.1 整合: 削除関数は一切呼ばない。archive は archived_at を立てるだけ。
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "./Modal";
import { PathInput } from "./PathInput";
import {
  useArchiveDxfFile,
  useDxfFiles,
  useReplaceDxfFolder,
  useReplaceDxfFolderByUpload,
  useUnarchiveDxfFile,
} from "../api/dxf";
import {
  useArchiveVersion,
  useReplaceCurrentVersion,
  useRestoreVersionAsCurrent,
  useUnarchiveVersion,
  useVersions,
} from "../api/jobs";

type Kind = "pdf" | "dxf";

interface Props {
  open: boolean;
  onClose: () => void;
  kind: Kind;
  jobId: string;
  axisId: number;
  /** PDF の現行 version_id。kind="pdf" で必要。 */
  currentVersionId?: number | null;
  /** DXF の現行フォルダパス (推定)。kind="dxf" で初期値として使う。 */
  currentDxfFolderPath?: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function EditDocumentModal({
  open,
  onClose,
  kind,
  jobId,
  axisId,
  currentVersionId,
  currentDxfFolderPath,
}: Props) {
  const qc = useQueryClient();

  // ---- 共通 state -------------------------------------------------------
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ---- 入れ替えダイアログ用 state ---------------------------------------
  // PDF は従来通り "upload" | "path"。DXF は Phase K で "upload" | "path" を追加 (folder upload / server path)。
  const [replaceMode, setReplaceMode] = useState<"upload" | "path">(
    kind === "dxf" ? "upload" : "path",
  );
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replacePath, setReplacePath] = useState("");
  const [replaceLabel, setReplaceLabel] = useState("");
  const [replaceNote, setReplaceNote] = useState("");
  // DXF フォルダアップロード用
  const [replaceFolderFiles, setReplaceFolderFiles] = useState<File[]>([]);
  const replaceFolderInputRef = useRef<HTMLInputElement>(null);

  // ---- 一覧クエリ (アーカイブ/過去版表示用) -----------------------------
  const versionsQuery = useVersions(jobId, kind === "pdf" ? axisId : undefined, true);
  const dxfQuery = useDxfFiles(jobId, kind === "dxf" ? axisId : undefined, true);

  // ---- mutation hooks ---------------------------------------------------
  const archiveVersion = useArchiveVersion(jobId, axisId);
  const unarchiveVersion = useUnarchiveVersion(jobId, axisId);
  const restoreVersion = useRestoreVersionAsCurrent(jobId, axisId);
  const replaceCurrentVersion = useReplaceCurrentVersion(jobId, axisId);

  const archiveDxf = useArchiveDxfFile(jobId, axisId);
  const unarchiveDxf = useUnarchiveDxfFile(jobId, axisId);
  const replaceDxfFolder = useReplaceDxfFolder(jobId, axisId);
  const replaceDxfFolderByUpload = useReplaceDxfFolderByUpload(jobId, axisId);

  const closeAll = () => {
    setBusy(null);
    setErr(null);
    setInfo(null);
    setReplaceFile(null);
    setReplacePath("");
    setReplaceLabel("");
    setReplaceNote("");
    setReplaceFolderFiles([]);
    if (replaceFolderInputRef.current) replaceFolderInputRef.current.value = "";
    onClose();
  };

  // ---- 1. 現行をアーカイブ ------------------------------------------------
  const handleArchiveCurrent = async () => {
    if (
      !window.confirm(
        kind === "pdf"
          ? "現行 PDF をアプリから除外しますか? (ファイルは残ります)"
          : "現行 DXF を全てアプリから除外しますか? (ファイルは残ります)",
      )
    ) {
      return;
    }
    setErr(null);
    setInfo(null);
    setBusy("除外中…");
    try {
      if (kind === "pdf") {
        if (!currentVersionId) throw new Error("現行 PDF がありません");
        await archiveVersion.mutateAsync(currentVersionId);
        setInfo("現行 PDF をアーカイブしました");
      } else {
        // DXF: 当該軸の全 active を順次 archive
        const actives = (dxfQuery.data ?? []).filter((d) => d.archived_at === null);
        if (actives.length === 0) throw new Error("アクティブな DXF がありません");
        for (const d of actives) {
          await archiveDxf.mutateAsync(d.id);
        }
        setInfo(`${actives.length} 件の DXF をアーカイブしました`);
      }
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ---- 2. 入れ替え -------------------------------------------------------
  const handleReplace = async () => {
    setErr(null);
    setInfo(null);
    setBusy("入れ替え中…");
    try {
      if (kind === "pdf") {
        if (replaceMode === "upload") {
          if (!replaceFile) throw new Error("PDF ファイルを選択してください");
          if (!replaceFile.name.toLowerCase().endsWith(".pdf")) {
            throw new Error("拡張子 .pdf のファイルを選択してください");
          }
          await replaceCurrentVersion.mutateAsync({
            file: replaceFile,
            label: replaceLabel || null,
            note: replaceNote || null,
          });
        } else {
          if (!replacePath.trim()) throw new Error("PDF パスを入力してください");
          if (!replacePath.toLowerCase().endsWith(".pdf")) {
            throw new Error("拡張子 .pdf のパスを指定してください");
          }
          await replaceCurrentVersion.mutateAsync({
            pdfPath: replacePath.trim(),
            label: replaceLabel || null,
            note: replaceNote || null,
          });
        }
        setInfo("PDF を新バージョンに入れ替えました");
      } else {
        // DXF: アップロード (フォルダ) or サーバパス
        if (replaceMode === "upload") {
          if (replaceFolderFiles.length === 0) {
            throw new Error("フォルダを選択してください");
          }
          const dxfOnly = replaceFolderFiles.filter((f) =>
            f.name.toLowerCase().endsWith(".dxf"),
          );
          if (dxfOnly.length === 0) {
            throw new Error("選択フォルダ内に .dxf がありません");
          }
          const res = await replaceDxfFolderByUpload.mutateAsync({
            files: replaceFolderFiles,
            label: replaceLabel || undefined,
            note: replaceNote || undefined,
          });
          setInfo(
            `DXF を入れ替えました (archived ${res.archived} / uploaded ${res.uploaded} / registered ${res.registered} / 非DXFスキップ ${res.skipped_non_dxf})`,
          );
        } else {
          if (!replacePath.trim()) throw new Error("DXF フォルダパスを入力してください");
          const res = await replaceDxfFolder.mutateAsync(replacePath.trim());
          setInfo(
            `DXF を入れ替えました (archived ${res.archived} / registered ${res.registered} / total ${res.total_dxf})`,
          );
        }
      }
      setReplaceFile(null);
      setReplacePath("");
      setReplaceLabel("");
      setReplaceNote("");
      setReplaceFolderFiles([]);
      if (replaceFolderInputRef.current) replaceFolderInputRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // ---- 3. アーカイブ済の復元 / 4. 過去版を現行に戻す ---------------------
  const archivedRows = useMemo(() => {
    if (kind === "pdf") {
      return (versionsQuery.data ?? [])
        .filter((v) => v.archived_at !== null)
        .map((v) => ({
          id: v.id,
          primary: v.pdf_path.split("/").pop() ?? v.pdf_path,
          secondary: `v${v.version_no} · 登録 ${fmtDate(v.created_at)}`,
        }));
    }
    return (dxfQuery.data ?? [])
      .filter((d) => d.archived_at !== null)
      .map((d) => ({
        id: d.id,
        primary: d.file_path.split("/").pop() ?? d.file_path,
        secondary: `登録 ${fmtDate(d.created_at)}`,
      }));
  }, [kind, versionsQuery.data, dxfQuery.data]);

  const pastActiveRows = useMemo(() => {
    if (kind !== "pdf") return [];
    return (versionsQuery.data ?? [])
      .filter((v) => v.archived_at === null && v.id !== currentVersionId)
      .map((v) => ({
        id: v.id,
        primary: v.pdf_path.split("/").pop() ?? v.pdf_path,
        secondary: `v${v.version_no} · 登録 ${fmtDate(v.created_at)}`,
      }));
  }, [kind, versionsQuery.data, currentVersionId]);

  const handleUnarchive = async (id: number) => {
    setErr(null);
    setInfo(null);
    setBusy("復元中…");
    try {
      if (kind === "pdf") {
        await unarchiveVersion.mutateAsync(id);
      } else {
        await unarchiveDxf.mutateAsync(id);
      }
      setInfo("復元しました");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreAsCurrent = async (id: number) => {
    setErr(null);
    setInfo(null);
    setBusy("現行に戻し中…");
    try {
      await restoreVersion.mutateAsync(id);
      setInfo("過去版を現行に戻しました");
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const title = kind === "pdf" ? "PDF を編集" : "DXF を編集";

  return (
    <Modal open={open} onClose={closeAll} title={title} width="640px">
      <div className="space-y-4 text-sm">
        {info && (
          <p className="text-xs text-ink2 border border-hair rounded-md px-2 py-1 bg-cyan-50">
            {info}
          </p>
        )}
        {err && <p className="text-red-600 text-xs">{err}</p>}

        {/* ── 1. 現行をアーカイブ ── */}
        <section className="border border-hair rounded-md p-3 space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-ink2">
            1. 現行をアーカイブ (アプリから除外)
          </h4>
          <p className="text-[11px] text-ink3">
            実ファイルは無変更。アプリの一覧から外すだけです。
          </p>
          <button
            type="button"
            onClick={handleArchiveCurrent}
            disabled={busy !== null || (kind === "pdf" && !currentVersionId)}
            className="text-xs px-3 py-1.5 border border-hair text-ink3 hover:border-red-400 hover:text-red-600 rounded-md disabled:opacity-50"
          >
            🚫 現行をアーカイブ
          </button>
        </section>

        {/* ── 2. 入れ替え ── */}
        <section className="border border-hair rounded-md p-3 space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-ink2">
            2. 入れ替え (現行を新しいものに置換)
          </h4>
          <p className="text-[11px] text-ink3">
            {kind === "pdf"
              ? "現行 PDF をアーカイブし、新 PDF を新バージョンとして登録します。"
              : "現行 DXF を全てアーカイブし、新しいフォルダの .dxf を一括登録します。"}
          </p>

          {/* PDF / DXF どちらでもタブを表示 (DXF は upload=フォルダアップロード) */}
          <div className="flex gap-1">
            {(["path", "upload"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setReplaceMode(m)}
                className={`px-3 py-1 rounded-md border text-xs ${
                  replaceMode === m
                    ? "bg-cyan-50 border-accent text-accent"
                    : "bg-white border-hair text-ink3"
                }`}
              >
                {kind === "dxf"
                  ? m === "path"
                    ? "サーバパス"
                    : "アップロード (フォルダ)"
                  : m === "path"
                    ? "サーバパス"
                    : "アップロード"}
              </button>
            ))}
          </div>

          {kind === "pdf" && replaceMode === "upload" && (
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs"
            />
          )}
          {kind === "pdf" && replaceMode === "path" && (
            <PathInput
              value={replacePath}
              onChange={setReplacePath}
              placeholder="設計/.../rev_02.pdf"
              fileFilter={[".pdf"]}
              selectMode="file"
              jobId={jobId}
              initialBrowsePath={`Drawings/${jobId}/`}
            />
          )}
          {kind === "dxf" && replaceMode === "path" && (
            <>
              <PathInput
                value={replacePath}
                onChange={setReplacePath}
                placeholder={currentDxfFolderPath ?? `設計/${jobId}/`}
                selectMode="folder"
                jobId={jobId}
                initialBrowsePath={currentDxfFolderPath ?? `Drawings/${jobId}/`}
              />
              <p className="text-[11px] text-ink4">
                新フォルダ配下の <span className="font-mono">.dxf</span> を全て登録します。
              </p>
            </>
          )}
          {kind === "dxf" && replaceMode === "upload" && (
            <div className="space-y-2">
              <input
                ref={replaceFolderInputRef}
                type="file"
                multiple
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                onChange={(e) => {
                  const list = e.target.files;
                  setReplaceFolderFiles(list ? Array.from(list) : []);
                }}
                className="block w-full text-xs"
              />
              {replaceFolderFiles.length > 0 && (
                <p className="text-xs text-ink3">
                  {replaceFolderFiles.length} ファイル選択中 ・ うち .dxf{" "}
                  {
                    replaceFolderFiles.filter((f) =>
                      f.name.toLowerCase().endsWith(".dxf"),
                    ).length
                  }{" "}
                  件
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={replaceLabel}
                  onChange={(e) => setReplaceLabel(e.target.value)}
                  placeholder="ラベル (任意)"
                  className="border border-hair rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
                />
                <input
                  value={replaceNote}
                  onChange={(e) => setReplaceNote(e.target.value)}
                  placeholder="メモ (任意)"
                  className="border border-hair rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
                />
              </div>
              <p className="text-[11px] text-ink4">
                現行 DXF を全てアーカイブし、選んだフォルダの{" "}
                <span className="font-mono">.dxf</span> を{" "}
                <span className="font-mono">/mnt/uploads/dxf/...</span> に保存して登録します。
              </p>
            </div>
          )}

          {kind === "pdf" && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={replaceLabel}
                onChange={(e) => setReplaceLabel(e.target.value)}
                placeholder="ラベル (任意)"
                className="border border-hair rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
              />
              <input
                value={replaceNote}
                onChange={(e) => setReplaceNote(e.target.value)}
                placeholder="メモ (任意)"
                className="border border-hair rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
              />
            </div>
          )}

          <button
            type="button"
            onClick={handleReplace}
            disabled={
              busy !== null ||
              (kind === "pdf" && replaceMode === "upload" && !replaceFile) ||
              (kind === "pdf" && replaceMode === "path" && !replacePath.trim()) ||
              (kind === "dxf" && replaceMode === "path" && !replacePath.trim()) ||
              (kind === "dxf" &&
                replaceMode === "upload" &&
                replaceFolderFiles.length === 0)
            }
            className="text-xs px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
          >
            🔄 現行を入れ替える
          </button>
        </section>

        {/* ── 3. アーカイブ済の復元 ── */}
        {archivedRows.length > 0 && (
          <section className="border border-hair rounded-md p-3 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink2">
              3. アーカイブ済の復元 ({archivedRows.length})
            </h4>
            <ul className="space-y-1 max-h-48 overflow-auto">
              {archivedRows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 px-2 py-1 border border-dashed border-hair rounded-md bg-slate-50 text-xs"
                >
                  <span className="flex-1 truncate font-mono" title={r.primary}>
                    {r.primary}
                  </span>
                  <span className="text-[10px] text-ink4">{r.secondary}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => handleUnarchive(r.id)}
                    className="text-[11px] px-2 py-0.5 border border-accent rounded-md text-accent hover:bg-cyan-50 disabled:opacity-50"
                  >
                    ✓ 復元
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── 4. 過去版を現行に戻す (PDF のみ) ── */}
        {kind === "pdf" && pastActiveRows.length > 0 && (
          <section className="border border-hair rounded-md p-3 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink2">
              4. 過去版を現行に戻す ({pastActiveRows.length})
            </h4>
            <p className="text-[11px] text-ink3">
              選んだ過去版を新しい version_no で複製作成します (元の行は無変更)。
            </p>
            <ul className="space-y-1 max-h-48 overflow-auto">
              {pastActiveRows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 px-2 py-1 border border-hair rounded-md bg-white text-xs"
                >
                  <span className="flex-1 truncate font-mono" title={r.primary}>
                    {r.primary}
                  </span>
                  <span className="text-[10px] text-ink4">{r.secondary}</span>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => handleRestoreAsCurrent(r.id)}
                    className="text-[11px] px-2 py-0.5 border border-accent rounded-md text-accent hover:bg-cyan-50 disabled:opacity-50"
                  >
                    ⤴ 現行に戻す
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {busy && <p className="text-ink3 text-xs">{busy}</p>}

        <div className="flex justify-end pt-2 border-t border-hair">
          <button
            type="button"
            onClick={closeAll}
            className="text-xs px-3 py-1.5 rounded-md border border-hair text-ink2"
          >
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
