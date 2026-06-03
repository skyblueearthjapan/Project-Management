import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "./Modal";
import { useCreateJob, useCreateAxis } from "../api/jobs";
import { api } from "../api/client";
import { JobMasterAutocomplete } from "./JobMasterAutocomplete";
import type { JobMasterItem } from "../api/jobMaster";
import {
  uploadDxfFile,
  uploadDxfFolder,
  type DxfFolderAddResult,
} from "../api/dxf";
import { PathInput } from "./PathInput";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = "job" | "axis";
type PdfMode = "skip" | "upload" | "path";
// Phase K: DXF は 4 モード (なし / ファイルアップロード / フォルダアップロード / サーバパス)
type DxfMode = "skip" | "upload-file" | "upload-folder" | "server-path";

const AXIS_PRESETS = ["昇降軸", "旋回軸", "走行軸", "搬送軸", "傾斜軸"];

async function uploadVersion(
  jobId: string,
  axisId: number,
  file: File,
  label: string,
): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
  if (label) fd.append("label", label);
  const res = await fetch(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/versions/upload`,
    { method: "POST", body: fd },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}

export function NewJobModal({ open, onClose }: Props) {
  const navigate = useNavigate();
  const createJob = useCreateJob();
  const createAxis = useCreateAxis();

  const [step, setStep] = useState<Step>("job");

  // Step 1: 工番情報
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [customer, setCustomer] = useState("");
  const [delivery, setDelivery] = useState("");
  const [note, setNote] = useState("");

  // Step 2: 任意の軸 + PDF + DXF
  const [axisName, setAxisName] = useState("");
  const [thirdParty, setThirdParty] = useState(false);
  const [pdfMode, setPdfMode] = useState<PdfMode>("skip");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPath, setPdfPath] = useState("");
  const [pdfLabel, setPdfLabel] = useState("");

  // Phase K: Step 2 の DXF は 4 モード
  const [dxfMode, setDxfMode] = useState<DxfMode>("skip");
  const [dxfFolderPath, setDxfFolderPath] = useState("");
  const [dxfLabel, setDxfLabel] = useState("");
  const [dxfSingleFile, setDxfSingleFile] = useState<File | null>(null);
  const [dxfFolderFiles, setDxfFolderFiles] = useState<File[]>([]);
  const dxfSingleInputRef = useRef<HTMLInputElement>(null);
  const dxfFolderInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setStep("job");
    setId(""); setTitle(""); setCustomer(""); setDelivery(""); setNote("");
    setAxisName(""); setThirdParty(false);
    setPdfMode("skip"); setPdfFile(null); setPdfPath(""); setPdfLabel("");
    setDxfMode("skip"); setDxfFolderPath(""); setDxfLabel("");
    setDxfSingleFile(null); setDxfFolderFiles([]);
    if (dxfSingleInputRef.current) dxfSingleInputRef.current.value = "";
    if (dxfFolderInputRef.current) dxfFolderInputRef.current.value = "";
    setErr(null); setBusy(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const jobId = id.trim();
      await createJob.mutateAsync({
        id: jobId,
        title: title.trim(),
        customer: customer.trim() || null,
        delivery_date: delivery || null,
        note: note.trim() || null,
      });

      if (axisName.trim()) {
        const axis = await createAxis.mutateAsync({
          jobId,
          body: {
            name: axisName.trim(),
            sort_order: 1,
            third_party_required: thirdParty,
          },
        });

        // PDF
        if (pdfMode === "upload" && pdfFile) {
          await uploadVersion(jobId, axis.id, pdfFile, pdfLabel);
        } else if (pdfMode === "path" && pdfPath.trim()) {
          await api(`/v1/jobs/${jobId}/axes/${axis.id}/versions`, {
            method: "POST",
            json: {
              pdf_path: pdfPath.trim(),
              label: pdfLabel || null,
              released_at: new Date().toISOString(),
            },
          });
        }

        // Phase K: DXF は 4 モード
        if (dxfMode === "upload-file" && dxfSingleFile) {
          if (!dxfSingleFile.name.toLowerCase().endsWith(".dxf")) {
            throw new Error("拡張子 .dxf のファイルを選択してください");
          }
          await uploadDxfFile(
            jobId,
            axis.id,
            dxfSingleFile,
            dxfLabel || undefined,
          );
        } else if (dxfMode === "upload-folder" && dxfFolderFiles.length > 0) {
          await uploadDxfFolder(
            jobId,
            axis.id,
            dxfFolderFiles,
            dxfLabel || undefined,
          );
        } else if (dxfMode === "server-path" && dxfFolderPath.trim()) {
          await api<DxfFolderAddResult>(
            `/v1/jobs/${jobId}/axes/${axis.id}/dxf-folder`,
            {
              method: "POST",
              json: {
                folder_path: dxfFolderPath.trim(),
                label: dxfLabel || null,
              },
            },
          );
        }
      }

      close();
      navigate(`/jobs/${encodeURIComponent(jobId)}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canGoNext = id.trim() !== "" && title.trim() !== "";

  return (
    <Modal open={open} onClose={close} title="新規工番を追加" width="600px">
      <div className="flex items-center gap-2 text-xs text-ink3 mb-4">
        <span className={step === "job" ? "text-accent font-medium" : ""}>
          1. 工番情報
        </span>
        <span>›</span>
        <span className={step === "axis" ? "text-accent font-medium" : ""}>
          2. 軸 + PDF・DXF (任意)
        </span>
      </div>

      {step === "job" && (
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-ink2">工番 (日程表から検索)</span>
            <div className="mt-1">
              <JobMasterAutocomplete
                value={id}
                onChange={setId}
                onPick={(it: JobMasterItem) => {
                  setId(it.job_no);
                  if (it.title) setTitle(it.title);
                  if (it.customer) setCustomer(it.customer);
                  if (it.delivery_date) setDelivery(it.delivery_date);
                }}
                autoFocus
              />
            </div>
            <p className="text-[11px] text-ink4 mt-1">
              ↑↓ で候補移動 · Enter で確定。候補に無い工番は手入力も可。
            </p>
          </label>
          <label className="block">
            <span className="text-ink2">件名 (必須)</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="昇降装置一式"
              className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 focus:outline-none focus:border-accent"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-ink2">客先</span>
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="(株)サンプル"
                className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 focus:outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-ink2">納期</span>
              <input
                type="date"
                value={delivery}
                onChange={(e) => setDelivery(e.target.value)}
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
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={close} className="px-3 py-1.5 border border-hair rounded-md">
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => setStep("axis")}
              disabled={!canGoNext}
              className="px-3 py-1.5 rounded-md border border-accent text-accent disabled:opacity-50"
            >
              次へ (軸とPDF・DXF) →
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canGoNext || busy}
              className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
            >
              {busy ? "作成中…" : "工番のみ作成"}
            </button>
          </div>
          {err && <p className="text-red-600 text-xs">{err}</p>}
        </div>
      )}

      {step === "axis" && (
        <div className="space-y-3 text-sm max-h-[70vh] overflow-y-auto pr-1">
          <p className="text-xs text-ink3">
            最初の軸と PDF・DXF をここで一緒に登録できます (空欄でも作成可)。後から追加もできます。
          </p>

          <label className="block">
            <span className="text-ink2">軸名</span>
            <input
              value={axisName}
              onChange={(e) => setAxisName(e.target.value)}
              placeholder="昇降軸"
              className="mt-1 w-full border border-hair rounded-md px-3 py-1.5 focus:outline-none focus:border-accent"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {AXIS_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAxisName(p)}
                  className="px-2 py-0.5 text-[11px] rounded-pill border border-hair text-ink3 hover:border-accent hover:text-accent"
                >
                  {p}
                </button>
              ))}
            </div>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={thirdParty}
              onChange={(e) => setThirdParty(e.target.checked)}
              disabled={!axisName}
            />
            <span className={axisName ? "text-ink2" : "text-ink4"}>
              第三者チェック必須
            </span>
          </label>

          {/* ── PDF ── */}
          <div className={axisName ? "" : "opacity-40 pointer-events-none"}>
            <div className="text-ink2 text-xs mb-1 border-t border-hair pt-2">── PDF ──</div>
            <div className="flex gap-1 mb-2">
              {(["skip", "upload", "path"] as PdfMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPdfMode(m)}
                  className={`px-3 py-1 rounded-md border text-xs ${
                    pdfMode === m
                      ? "bg-cyan-50 border-accent text-accent"
                      : "bg-white border-hair text-ink3"
                  }`}
                >
                  {m === "skip" ? "PDFなし" : m === "upload" ? "アップロード" : "サーバパス"}
                </button>
              ))}
            </div>

            {pdfMode === "upload" && (
              <div className="space-y-2">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs"
                />
                {pdfFile && (
                  <p className="text-xs text-ink3">
                    {pdfFile.name} ({(pdfFile.size / 1024 / 1024).toFixed(1)} MB)
                  </p>
                )}
              </div>
            )}
            {pdfMode === "path" && (
              <input
                value={pdfPath}
                onChange={(e) => setPdfPath(e.target.value)}
                placeholder="設計/NK24-101/昇降軸/rev_01.pdf"
                className="w-full border border-hair rounded-md px-3 py-1.5 font-mono text-xs focus:outline-none focus:border-accent"
              />
            )}
            {pdfMode !== "skip" && (
              <input
                value={pdfLabel}
                onChange={(e) => setPdfLabel(e.target.value)}
                placeholder="ラベル (任意: 初版 など)"
                className="mt-2 w-full border border-hair rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
              />
            )}
          </div>

          {/* ── DXF (Phase K: 4 モード) ── */}
          <div className={axisName ? "" : "opacity-40 pointer-events-none"}>
            <div className="text-ink2 text-xs mb-1 border-t border-hair pt-2">── DXF ──</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {(
                [
                  { key: "skip", label: "DXFなし" },
                  { key: "upload-folder", label: "アップロード (フォルダ)" },
                  { key: "upload-file", label: "アップロード (ファイル)" },
                  { key: "server-path", label: "サーバパス" },
                ] as { key: DxfMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setDxfMode(m.key)}
                  className={`px-3 py-1 rounded-md border text-xs ${
                    dxfMode === m.key
                      ? "bg-cyan-50 border-accent text-accent"
                      : "bg-white border-hair text-ink3"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {dxfMode === "upload-file" && (
              <div className="space-y-2">
                <input
                  ref={dxfSingleInputRef}
                  type="file"
                  accept=".dxf,.DXF"
                  onChange={(e) => setDxfSingleFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs"
                />
                {dxfSingleFile && (
                  <p className="text-xs text-ink3">
                    {dxfSingleFile.name} ({(dxfSingleFile.size / 1024 / 1024).toFixed(2)} MB)
                  </p>
                )}
              </div>
            )}

            {dxfMode === "upload-folder" && (
              <div className="space-y-2">
                <input
                  ref={dxfFolderInputRef}
                  type="file"
                  multiple
                  {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                  onChange={(e) => {
                    const list = e.target.files;
                    setDxfFolderFiles(list ? Array.from(list) : []);
                  }}
                  className="block w-full text-xs"
                />
                {dxfFolderFiles.length > 0 && (
                  <p className="text-xs text-ink3">
                    {dxfFolderFiles.length} ファイル選択中 ・ うち .dxf{" "}
                    {dxfFolderFiles.filter((f) => f.name.toLowerCase().endsWith(".dxf")).length} 件
                  </p>
                )}
                <p className="text-[11px] text-ink4">
                  フォルダ配下の <span className="font-mono">.dxf</span> を一括で{" "}
                  <span className="font-mono">/mnt/uploads/dxf/...</span> に保存します。
                </p>
              </div>
            )}

            {dxfMode === "server-path" && id && (
              <>
                <PathInput
                  value={dxfFolderPath}
                  onChange={setDxfFolderPath}
                  placeholder={`設計/${id}/${axisName || "昇降軸"}`}
                  initialBrowsePath={`Drawings/${id}/`}
                  selectMode="folder"
                  jobId={id}
                />
                <p className="text-[11px] text-ink4 mt-1">
                  ファイルサーバ上のフォルダを参照登録 (実ファイル無変更)。
                </p>
              </>
            )}
            {dxfMode === "server-path" && !id && (
              <p className="text-[11px] text-red-500">工番 ID を先に入力してください。</p>
            )}

            {dxfMode !== "skip" && (
              <input
                value={dxfLabel}
                onChange={(e) => setDxfLabel(e.target.value)}
                placeholder="ラベル (任意: 原図 など)"
                className="mt-2 w-full border border-hair rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
              />
            )}
          </div>

          {err && <p className="text-red-600 text-xs">{err}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStep("job")}
              className="px-3 py-1.5 border border-hair rounded-md"
            >
              ← 戻る
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-50"
            >
              {busy ? "作成中…" : "作成して詳細へ"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
