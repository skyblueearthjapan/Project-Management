// Phase O: PDF ページ表示回転メタの取得 / 全置換 API フック。
// 新 PDF を作らず軽量にページ回転だけを永続化するための経路。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface PdfRotation {
  page_index: number;
  rotation: number; // 0 / 90 / 180 / 270
}

export function usePdfRotations(versionId: number | null | undefined) {
  return useQuery({
    queryKey: ["pdf-rotations", versionId],
    queryFn: () =>
      api<PdfRotation[]>(`/v1/versions/${versionId}/rotations`),
    enabled: versionId !== null && versionId !== undefined,
    staleTime: 0,
  });
}

export function useReplacePdfRotations(versionId: number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rotations: PdfRotation[]) => {
      if (versionId === null || versionId === undefined) {
        return Promise.reject(new Error("versionId が指定されていません"));
      }
      return api<PdfRotation[]>(`/v1/versions/${versionId}/rotations`, {
        method: "PUT",
        json: { rotations },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pdf-rotations", versionId] });
    },
  });
}
