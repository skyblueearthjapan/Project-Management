// Phase N-2: 軸単位の電子データネーム印 API フック。
// Phase N の `stamps.ts` (工番単位) と並存させ、UI からはこちらだけを呼ぶ。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface AxisPhaseStamp {
  step_id: number;
  worker_id: number | null;
  worker_name: string | null;
  worker_department: string | null;
  stamp_color: string | null;
  stamped_at: string | null;
  due_date: string | null;
}

function invalidateAfterAxisStamp(qc: ReturnType<typeof useQueryClient>): void {
  // 軸単位押印は axes.phase_stamps と axes.progress を変えるので jobs / job クエリを丸ごと再取得
  void qc.invalidateQueries({ queryKey: ["jobs"] });
  void qc.invalidateQueries({ queryKey: ["job"] });
}

export function useApplyAxisStamp(axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { step_id: number; worker_id: number }) =>
      api<AxisPhaseStamp>(`/v1/axes/${axisId}/phase-stamps`, {
        method: "POST",
        json: params,
      }),
    onSuccess: () => invalidateAfterAxisStamp(qc),
  });
}

export function useCancelAxisStamp(axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stepId: number) =>
      api<AxisPhaseStamp>(`/v1/axes/${axisId}/phase-stamps/${stepId}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidateAfterAxisStamp(qc),
  });
}

export function useSetAxisDueDate(axisId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { step_id: number; due_date: string | null }) =>
      api<AxisPhaseStamp>(
        `/v1/axes/${axisId}/phase-stamps/${params.step_id}/due-date`,
        { method: "PATCH", json: { due_date: params.due_date } },
      ),
    onSuccess: () => invalidateAfterAxisStamp(qc),
  });
}
