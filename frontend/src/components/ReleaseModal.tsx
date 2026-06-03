import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { Modal } from "./Modal";
import { PathInput } from "./PathInput";

interface Props {
  open: boolean;
  onClose: () => void;
  jobId: string;
  axisId: number;
}

type Mode = "upload" | "path";

interface UploadResult {
  pdf_path?: string;
}

async function uploadVersion(
  jobId: string,
  axisId: number,
  file: File,
  label: string,
  note: string,
  releasedBy: string
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  if (label) fd.append("label", label);
  if (note) fd.append("note", note);
  if (releasedBy) fd.append("released_by", releasedBy);
  const res = await fetch(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/versions/upload`,
    { method: "POST", body: fd }
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as UploadResult;
}

export function ReleaseModal({ open, onClose, jobId, axisId }: Props) {
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [pdfPath, setPdfPath] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [releasedBy, setReleasedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();

  function reset() {
    setFile(null); setPdfPath(""); setLabel(""); setNote(""); setReleasedBy("");
    setErr(null);
  }

  const pathCreate = useMutation({
    mutationFn: () =>
      api(`/v1/jobs/${jobId}/axes/${axisId}/versions`, {
        method: "POST",
        json: {
          pdf_path: pdfPath,
          label: label || null,
          note: note || null,
          released_by: releasedBy || null,
        },
      }),
  });

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      if (mode === "upload") {
        if (!file) throw new Error("PDFファイルを選択してください");
        await uploadVersion(jobId, axisId, file, label, note, releasedBy);
      } else {
        if (!pdfPath) throw new Error("PDFパスを入力してください");
        await pathCreate.mutateAsync();
      }
      await qc.invalidateQueries({ queryKey: ["job", jobId] });
      await qc.invalidateQueries({ queryKey: ["jobs"] });
      // 登録完了 → モーダルを閉じる (旧 T1 出図メール起動は廃止)。
      reset();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="出図 (新バージョン登録)"
      width="560px"
    >
      <div className="space-y-3 text-sm">
        <div className="flex gap-1 border-b border-hair">
          {(["upload", "path"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs border-b-2 -mb-px transition ${
                mode === m
                  ? "border-accent text-accent font-medium"
                  : "border-transparent text-ink3 hover:text-ink"
              }`}
            >
              {m === "upload" ? "アップロード" : "ファイルサーバパス"}
            </button>
          ))}
        </div>

        {mode === "upload" ? (
          <label className="block">
            <span className="text-ink2">PDF ファイル</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-xs"
            />
            {file && (
              <p className="text-xs text-ink3 mt-1">
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
          </label>
        ) : (
          <div className="block">
            <span className="text-ink2">PDF パス (/mnt/fileserver からの相対)</span>
            <div className="mt-1">
              <PathInput
                value={pdfPath}
                onChange={setPdfPath}
                placeholder="設計/NK24-101/昇降軸/rev_01.pdf"
                initialBrowsePath={`Drawings/${jobId}/`}
                fileFilter={[".pdf"]}
                autoFocus
                jobId={jobId}
              />
            </div>
            <p className="text-[11px] text-ink4 mt-1">
              既にファイルサーバ上に置いてある PDF を指す場合に使用。
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-ink2">ラベル (任意)</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="再出図 1"
              className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 focus:outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-ink2">出図者</span>
            <input
              value={releasedBy}
              onChange={(e) => setReleasedBy(e.target.value)}
              placeholder="山田"
              className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 focus:outline-none focus:border-accent"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-ink2">メモ</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 focus:outline-none focus:border-accent"
          />
        </label>

        {err && <p className="text-red-600 text-xs">{err}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="px-3 py-1.5 border border-hair rounded-md"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (mode === "upload" ? !file : !pdfPath)}
            className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
          >
            {busy ? "登録中…" : "登録"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
