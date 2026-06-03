const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export type FetchOptions = RequestInit & { json?: unknown };

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(`${status}: ${detail}`);
  }
}

export async function api<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers = new Headers(opts.headers ?? {});
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    opts.body = JSON.stringify(opts.json);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = (await res.json()) as { detail?: string };
      detail = data.detail ?? detail;
    } catch {
      // body is not JSON; keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
