import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface PhaseStamp {
  step_id: number;
  worker_id: number | null;
  worker_name: string | null;
  worker_department: string | null;
  stamp_color: string | null;
  stamped_at: string | null;
  due_date: string | null;
}

function invalidateAfterStamp(
  qc: ReturnType<typeof useQueryClient>,
  jobId: string,
) {
  void qc.invalidateQueries({ queryKey: ["job", jobId] });
  void qc.invalidateQueries({ queryKey: ["jobs"] });
}

export function useApplyStamp(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { step_id: number; worker_id: number }) =>
      api<PhaseStamp>(
        `/v1/jobs/${encodeURIComponent(jobId)}/phase-stamps`,
        { method: "POST", json: params },
      ),
    onSuccess: () => invalidateAfterStamp(qc, jobId),
  });
}

export function useCancelStamp(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stepId: number) =>
      api<PhaseStamp>(
        `/v1/jobs/${encodeURIComponent(jobId)}/phase-stamps/${stepId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => invalidateAfterStamp(qc, jobId),
  });
}

export function useSetDueDate(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { step_id: number; due_date: string | null }) =>
      api<PhaseStamp>(
        `/v1/jobs/${encodeURIComponent(jobId)}/phase-stamps/${params.step_id}/due-date`,
        { method: "PATCH", json: { due_date: params.due_date } },
      ),
    onSuccess: () => invalidateAfterStamp(qc, jobId),
  });
}
