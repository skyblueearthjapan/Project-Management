// V2 製造現場 DX: DXF を PDF (versions) と同格に扱うための API フック群。
//
// 設計方針:
//   - 一覧 / パス参照登録 / アップロード / フォルダ一括取込 の 4 系統
//   - サーバは axis_id ごとに「平置き」管理 (バージョン履歴なし)
//   - `is_link_broken` は link_check_results JOIN で動的に判定済の値
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface DxfFile {
  id: number;
  axis_id: number;
  file_path: string;
  label: string | null;
  note: string | null;
  size: number | null;
  sha256: string | null;
  created_at: string;
  created_by: string | null;
  is_link_broken: boolean;
  // Phase I: UI からアーカイブされた日時 (NULL = アクティブ)
  archived_at: string | null;
}

export interface DxfFileCreate {
  file_path: string;
  label?: string | null;
  note?: string | null;
  created_by?: string | null;
}

export interface DxfImportFolderResult {
  imported: number;
  skipped: number;
  found: number;
}

export function useDxfFiles(
  jobId: string,
  axisId: number | undefined,
  includeArchived: boolean = false,
) {
  const search = new URLSearchParams();
  if (includeArchived) search.set("include_archived", "true");
  const qs = search.toString();
  return useQuery({
    queryKey: ["dxf-files", jobId, axisId, includeArchived],
    queryFn: () =>
      api<DxfFile[]>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-files${qs ? `?${qs}` : ""}`,
      ),
    enabled: Boolean(jobId) && axisId !== undefined,
  });
}

function invalidateAfterDxfMutation(
  qc: ReturnType<typeof useQueryClient>,
  jobId: string,
  axisId: number,
) {
  void qc.invalidateQueries({ queryKey: ["dxf-files", jobId, axisId] });
  void qc.invalidateQueries({ queryKey: ["job", jobId] });
  void qc.invalidateQueries({ queryKey: ["jobs"] });
}

export function useArchiveDxfFile(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dxfId: number) =>
      api<DxfFile>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-files/${dxfId}/archive`,
        { method: "PATCH" },
      ),
    onSuccess: () => invalidateAfterDxfMutation(qc, jobId, axisId),
  });
}

export function useUnarchiveDxfFile(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dxfId: number) =>
      api<DxfFile>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-files/${dxfId}/unarchive`,
        { method: "PATCH" },
      ),
    onSuccess: () => invalidateAfterDxfMutation(qc, jobId, axisId),
  });
}

export function useRestoreDxfAsCurrent(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dxfId: number) =>
      api<DxfFile>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-files/${dxfId}/restore-as-current`,
        { method: "POST" },
      ),
    onSuccess: () => invalidateAfterDxfMutation(qc, jobId, axisId),
  });
}

export function useAddDxfPath(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DxfFileCreate) =>
      api<DxfFile>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-files`,
        { method: "POST", json: body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dxf-files", jobId, axisId] });
    },
  });
}

/**
 * Phase K: 単一 .dxf を `/mnt/uploads/dxf/{job}/{axis}/{name}.dxf` に保存して登録する。
 */
export async function uploadDxfFile(
  jobId: string,
  axisId: number,
  file: File,
  label?: string,
  note?: string,
): Promise<DxfFile> {
  const fd = new FormData();
  fd.append("file", file);
  if (label) fd.append("label", label);
  if (note) fd.append("note", note);
  const res = await fetch(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-files/upload`,
    { method: "POST", body: fd },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as DxfFile;
}

/** 旧名互換 (既存呼び出し箇所がある場合のため残す)。 */
export const uploadDxf = uploadDxfFile;

export function useImportDxfFolder(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folderPath?: string) =>
      api<DxfImportFolderResult>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-files/import-folder`,
        {
          method: "POST",
          json: { folder_path: folderPath ?? null },
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dxf-files", jobId, axisId] });
    },
  });
}

/** DXF id から配信 URL を組み立てる (DxfPage で使用)。 */
export function dxfFileUrl(dxfId: number): string {
  return `/api/v1/files/dxf/${dxfId}`;
}

// ---- Phase J: DXF フォルダ単位 API -------------------------------------------
export interface DxfFolderAddBody {
  folder_path: string;
  label?: string | null;
  note?: string | null;
  created_by?: string | null;
}

export interface DxfFolderAddResult {
  folder_path: string;
  registered: number;
  skipped: number;
  total_dxf: number;
  files: DxfFile[];
}

export interface DxfFolderReplaceResult {
  folder_path: string;
  archived: number;
  registered: number;
  total_dxf: number;
}

export function useAddDxfFolder(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DxfFolderAddBody) =>
      api<DxfFolderAddResult>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-folder`,
        { method: "POST", json: body },
      ),
    onSuccess: () => invalidateAfterDxfMutation(qc, jobId, axisId),
  });
}

export function useReplaceDxfFolder(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folderPath: string) =>
      api<DxfFolderReplaceResult>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-folder/replace`,
        { method: "POST", json: { folder_path: folderPath } },
      ),
    onSuccess: () => invalidateAfterDxfMutation(qc, jobId, axisId),
  });
}

// ---- Phase K: DXF フォルダ単位アップロード API -------------------------------
export interface DxfFolderUploadResult {
  uploaded: number;
  skipped_non_dxf: number;
  registered: number;
  files: DxfFile[];
}

export interface DxfFolderReplaceUploadResult {
  archived: number;
  uploaded: number;
  skipped_non_dxf: number;
  registered: number;
  files: DxfFile[];
}

/**
 * webkitdirectory で取得した複数 File を一括アップロードする。
 * 各 File の webkitRelativePath を `relative_paths` として並列送信する。
 */
export async function uploadDxfFolder(
  jobId: string,
  axisId: number,
  files: File[],
  label?: string,
  note?: string,
): Promise<DxfFolderUploadResult> {
  const fd = new FormData();
  for (const f of files) {
    fd.append("files", f);
    // webkitRelativePath は webkitdirectory 経由でない場合は空文字なので filename で代替
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    fd.append("relative_paths", rel);
  }
  if (label) fd.append("label", label);
  if (note) fd.append("note", note);
  const res = await fetch(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-folder/upload`,
    { method: "POST", body: fd },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as DxfFolderUploadResult;
}

/**
 * 現行 active な DXF を全 archive し、新しいフォルダを一括アップロードする。
 */
export async function replaceDxfFolderByUpload(
  jobId: string,
  axisId: number,
  files: File[],
  label?: string,
  note?: string,
): Promise<DxfFolderReplaceUploadResult> {
  const fd = new FormData();
  for (const f of files) {
    fd.append("files", f);
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    fd.append("relative_paths", rel);
  }
  if (label) fd.append("label", label);
  if (note) fd.append("note", note);
  const res = await fetch(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/dxf-folder/replace-by-upload`,
    { method: "POST", body: fd },
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as DxfFolderReplaceUploadResult;
}

export function useUploadDxfFolder(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      files,
      label,
      note,
    }: {
      files: File[];
      label?: string;
      note?: string;
    }) => uploadDxfFolder(jobId, axisId, files, label, note),
    onSuccess: () => invalidateAfterDxfMutation(qc, jobId, axisId),
  });
}

export function useReplaceDxfFolderByUpload(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      files,
      label,
      note,
    }: {
      files: File[];
      label?: string;
      note?: string;
    }) => replaceDxfFolderByUpload(jobId, axisId, files, label, note),
    onSuccess: () => invalidateAfterDxfMutation(qc, jobId, axisId),
  });
}
