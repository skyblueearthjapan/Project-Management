import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface RelatedDoc {
  id: number;
  axis_id: number;
  file_path: string;
  title: string | null;
  size: number | null;
  note: string | null;
  created_at: string;
  // Phase D: 最新 link_check_results.status === "missing" の時 true
  is_link_broken: boolean;
}

export interface PartsListVersion {
  id: number;
  parts_list_id: number;
  version_no: number;
  file_path: string;
  label: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  // Phase D: 最新 link_check_results.status === "missing" の時 true
  is_link_broken: boolean;
}

export interface PartsList {
  id: number;
  axis_id: number;
  note: string | null;
  updated_at: string;
  versions: PartsListVersion[];
}

export interface PdfReplacement {
  id: number;
  axis_id: number;
  version_id: number;
  replaced_pdf_path: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  // Phase D: 最新 link_check_results.status === "missing" の時 true
  is_link_broken: boolean;
}

export function useRelatedDocs(jobId: string, axisId: number | undefined) {
  return useQuery({
    queryKey: ["related-docs", jobId, axisId],
    queryFn: () => api<RelatedDoc[]>(`/v1/jobs/${jobId}/axes/${axisId}/related-docs`),
    enabled: Boolean(jobId && axisId),
  });
}

export function useAddRelatedDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      jobId: string;
      axisId: number;
      file_path: string;
      title?: string | null;
      note?: string | null;
    }) =>
      api(`/v1/jobs/${params.jobId}/axes/${params.axisId}/related-docs`, {
        method: "POST",
        json: {
          file_path: params.file_path,
          title: params.title ?? null,
          note: params.note ?? null,
        },
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["related-docs", v.jobId, v.axisId] });
    },
  });
}

// Phase B 新規: 差替履歴ビュー用フック。時系列 (新しい順) で取得する。
export function usePdfReplacements(jobId: string, axisId: number | undefined) {
  return useQuery({
    queryKey: ["pdf-replacements", jobId, axisId],
    queryFn: () =>
      api<PdfReplacement[]>(`/v1/jobs/${jobId}/axes/${axisId}/pdf-replacements`),
    enabled: Boolean(jobId && axisId),
  });
}

export function usePartsList(jobId: string, axisId: number | undefined) {
  return useQuery({
    queryKey: ["parts-list", jobId, axisId],
    queryFn: () => api<PartsList | null>(`/v1/jobs/${jobId}/axes/${axisId}/parts-list`),
    enabled: Boolean(jobId && axisId),
  });
}

export function useAddPartsListVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      jobId: string;
      axisId: number;
      file_path: string;
      label?: string | null;
      note?: string | null;
      created_by?: string | null;
    }) =>
      api(`/v1/jobs/${params.jobId}/axes/${params.axisId}/parts-list/versions`, {
        method: "POST",
        json: {
          file_path: params.file_path,
          label: params.label ?? null,
          note: params.note ?? null,
          created_by: params.created_by ?? null,
        },
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["parts-list", v.jobId, v.axisId] });
    },
  });
}

// Phase D: 軸限定の即時リンクチェック (フロント「再チェック」ボタン用)
export interface RecheckResult {
  checked: number;
  ok: number;
  missing: number;
}

export function useRecheckAxisLinks(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (axisId: number) =>
      api<RecheckResult>(`/v1/link-check/axis/${axisId}/recheck`, {
        method: "POST",
      }),
    onSuccess: (_d, axisId) => {
      void qc.invalidateQueries({ queryKey: ["related-docs", jobId, axisId] });
      void qc.invalidateQueries({ queryKey: ["parts-list", jobId, axisId] });
      void qc.invalidateQueries({ queryKey: ["pdf-replacements", jobId, axisId] });
      // job 自体のレスポンスにも current_version_link_broken が載るので再取得
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
      // Phase D Major-3: Home 一覧の link_broken バッジも軸 recheck で更新する
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export async function uploadPdfReplacement(
  jobId: string,
  axisId: number,
  versionId: number,
  file: File,
  note?: string,
  createdBy?: string
): Promise<PdfReplacement> {
  const fd = new FormData();
  fd.append("file", file);
  if (note) fd.append("note", note);
  if (createdBy) fd.append("created_by", createdBy);
  const res = await fetch(
    `/api/v1/jobs/${jobId}/axes/${axisId}/versions/${versionId}/pdf-replacement`,
    { method: "POST", body: fd }
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as PdfReplacement;
}

// LinkModal A/P モード: 差替を「既存ファイルへのパス参照」として登録するフック。
export function useAddPdfReplacementByPath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      jobId: string;
      axisId: number;
      version_id: number;
      file_path: string;
      note?: string | null;
      created_by?: string | null;
    }) =>
      api<PdfReplacement>(
        `/v1/jobs/${params.jobId}/axes/${params.axisId}/pdf-replacements/by-path`,
        {
          method: "POST",
          json: {
            version_id: params.version_id,
            file_path: params.file_path,
            note: params.note ?? null,
            created_by: params.created_by ?? null,
          },
        },
      ),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["pdf-replacements", v.jobId, v.axisId] });
    },
  });
}

// ---- ソフトデリート (CLAUDE.md §2.1 厳守: ファイル実体は触らない) ----
export function useDeleteRelatedDoc(jobId: string, axisId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (docId: number) => {
      const res = await fetch(
        `/api/v1/jobs/${jobId}/axes/${axisId}/related-docs/${docId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["related-docs", jobId, axisId] });
    },
  });
}

export function useDeletePartsListVersion(jobId: string, axisId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: number) => {
      const res = await fetch(
        `/api/v1/jobs/${jobId}/axes/${axisId}/parts-list/versions/${versionId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["parts-list", jobId, axisId] });
    },
  });
}

export function useDeletePdfReplacement(jobId: string, axisId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (repId: number) => {
      const res = await fetch(
        `/api/v1/jobs/${jobId}/axes/${axisId}/pdf-replacements/${repId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pdf-replacements", jobId, axisId] });
    },
  });
}

// LinkModal U モード: PC からの関連資料アップロード。
export async function uploadRelatedDoc(
  jobId: string,
  axisId: number,
  file: File,
  title?: string,
  note?: string,
): Promise<RelatedDoc> {
  const fd = new FormData();
  fd.append("file", file);
  if (title) fd.append("title", title);
  if (note) fd.append("note", note);
  const res = await fetch(
    `/api/v1/jobs/${jobId}/axes/${axisId}/related-docs/upload`,
    { method: "POST", body: fd },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as RelatedDoc;
}

// ---- 済受領スキャン (旧 T4 メールフロー由来。メール廃止後も資料機能として存続) ----
// 旧 /api/v1/mail/scan-receipts から /api/v1/files/scan-receipts へ移設。
export interface ScanReceiptOut {
  path: string;
  size: number;
}

// LinkModal U モード: 「済」スキャン PDF を /mnt/uploads/scans/ にアップロードする。
export async function uploadScanReceipt(
  jobId: string,
  file: File,
): Promise<ScanReceiptOut> {
  const fd = new FormData();
  fd.append("job_id", jobId);
  fd.append("file", file);
  const res = await fetch(`/api/v1/files/scan-receipts`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as ScanReceiptOut;
}

// LinkModal A/P モード: scan-receipt を既存ファイルへのパス参照として登録する。
export async function registerScanReceiptByPath(
  jobId: string,
  filePath: string,
  note?: string,
): Promise<ScanReceiptOut> {
  const res = await fetch(`/api/v1/files/scan-receipts/by-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: jobId,
      file_path: filePath,
      note: note ?? null,
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as ScanReceiptOut;
}

// LinkModal U モード: PC からの部品リスト (新バージョン) アップロード。
export async function uploadPartsListVersion(
  jobId: string,
  axisId: number,
  file: File,
  label?: string,
  note?: string,
  createdBy?: string,
): Promise<PartsListVersion> {
  const fd = new FormData();
  fd.append("file", file);
  if (label) fd.append("label", label);
  if (note) fd.append("note", note);
  if (createdBy) fd.append("created_by", createdBy);
  const res = await fetch(
    `/api/v1/jobs/${jobId}/axes/${axisId}/parts-list/versions/upload`,
    { method: "POST", body: fd },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as PartsListVersion;
}
