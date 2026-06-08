import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./client";

// 出図お知らせ×DOVE連携 (WS-B): 工番別指示書 (Job単位) の API クライアント。
// - 既存 attachments.ts は軸単位だが、工番別指示書は Job 単位の新カテゴリ (契約 §3.3)。
// - jobs.ts / attachments.ts は触らず、本ファイルで独立フェッチする。
// - パスは参照のみ。ファイルの copy/move/delete/overwrite/rename は一切しない (CLAUDE.md §2.1)。

export interface JobInstruction {
  id: number;
  job_id: string;
  file_path: string;
  original_name: string | null;
  size: number | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

// 契約 §2.3: 指示書 PDF は job_id をパスに含まないため /files/fileserver では配信不可。
// DB-id 解決型の専用配信を使う。
export function jobInstructionFileUrl(id: number): string {
  return `/api/v1/files/job-instruction/${id}`;
}

// GET /api/v1/shutsuzu/jobs/{job_id}/instructions → active を created_at DESC で一覧 (契約 §2.2)
export function useJobInstructions(jobId: string | undefined) {
  return useQuery({
    queryKey: ["job-instructions", jobId],
    queryFn: () =>
      api<JobInstruction[]>(
        `/v1/shutsuzu/jobs/${encodeURIComponent(jobId ?? "")}/instructions`,
      ),
    enabled: Boolean(jobId),
  });
}

// POST /api/v1/shutsuzu/jobs/{job_id}/instructions → パス参照 1 件登録 (契約 §2.2)
export function useAddJobInstruction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      jobId: string;
      file_path: string;
      original_name?: string | null;
      note?: string | null;
    }) =>
      api<JobInstruction>(
        `/v1/shutsuzu/jobs/${encodeURIComponent(params.jobId)}/instructions`,
        {
          method: "POST",
          json: {
            file_path: params.file_path,
            original_name: params.original_name ?? null,
            note: params.note ?? null,
          },
        },
      ),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["job-instructions", v.jobId] });
    },
  });
}

// DELETE /api/v1/shutsuzu/jobs/{job_id}/instructions/{id} → ソフトデリート (実体は触らない)
export function useDeleteJobInstruction(jobId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    // 冪等化: 二度押し等で「既に削除済み (404)」が返っても成功扱いにする。
    // ソフトデリートは何度実行しても結果が同じため、404 はエラーにしない。
    mutationFn: async (instructionId: number) => {
      try {
        await api<void>(
          `/v1/shutsuzu/jobs/${encodeURIComponent(jobId ?? "")}/instructions/${instructionId}`,
          { method: "DELETE" },
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return;
        throw e;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["job-instructions", jobId] });
    },
  });
}
