// Phase K: DXF を追加するモーダル。3 タブ構成。
//   - アップロード (ファイル): 単一 .dxf を選んで即アップロード保存
//   - アップロード (フォルダ): <input webkitdirectory> でフォルダ配下を一括アップロード保存
//   - サーバパス: 既存の PathInput でファイルサーバ上のフォルダを参照登録 (実ファイル無変更)
//
// ブラウザのセキュリティ仕様で <input type="file"> は絶対パスを返さないため、
// 「ファイル/フォルダを選ぶだけで自動登録」を成立させる唯一の現実解として
// アップロードタブを Phase K で復活させた。
import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { PathInput } from "./PathInput";
import { useAddDxfFolder, uploadDxfFile, uploadDxfFolder } from "../api/dxf";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  open: boolean;
  onClose: () => void;
  jobId: string;
  axisId: number;
  /** PathInput の初期表示フォルダに使う (任意)。 */
  defaultBrowsePath?: string;
}

type Tab = "upload-file" | "upload-folder" | "server-path";

export function AddDxfModal({
  open,
  onClose,
  jobId,
  axisId,
  defaultBrowsePath,
}: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("upload-folder");

  // 共通メタ
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");

  // ファイルアップロード
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const singleInputRef = useRef<HTMLInputElement>(null);

  // フォルダアップロード
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // サーバパス
  const [serverFolderPath, setServerFolderPath] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const addFolder = useAddDxfFolder(jobId, axisId);

  function reset() {
    setSingleFile(null);
    setFolderFiles([]);
    setServerFolderPath("");
    setLabel("");
    setNote("");
    setErr(null);
    setInfo(null);
    if (singleInputRef.current) singleInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  function closeAll() {
    reset();
    onClose();
  }

  function invalidateLists() {
    void qc.invalidateQueries({ queryKey: ["dxf-files", jobId, axisId] });
    void qc.invalidateQueries({ queryKey: ["job", jobId] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
  }

  async function submitUploadFile() {
    if (!singleFile) throw new Error("DXF ファイルを選択してください");
    if (!singleFile.name.toLowerCase().endsWith(".dxf")) {
      throw new Error("拡張子 .dxf のファイルを選択してください");
    }
    const dxf = await uploadDxfFile(
      jobId,
      axisId,
      singleFile,
      label || undefined,
      note || undefined,
    );
    invalidateLists();
    setInfo(`登録しました: ${dxf.file_path.split("/").pop()}`);
    setSingleFile(null);
    if (singleInputRef.current) singleInputRef.current.value = "";
  }

  async function submitUploadFolder() {
    if (folderFiles.length === 0) throw new Error("フォルダを選択してください");
    const dxfOnly = folderFiles.filter((f) => f.name.toLowerCase().endsWith(".dxf"));
    if (dxfOnly.length === 0) throw new Error("選択フォルダ内に .dxf がありません");
    const res = await uploadDxfFolder(
      jobId,
      axisId,
      folderFiles,
      label || undefined,
      note || undefined,
    );
    invalidateLists();
    setInfo(
      `アップロード ${res.uploaded} 件 / 登録 ${res.registered} 件 / 非DXFスキップ ${res.skipped_non_dxf} 件`,
    );
    setFolderFiles([]);
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  async function submitServerPath() {
    if (!serverFolderPath.trim()) throw new Error("フォルダパスを入力してください");
    const res = await addFolder.mutateAsync({
      folder_path: serverFolderPath.trim(),
      label: label || null,
      note: note || null,
    });
    invalidateLists();
    setInfo(
      `登録 ${res.registered} 件 / スキップ ${res.skipped} 件 (該当 .dxf ${res.total_dxf} 件)`,
    );
    setServerFolderPath("");
  }

  async function submit() {
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      if (tab === "upload-file") {
        await submitUploadFile();
      } else if (tab === "upload-folder") {
        await submitUploadFolder();
      } else {
        await submitServerPath();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const submitDisabled =
    busy ||
    (tab === "upload-file" && !singleFile) ||
    (tab === "upload-folder" && folderFiles.length === 0) ||
    (tab === "server-path" && !serverFolderPath.trim());

  return (
    <Modal open={open} onClose={closeAll} title="DXF を追加" width="600px">
      <div className="space-y-3 text-sm">
        {/* タブ */}
        <div className="flex gap-1 border-b border-hair pb-2">
          {(
            [
              { key: "upload-folder", label: "アップロード (フォルダ)" },
              { key: "upload-file", label: "アップロード (ファイル)" },
              { key: "server-path", label: "サーバパス" },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setErr(null);
                setInfo(null);
              }}
              className={`px-3 py-1 rounded-md border text-xs ${
                tab === t.key
                  ? "bg-cyan-50 border-accent text-accent"
                  : "bg-white border-hair text-ink3"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── アップロード (ファイル) ── */}
        {tab === "upload-file" && (
          <div className="space-y-2">
            <p className="text-xs text-ink3">
              選んだ .dxf を{" "}
              <span className="font-mono text-ink2">/mnt/uploads/dxf/{jobId}/{axisId}/</span>{" "}
              に保存して登録します。
            </p>
            <input
              ref={singleInputRef}
              type="file"
              accept=".dxf,.DXF"
              onChange={(e) => setSingleFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs"
            />
            {singleFile && (
              <p className="text-xs text-ink3">
                {singleFile.name} ({(singleFile.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>
        )}

        {/* ── アップロード (フォルダ) ── */}
        {tab === "upload-folder" && (
          <div className="space-y-2">
            <p className="text-xs text-ink3">
              選んだフォルダ配下の{" "}
              <span className="font-mono text-ink2">.dxf</span>{" "}
              を一括で{" "}
              <span className="font-mono text-ink2">/mnt/uploads/dxf/{jobId}/{axisId}/</span>{" "}
              に保存して登録します (サブフォルダ構造は保持)。
            </p>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // webkitdirectory / directory は React 標準型に無い属性のため、
              // 任意属性として展開する。
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => {
                const list = e.target.files;
                if (!list) {
                  setFolderFiles([]);
                  return;
                }
                setFolderFiles(Array.from(list));
              }}
              className="block w-full text-xs"
            />
            {folderFiles.length > 0 && (
              <p className="text-xs text-ink3">
                {folderFiles.length} ファイル選択中 ・ うち .dxf{" "}
                {folderFiles.filter((f) => f.name.toLowerCase().endsWith(".dxf")).length}{" "}
                件
              </p>
            )}
          </div>
        )}

        {/* ── サーバパス ── */}
        {tab === "server-path" && (
          <div className="space-y-2">
            <p className="text-xs text-ink3">
              ファイルサーバ上のフォルダを参照登録 (実ファイルは無変更)。
            </p>
            <PathInput
              value={serverFolderPath}
              onChange={setServerFolderPath}
              placeholder={`設計/${jobId}/昇降軸`}
              initialBrowsePath={defaultBrowsePath ?? `Drawings/${jobId}/`}
              selectMode="folder"
              autoFocus
              jobId={jobId}
            />
            <p className="text-[11px] text-ink4">
              既に登録済の DXF はスキップされます。
            </p>
          </div>
        )}

        {/* 共通メタ */}
        <label className="block">
          <span className="text-ink2 text-xs">ラベル (任意・登録される全 DXF に付与)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="原図 など"
            className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-ink2 text-xs">メモ (任意)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
          />
        </label>

        {info && (
          <p className="text-xs text-ink2 border border-hair rounded-md px-2 py-1 bg-cyan-50">
            {info}
          </p>
        )}
        {err && <p className="text-red-600 text-xs">{err}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={closeAll}
            className="px-3 py-1.5 border border-hair rounded-md"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitDisabled}
            className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
          >
            {busy
              ? "送信中…"
              : tab === "upload-file"
                ? "+ アップロードして登録"
                : tab === "upload-folder"
                  ? "+ フォルダごとアップロード"
                  : "+ このフォルダを参照登録"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
