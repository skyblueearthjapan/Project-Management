import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface ProgressStep {
  id: number;
  code: string;
  name: string;
  short_label: string;
  sort_order: number;
  is_active: boolean;
}
export interface User {
  id: number;
  code: string;
  display_name: string;
  email: string | null;
  department: string | null;
  is_active: boolean;
}

export function useProgressSteps() {
  return useQuery({
    queryKey: ["progress-steps-admin"],
    queryFn: () => api<ProgressStep[]>("/v1/admin/progress-steps"),
  });
}

export function useUpdateProgressStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ProgressStep) =>
      api<ProgressStep>(`/v1/admin/progress-steps/${id}`, { method: "PUT", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["progress-steps-admin"] }),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/v1/admin/users?include_inactive=true"),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<User, "id">) =>
      api<User>("/v1/admin/users", { method: "POST", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: User) =>
      api<User>(`/v1/admin/users/${id}`, { method: "PUT", json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
