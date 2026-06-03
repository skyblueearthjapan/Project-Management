import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface Worker {
  id: number;
  name: string;
  department: string | null;
  stamp_color: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkerCreate {
  name: string;
  department?: string | null;
  stamp_color?: string;
  active?: boolean;
}

export interface WorkerUpdate {
  name?: string;
  department?: string | null;
  stamp_color?: string;
  active?: boolean;
}

export function useWorkers(includeInactive = false) {
  return useQuery({
    queryKey: ["workers", includeInactive],
    queryFn: () =>
      api<Worker[]>(
        `/v1/workers${includeInactive ? "?include_inactive=true" : ""}`,
      ),
  });
}

export function useCreateWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkerCreate) =>
      api<Worker>("/v1/workers", { method: "POST", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workers"] }),
  });
}

export function useUpdateWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: WorkerUpdate }) =>
      api<Worker>(`/v1/workers/${id}`, { method: "PATCH", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workers"] }),
  });
}

// soft delete = active=false (CLAUDE.md §2.1 整合)
export function useDeactivateWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api<Worker>(`/v1/workers/${id}`, {
        method: "PATCH",
        json: { active: false },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workers"] }),
  });
}
