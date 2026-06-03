import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "./Modal";
import { FolderBrowserModal } from "./FolderBrowserModal";
import {
  useAddRelatedDoc,
  useAddPartsListVersion,
  useAddPdfReplacementByPath,
  uploadRelatedDoc,
  uploadPartsListVersion,
  uploadPdfReplacement,
  uploadScanReceipt,
  registerScanReceiptByPath,
} from "../api/attachments";

// Stock Management 側 LinkModal を移植したモーダル。
// 3 モード (A: サーバから選ぶ / P: パスを貼り付け / U: PCからアップロード) を
// kind (related | parts | replacement | scan-receipt) ごとに同じ UI で共有する。
// 4 種類すべて同じレイアウト (A/P/U 3 タブ + ラベル + メモ) に統一。

type LinkKind = "related" | "parts" | "replacement" | "scan-receipt";
type Mode = "A" | "P" | "U";

interface LinkModalProps {
  open: boolean;
  onClose: () => void;
  kind: LinkKind;
  jobId: string;
  // scan-receipt では不要 (工番単位の取込)。それ以外は必須。
  axisId?: number;
  axisName?: string | undefined;
  // replacement では必須 (差替対象バージョン)。
  currentVersionId?: number | null;
  onSaved?: (savedPath: string) => void;
}

const KIND_TITLES: Record<LinkKind, { title: string; placeholder: string; addLabel: string }> = {
  related: {
    title: "関連資料を追加",
    placeholder: "ファイルサーバ相対パス (例: Drawings/{job}/設計/仕様書.pdf)",
    addLabel: "関連資料を登録",
  },
  parts: {
    title: "部品リスト 新バージョンを追加",
    placeholder: "部品リストファイルのパス",
    addLabel: "新バージョンを登録",
  },
  replacement: {
    title: "差替図面を登録",
    placeholder: "差替後 PDF のパス",
    addLabel: "差替を登録",
  },
  "scan-receipt": {
    title: "済受領を取込",
    placeholder: "「済」スキャン PDF のパス",
    addLabel: "受領を取込",
  },
};

export function LinkModal({
  open,
  onClose,
  kind,
  jobId,
  axisId,
  currentVersionId,
  onSaved,
}: LinkModalProps) {
  const qc = useQueryClient();
  // 4 種類すべて A モード既定で統一。
  const [mode, setMode] = useState<Mode>("A");
  const [pastePath, setPastePath] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [note, setNote] = useState<string>("");
  // A モード用: 選択したサーバ相対パス
  const [serverPickedPath, setServerPickedPath] = useState<string>("");
  // A モードで FolderBrowserModal を表示するか
  const [browserOpen, setBrowserOpen] = useState(false);
  // U モード用
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "uploaded" | "failed">(
    "idle",
  );
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const addRelated = useAddRelatedDoc();
  const addParts = useAddPartsListVersion();
  const addReplacementByPath = useAddPdfReplacementByPath();

  // モーダル開閉でローカル状態をリセット
  useEffect(() => {
    if (!open) return;
    setMode("A");
    setPastePath("");
    setTitle("");
    setNote("");
    setServerPickedPath("");
    setBrowserOpen(false);
    setUploadFile(null);
    setUploadState("idle");
    setUploadMsg(null);
    setUploadedPath(null);
    setDragging(false);
    setSubmitting(false);
    setSubmitErr(null);
  }, [open, kind]);

  // U モード: アップロード実行 (この時点でサーバにファイルが保存され DB 行も作られる)
  const runUpload = async (file: File) => {
    setUploadState("uploading");
    setUploadFile(file);
    setUploadMsg(null);
    try {
      if (kind === "related") {
        if (axisId === undefined) throw new Error("axisId が指定されていません");
        const titleForUpload = title || file.name;
        const r = await uploadRelatedDoc(
          jobId,
          axisId,
          file,
          titleForUpload,
          note || undefined,
        );
        setUploadedPath(r.file_path);
        void qc.invalidateQueries({ queryKey: ["related-docs", jobId, axisId] });
      } else if (kind === "parts") {
        if (axisId === undefined) throw new Error("axisId が指定されていません");
        const r = await uploadPartsListVersion(
          jobId,
          axisId,
          file,
          title || undefined,
          note || undefined,
        );
        setUploadedPath(r.file_path);
        void qc.invalidateQueries({ queryKey: ["parts-list", jobId, axisId] });
      } else if (kind === "replacement") {
        if (axisId === undefined) throw new Error("axisId が指定されていません");
        if (currentVersionId == null) {
          throw new Error("差替対象のバージョンが存在しません");
        }
        const r = await uploadPdfReplacement(
          jobId,
          axisId,
          currentVersionId,
          file,
          note || undefined,
        );
        setUploadedPath(r.replaced_pdf_path);
        void qc.invalidateQueries({ queryKey: ["pdf-replacements", jobId, axisId] });
      } else if (kind === "scan-receipt") {
        const r = await uploadScanReceipt(jobId, file);
        setUploadedPath(r.path);
      }
      setUploadState("uploaded");
    } catch (err) {
      setUploadState("failed");
      setUploadMsg((err as Error).message);
    }
  };

  // A / P モード: パス登録 (JSON POST) — 4 種類すべて対応
  const submitByPath = async (filePath: string) => {
    setSubmitting(true);
    setSubmitErr(null);
    try {
      if (kind === "related") {
        if (axisId === undefined) throw new Error("axisId が指定されていません");
        await new Promise<void>((resolve, reject) => {
          addRelated.mutate(
            {
              jobId,
              axisId,
              file_path: filePath,
              title: title || null,
              note: note || null,
            },
            {
              onSuccess: () => resolve(),
              onError: (e) => reject(e),
            },
          );
        });
      } else if (kind === "parts") {
        if (axisId === undefined) throw new Error("axisId が指定されていません");
        await new Promise<void>((resolve, reject) => {
          addParts.mutate(
            {
              jobId,
              axisId,
              file_path: filePath,
              label: title || null,
              note: note || null,
            },
            {
              onSuccess: () => resolve(),
              onError: (e) => reject(e),
            },
          );
        });
      } else if (kind === "replacement") {
        if (axisId === undefined) throw new Error("axisId が指定されていません");
        if (currentVersionId == null) {
          throw new Error("差替対象のバージョンが存在しません");
        }
        await new Promise<void>((resolve, reject) => {
          addReplacementByPath.mutate(
            {
              jobId,
              axisId,
              version_id: currentVersionId,
              file_path: filePath,
              note: note || null,
            },
            {
              onSuccess: () => resolve(),
              onError: (e) => reject(e),
            },
          );
        });
      } else if (kind === "scan-receipt") {
        // scan-receipt は DB 行を持たない一過性データ。サーバはパス検証のみで応答。
        await registerScanReceiptByPath(jobId, filePath, note || undefined);
      }
      onSaved?.(filePath);
      onClose();
    } catch (err) {
      setSubmitErr((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // U モードの「紐付ける」: アップロード時点で DB 行も作成済みなので、確定 = 閉じる
  const finalizeUpload = () => {
    if (uploadedPath) onSaved?.(uploadedPath);
    onClose();
  };

  const canSubmit =
    (mode === "A" && serverPickedPath.trim().length > 0) ||
    (mode === "P" && pastePath.trim().length > 3) ||
    (mode === "U" && uploadState === "uploaded");

  const handleConfirm = () => {
    if (mode === "A") void submitByPath(serverPickedPath.trim());
    else if (mode === "P") void submitByPath(pastePath.trim());
    else if (mode === "U") finalizeUpload();
  };

  const titleConfig = KIND_TITLES[kind];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={titleConfig.title}
        width="760px"
      >
        <div className="space-y-3">
          {/* モードタブ (ピル型) — 4 種類すべて同じ 3 タブで統一 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex p-1 rounded-full bg-slate-100 gap-0.5">
              {(
                [
                  ["A", "サーバから選ぶ"],
                  ["P", "パスを貼り付け"],
                  ["U", "PCからアップロード"],
                ] as [Mode, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  className={`px-3 h-7 text-xs rounded-full transition ${
                    mode === k
                      ? "bg-white text-ink shadow-sm"
                      : "text-ink3 hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* モードごとの本体 */}
          {mode === "A" && (
            <LinkAPanel
              jobId={jobId}
              picked={serverPickedPath}
              onPick={setServerPickedPath}
              onOpenBrowser={() => setBrowserOpen(true)}
            />
          )}
          {mode === "P" && (
            <LinkPPanel
              path={pastePath}
              setPath={setPastePath}
              placeholder={titleConfig.placeholder}
            />
          )}
          {mode === "U" && (
            <LinkUPanel
              state={uploadState}
              file={uploadFile}
              uploadedPath={uploadedPath}
              message={uploadMsg}
              dragging={dragging}
              setDragging={setDragging}
              onPickFile={(f) => void runUpload(f)}
              onReset={() => {
                setUploadState("idle");
                setUploadFile(null);
                setUploadedPath(null);
                setUploadMsg(null);
              }}
            />
          )}

          {/* 共通 メタデータ入力 (A / P 時のみ) */}
          {mode !== "U" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <label className="text-xs text-ink2 space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-ink3">
                  ラベル (任意)
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="任意のラベル (例: v3 改訂)"
                  className="w-full border border-hair rounded-md px-2 py-1.5 text-xs"
                />
              </label>
              <label className="text-xs text-ink2 space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-ink3">
                  メモ (任意)
                </span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="補足説明など"
                  className="w-full border border-hair rounded-md px-2 py-1.5 text-xs"
                />
              </label>
            </div>
          )}

          {/* U モード時のメタ入力 (アップロード前のみ入力可) */}
          {mode === "U" && uploadState === "idle" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <label className="text-xs text-ink2 space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-ink3">
                  ラベル (任意)
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="空ならファイル名"
                  className="w-full border border-hair rounded-md px-2 py-1.5 text-xs"
                />
              </label>
              <label className="text-xs text-ink2 space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-ink3">
                  メモ (任意)
                </span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="補足説明など"
                  className="w-full border border-hair rounded-md px-2 py-1.5 text-xs"
                />
              </label>
            </div>
          )}

          {submitErr && (
            <p className="text-xs text-red-600">{submitErr}</p>
          )}

          {/* フッタ */}
          <div className="flex items-center gap-2 pt-2 border-t border-hair -mx-4 px-4">
            <div className="text-[11px] text-ink3 mt-2">
              {mode === "U"
                ? "アップロードしたファイルはサーバ上で新規ファイルとして保存 (上書きしません)"
                : "ファイル実体はそのまま、紐付けだけを登録します"}
            </div>
            <div className="ml-auto flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md border border-hair text-xs text-ink2"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canSubmit || submitting}
                className="px-3 py-1.5 rounded-md bg-accent text-white text-xs disabled:opacity-50"
              >
                {submitting
                  ? "登録中…"
                  : mode === "U"
                    ? "閉じる (登録済)"
                    : titleConfig.addLabel}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* A モードの FolderBrowserModal は LinkModal の外側に重ねて表示する。
          Modal は背景クリックで onClose するため、stopPropagation を尊重しつつ
          Modal の上に二重スタックされる構造にしておく。 */}
      <FolderBrowserModal
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onPick={(rel) => {
          setServerPickedPath(rel);
          setBrowserOpen(false);
        }}
        initialPath={`Drawings/${jobId}/`}
        jobId={jobId}
        selectMode="file"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// A モード: サーバ上のファイルを選ぶ
// ---------------------------------------------------------------------------
function LinkAPanel({
  jobId,
  picked,
  onPick,
  onOpenBrowser,
}: {
  jobId: string;
  picked: string;
  onPick: (rel: string) => void;
  onOpenBrowser: () => void;
}) {
  return (
    <div className="rounded-xl border border-hair bg-slate-50/40 p-4 space-y-3 min-h-[280px]">
      <div className="text-xs text-ink3 leading-relaxed">
        ファイルサーバ (`/mnt/fileserver`) 配下から既存ファイルを選択します。
        ファイル実体は移動・複製されず、パスだけが登録されます。
      </div>
      <div className="flex items-center gap-2">
        <input
          value={picked}
          onChange={(e) => onPick(e.target.value)}
          placeholder={`Drawings/${jobId}/ 以下の相対パス`}
          className="flex-1 border border-hair rounded-md px-2 py-1.5 text-xs font-mono bg-white"
        />
        <button
          type="button"
          onClick={onOpenBrowser}
          className="px-3 py-1.5 text-xs border border-accent text-accent rounded-md hover:bg-cyan-50 whitespace-nowrap"
        >
          サーバを探す…
        </button>
      </div>
      {picked && (
        <div className="rounded-lg bg-white border border-hair p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink3 mb-1">選択中のファイル</div>
          <div className="font-mono text-xs text-ink break-all">{picked}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// P モード: パスを貼り付け
// ---------------------------------------------------------------------------
function LinkPPanel({
  path,
  setPath,
  placeholder,
}: {
  path: string;
  setPath: (s: string) => void;
  placeholder: string;
}) {
  const trimmed = path.trim();
  const inferredName = trimmed ? (trimmed.split(/[\\/]/).pop() ?? "") : "";
  const lower = trimmed.toLowerCase();
  const detected = !trimmed
    ? null
    : lower.startsWith("\\\\") || trimmed.startsWith("//")
      ? "UNC (\\\\server\\share\\…)"
      : /^[a-z]:[\\/]/i.test(trimmed)
        ? "Windows ローカル絶対パス"
        : trimmed.startsWith("/mnt/")
          ? "サーバー内部パス"
          : "サーバ相対パス";

  return (
    <div className="rounded-xl border border-hair bg-slate-50/40 p-4 space-y-3 min-h-[280px]">
      <label className="block text-[10px] uppercase tracking-wider text-ink3 font-medium">
        ファイルのパスを貼り付け <span className="text-red-600 normal-case">*</span>
      </label>
      <textarea
        value={path}
        onChange={(e) => setPath(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 rounded-md border border-hair text-xs font-mono bg-white focus:outline-none focus:border-accent resize-none"
      />
      <div className="text-[11px] flex items-center gap-2 flex-wrap">
        {detected ? (
          <>
            <span className="text-ink3">検出:</span>
            <span className="font-mono text-accent">{detected}</span>
            {inferredName && (
              <>
                <span className="text-ink3">·</span>
                <span className="font-mono text-ink3">{inferredName}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-ink3">エクスプローラーのアドレス欄からコピーして貼り付け</span>
        )}
      </div>
      <div className="rounded-md bg-cyan-50/60 border border-cyan-200 p-2.5 text-[11px] text-ink2 leading-relaxed">
        <div className="font-medium text-accent">ヒント</div>
        <ul className="mt-1 list-disc list-inside space-y-0.5">
          <li>サーバ相対パス (例: <span className="font-mono">Drawings/{`{工番}`}/設計/x.pdf</span>) を推奨</li>
          <li>\\lineworks-sv\Data\… 等の UNC パスは登録できますが、開く時点でリンク切れ判定される場合があります</li>
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// U モード: PC からアップロード
// ---------------------------------------------------------------------------
function LinkUPanel({
  state,
  file,
  uploadedPath,
  message,
  dragging,
  setDragging,
  onPickFile,
  onReset,
}: {
  state: "idle" | "uploading" | "uploaded" | "failed";
  file: File | null;
  uploadedPath: string | null;
  message: string | null;
  dragging: boolean;
  setDragging: (b: boolean) => void;
  onPickFile: (f: File) => void;
  onReset: () => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onPickFile(f);
      }}
      className={`rounded-xl border-2 border-dashed flex flex-col items-center justify-center min-h-[280px] p-6 text-center transition ${
        dragging
          ? "border-accent bg-cyan-50/60"
          : "border-hair bg-slate-50/40"
      }`}
    >
      {state === "idle" && (
        <>
          <div className="w-14 h-14 rounded-2xl bg-white border border-hair flex items-center justify-center text-accent mb-2 text-2xl">
            ⬆
          </div>
          <div className="text-sm font-medium text-ink">PC からファイルをアップロード</div>
          <div className="text-xs text-ink3 mt-1">
            ドラッグ＆ドロップするか、下のボタンから選択してください
          </div>
          <label className="mt-4 inline-flex items-center px-4 h-9 rounded-full bg-accent text-white text-xs cursor-pointer hover:bg-cyan-600">
            ファイルを選択
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
              }}
            />
          </label>
          <div className="mt-3 text-[11px] text-ink3 max-w-md">
            保存先: <span className="font-mono">/mnt/uploads/…</span> 配下に新規作成
            <br />
            既存ファイルへの上書きはしません (CLAUDE.md §2.1 / §2.2)
          </div>
        </>
      )}
      {state === "uploading" && (
        <div className="text-center">
          <div className="w-10 h-10 mx-auto border-4 border-cyan-100 border-t-accent rounded-full animate-spin" />
          <div className="text-sm font-medium text-ink mt-3">アップロード中…</div>
          <div className="text-xs text-ink3 mt-1 truncate max-w-xs">{file?.name}</div>
        </div>
      )}
      {state === "uploaded" && (
        <div className="max-w-md">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-cyan-50 text-accent flex items-center justify-center text-2xl">
            ✓
          </div>
          <div className="text-sm font-semibold text-ink mt-3">アップロード完了</div>
          <div className="text-xs text-ink3 mt-1">「閉じる」を押して反映してください</div>
          {uploadedPath && (
            <div className="mt-3 font-mono text-[10px] bg-white border border-hair rounded-md px-3 py-2 text-left text-ink2 break-all">
              {uploadedPath}
            </div>
          )}
          <button
            type="button"
            onClick={onReset}
            className="mt-3 text-xs px-3 py-1.5 border border-hair rounded-md text-ink3 hover:text-ink"
          >
            別のファイルを選ぶ
          </button>
        </div>
      )}
      {state === "failed" && (
        <div className="max-w-md">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-red-50 text-red-500 flex items-center justify-center text-2xl">
            !
          </div>
          <div className="text-sm font-semibold text-ink mt-3">アップロードに失敗しました</div>
          <div className="text-xs text-ink3 mt-1 break-all">{message ?? "原因不明のエラー"}</div>
          <button
            type="button"
            onClick={onReset}
            className="mt-3 text-xs px-3 py-1.5 border border-hair rounded-md text-ink3 hover:text-ink"
          >
            やり直し
          </button>
        </div>
      )}
    </div>
  );
}
