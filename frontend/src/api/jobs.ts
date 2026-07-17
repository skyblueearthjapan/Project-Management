import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { PhaseStamp } from "./stamps";

// Phase A 刈り込み: "starred" は FilterValue から除外 (★ お気に入り機能廃止 — Round 3 合意)
// "archived": 論理アーカイブ済み (削除ボタンで非表示化した工番) のみを返す
export type FilterValue = "all" | "inprog" | "over" | "thisweek" | "archived";

export interface AxisProgressRead {
  step_id: number;
  code: string | null;
  short_label: string | null;
  state: "notstarted" | "inprogress" | "done";
  sort_order: number | null;
}

export interface AxisRead {
  id: number;
  name: string;
  sort_order: number;
  third_party_required: boolean;
  progress: AxisProgressRead[];
  current_version_id: number | null;
  current_version_no: number | null;
  latest_release_at: string | null;
  // Phase D: 最新バージョン PDF がリンク切れかどうか
  current_version_link_broken: boolean;
  // Phase N-2: 軸ごとの電子データネーム印 (期日 / 押印情報)。
  // 型は `./axis-stamps` の AxisPhaseStamp と一致 — 循環 import 回避のため
  // ここでは依存しない最小定義を持たせる。
  phase_stamps: Array<{
    step_id: number;
    worker_id: number | null;
    worker_name: string | null;
    worker_department: string | null;
    stamp_color: string | null;
    stamped_at: string | null;
    due_date: string | null;
  }>;
  // 論理アーカイブ (削除ボタン)。null = アクティブ。
  archived_at: string | null;
}

export interface JobRead {
  id: string;
  title: string;
  customer: string | null;
  delivery_date: string | null;
  delivery_date_internal: string | null;
  note: string | null;
  starred: boolean;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
  // 論理アーカイブ (削除ボタン)。null = アクティブ。
  archived_at: string | null;
  axes: AxisRead[];
  // Phase N: 工程ごとの電子データネーム印 (期日 / 押印状態)
  phase_stamps: PhaseStamp[];
}

export interface JobPage {
  items: JobRead[];
  total: number;
  page: number;
  page_size: number;
}

export type SortKey = "due" | "progress" | "id";

export function useJobs(params: {
  q?: string;
  filter?: FilterValue;
  sort?: SortKey;
  page?: number;
}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.filter) search.set("filter", params.filter);
  if (params.sort) search.set("sort", params.sort);
  if (params.page) search.set("page", String(params.page));
  return useQuery({
    queryKey: ["jobs", Object.fromEntries(search)],
    queryFn: () => api<JobPage>(`/v1/jobs?${search.toString()}`),
  });
}

export function useJobCounts(q?: string) {
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  return useQuery({
    queryKey: ["jobs-counts", q ?? ""],
    queryFn: () =>
      api<Record<FilterValue, number>>(
        `/v1/jobs/counts${search.toString() ? `?${search}` : ""}`
      ),
  });
}

export function useJob(
  jobId: string | undefined,
  includeArchivedAxes: boolean = false,
) {
  const qs = includeArchivedAxes ? "?include_archived_axes=true" : "";
  return useQuery({
    queryKey: ["job", jobId, includeArchivedAxes],
    queryFn: () => api<JobRead>(`/v1/jobs/${jobId}${qs}`),
    enabled: Boolean(jobId),
  });
}

export interface JobCreate {
  id: string;
  title: string;
  customer?: string | null;
  delivery_date?: string | null;
  delivery_date_internal?: string | null;
  note?: string | null;
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: JobCreate) =>
      api<JobRead>("/v1/jobs", { method: "POST", json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

// 工番・軸の論理アーカイブ (削除ボタン)。
// 実ファイル・DB 行は消さない。archived_at を立てて一覧/詳細から非表示にするだけで、
// 「アーカイブ済み」フィルタ / 復元パネルからいつでも戻せる。
export function useArchiveJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      api<JobRead>(`/v1/jobs/${encodeURIComponent(jobId)}/archive`, {
        method: "PATCH",
      }),
    onSuccess: (_d, jobId) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["jobs-counts"] });
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
}

export function useUnarchiveJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      api<JobRead>(`/v1/jobs/${encodeURIComponent(jobId)}/unarchive`, {
        method: "PATCH",
      }),
    onSuccess: (_d, jobId) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["jobs-counts"] });
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
}

export function useArchiveAxis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, axisId }: { jobId: string; axisId: number }) =>
      api<{ id: number; archived_at: string | null }>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/archive`,
        { method: "PATCH" },
      ),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["job", v.jobId] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useUnarchiveAxis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, axisId }: { jobId: string; axisId: number }) =>
      api<{ id: number; archived_at: string | null }>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/unarchive`,
        { method: "PATCH" },
      ),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["job", v.jobId] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

// Phase I: バージョン履歴パネル用。include_archived=true で全件取得。
export interface VersionRead {
  id: number;
  version_no: number;
  label: string | null;
  pdf_path: string;
  pdf_size: number | null;
  note: string | null;
  released_at: string | null;
  released_by: string | null;
  created_at: string;
  is_link_broken: boolean;
  archived_at: string | null;
}

export function useVersions(
  jobId: string,
  axisId: number | undefined,
  includeArchived: boolean = false,
) {
  const search = new URLSearchParams();
  if (includeArchived) search.set("include_archived", "true");
  const qs = search.toString();
  return useQuery({
    queryKey: ["versions", jobId, axisId, includeArchived],
    queryFn: () =>
      api<VersionRead[]>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/versions${qs ? `?${qs}` : ""}`,
      ),
    enabled: Boolean(jobId) && axisId !== undefined,
  });
}

function invalidateAfterVersionMutation(
  qc: ReturnType<typeof useQueryClient>,
  jobId: string,
  axisId: number,
) {
  void qc.invalidateQueries({ queryKey: ["versions", jobId, axisId] });
  void qc.invalidateQueries({ queryKey: ["job", jobId] });
  void qc.invalidateQueries({ queryKey: ["jobs"] });
}

export function useArchiveVersion(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: number) =>
      api<VersionRead>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/versions/${versionId}/archive`,
        { method: "PATCH" },
      ),
    onSuccess: () => invalidateAfterVersionMutation(qc, jobId, axisId),
  });
}

export function useUnarchiveVersion(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: number) =>
      api<VersionRead>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/versions/${versionId}/unarchive`,
        { method: "PATCH" },
      ),
    onSuccess: () => invalidateAfterVersionMutation(qc, jobId, axisId),
  });
}

export function useRestoreVersionAsCurrent(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: number) =>
      api<VersionRead>(
        `/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/versions/${versionId}/restore-as-current`,
        { method: "POST" },
      ),
    onSuccess: () => invalidateAfterVersionMutation(qc, jobId, axisId),
  });
}

// Phase J: PDF の「入れ替え」 (現行 archive + 新バージョン作成を 1 操作で)
// multipart で送信する。file (アップロード) または pdf_path (パス参照) のどちらかを指定。
export interface ReplaceCurrentVersionInput {
  file?: File | null;
  pdfPath?: string | null;
  label?: string | null;
  note?: string | null;
  releasedBy?: string | null;
}

export interface ReplaceCurrentVersionResult {
  archived_version_id: number | null;
  new_version: VersionRead;
}

export function useReplaceCurrentVersion(jobId: string, axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReplaceCurrentVersionInput): Promise<ReplaceCurrentVersionResult> => {
      const fd = new FormData();
      if (input.file) fd.append("file", input.file);
      if (input.pdfPath) fd.append("pdf_path", input.pdfPath);
      if (input.label) fd.append("label", input.label);
      if (input.note) fd.append("note", input.note);
      if (input.releasedBy) fd.append("released_by", input.releasedBy);
      const res = await fetch(
        `/api/v1/jobs/${encodeURIComponent(jobId)}/axes/${axisId}/versions/replace-current`,
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const data = (await res.json()) as { detail?: string };
          if (data.detail) detail = data.detail;
        } catch {
          /* not JSON */
        }
        throw new Error(detail);
      }
      return (await res.json()) as ReplaceCurrentVersionResult;
    },
    onSuccess: () => invalidateAfterVersionMutation(qc, jobId, axisId),
  });
}

export interface AxisCreate {
  name: string;
  sort_order?: number;
  third_party_required?: boolean;
}

export function useCreateAxis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: AxisCreate }) =>
      api<{ id: number; name: string }>(`/v1/jobs/${jobId}/axes`, {
        method: "POST",
        json: body,
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ["job", v.jobId] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

// Phase A 刈り込み: ★ お気に入り機能は柱①②どちらにも貢献しないため削除
// (旧 useToggleStar はここから削除。jobs.starred カラムは DB に残るが UI からは触らない)

// Phase G M-2: 楽観的更新を導入。
//   - タブレット現場では「タップ → 200-800ms 遅延」で二重タップ誤操作が発生していた。
//   - onMutate でキャッシュ上の該当 axis.progress[].state を即時書換 → 視覚反映 0ms。
//   - 失敗時は context.previousJobs にスナップショットしておいた値で全件ロールバック。
//   - onSettled で最終的にサーバ側と同期 (invalidate)。
export function useUpdateProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { axisId: number; stepCode: string; state: AxisProgressRead["state"] }) =>
      api<unknown>(`/v1/progress/${params.axisId}/${params.stepCode}`, {
        method: "PATCH",
        json: { state: params.state },
      }),

    onMutate: async (params) => {
      // 進行中の job クエリをキャンセル (refetch がロールバック後に走らないように)
      await qc.cancelQueries({ queryKey: ["job"] });
      await qc.cancelQueries({ queryKey: ["jobs"] });

      // 個別 job キャッシュ (["job", jobId]) を楽観更新
      const previousJobs = qc.getQueriesData<JobRead>({ queryKey: ["job"] });
      for (const [key, oldData] of previousJobs) {
        if (!oldData) continue;
        const newJob: JobRead = {
          ...oldData,
          axes: oldData.axes.map((a) =>
            a.id === params.axisId
              ? {
                  ...a,
                  progress: a.progress.map((p) =>
                    p.code === params.stepCode ? { ...p, state: params.state } : p,
                  ),
                }
              : a,
          ),
        };
        qc.setQueryData(key, newJob);
      }

      // 一覧キャッシュ (["jobs", ...]) も同様に書換 (JobPage.items を辿る)
      const previousPages = qc.getQueriesData<JobPage>({ queryKey: ["jobs"] });
      for (const [key, oldData] of previousPages) {
        if (!oldData) continue;
        const newPage: JobPage = {
          ...oldData,
          items: oldData.items.map((j) => ({
            ...j,
            axes: j.axes.map((a) =>
              a.id === params.axisId
                ? {
                    ...a,
                    progress: a.progress.map((p) =>
                      p.code === params.stepCode ? { ...p, state: params.state } : p,
                    ),
                  }
                : a,
            ),
          })),
        };
        qc.setQueryData(key, newPage);
      }

      return { previousJobs, previousPages };
    },

    onError: (_err, _vars, context) => {
      // 失敗時はスナップショットで全件ロールバック
      if (context?.previousJobs) {
        for (const [key, oldData] of context.previousJobs) {
          qc.setQueryData(key, oldData);
        }
      }
      if (context?.previousPages) {
        for (const [key, oldData] of context.previousPages) {
          qc.setQueryData(key, oldData);
        }
      }
    },

    onSettled: () => {
      // 成否に関わらず最終的にサーバ側の真の状態と同期する
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job"] });
    },
  });
}
