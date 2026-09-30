import type { AdminPageDependencies } from "./types";

export type AdminApiErrorKind = "auth" | "twofa" | "forbidden" | "network";

export class AdminApiError extends Error {
  readonly kind: AdminApiErrorKind;

  constructor(kind: AdminApiErrorKind, message: string = kind) {
    super(message);
    this.name = "AdminApiError";
    this.kind = kind;
  }
}

function csrfToken() {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/);
  return match?.[1] || "";
}

function navigateTo(path: string) {
  if (typeof window !== "undefined") window.location.href = path;
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function errorValue(data: unknown) {
  if (!data || typeof data !== "object") return "forbidden";
  const value = (data as { error?: unknown }).error;
  return typeof value === "string" ? value : "forbidden";
}

export async function adminApi<T extends object = Record<string, unknown>>(
  path: string,
  options: RequestInit = {},
  dependencies: AdminPageDependencies & { onForbidden?: () => void } = {},
): Promise<T> {
  const headers = headerRecord(options.headers);
  const method = (options.method || "GET").toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) headers["x-csrf-token"] = csrfToken();
  const request: RequestInit = {
    ...options,
    credentials: "include",
    headers,
  };
  let response: Response;
  try {
    response = await (dependencies.fetcher || globalThis.fetch)(path, request);
  } catch {
    throw new AdminApiError("network", "Network error.");
  }
  const data = await response.json().catch(() => ({})) as T;
  const navigate = dependencies.navigate || navigateTo;
  if (response.status === 401) {
    navigate("/login");
    throw new AdminApiError("auth", "auth");
  }
  if (response.status === 403) {
    const error = errorValue(data);
    if (["2fa_required", "2fa_setup_required", "2fa_stale"].includes(error)) {
      navigate("/admin");
      throw new AdminApiError("twofa", "2fa");
    }
    dependencies.onForbidden?.();
    throw new AdminApiError("forbidden", "forbidden");
  }
  return data;
}
