export type ApiOptions = RequestInit;

export function apiPath(path: string, siteId = "") {
  return siteId
    ? `${path}${path.includes("?") ? "&" : "?"}siteId=${encodeURIComponent(siteId)}`
    : path;
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {},
  siteId = "",
): Promise<T> {
  const response = await fetch(apiPath(path, siteId), {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "x-csrf-token": document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "",
      ...(options.headers || {}),
    },
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : "Something went wrong.";
    const error = new Error(message) as Error & { data: unknown };
    error.data = data;
    throw error;
  }
  return data as T;
}
