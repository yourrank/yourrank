export const DASHBOARD_REQUEST_TIMEOUT_MS = 10_000;

const DASHBOARD_AUTH_ERROR_VALUES = new Set(["unauthorized"]);

export class DashboardRequestError extends Error {
  constructor(message, { code = "REQUEST_FAILED", status = 0, cause } = {}) {
    super(message, { cause });
    this.name = "DashboardRequestError";
    this.code = code;
    this.status = status;
  }
}

export function isDashboardAuthError(body) {
  return [body?.code, body?.error].some((value) => (
    typeof value === "string" && DASHBOARD_AUTH_ERROR_VALUES.has(value.trim().toLowerCase())
  ));
}

export function loginRedirectPath(locationLike = globalThis.location) {
  const pathname = locationLike?.pathname || "/dashboard";
  const search = locationLike?.search || "";
  const next = `${pathname}${search}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

export async function withDashboardTimeout(operation, {
  timeoutMs = DASHBOARD_REQUEST_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new DashboardRequestError("The request timed out.", {
        code: "TIMEOUT",
      }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut || (controller.signal.aborted && error?.name === "AbortError")) {
      throw new DashboardRequestError("The request timed out.", {
        code: "TIMEOUT",
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDashboard(input, init = {}, {
  fetchFn = globalThis.fetch,
  timeoutMs = DASHBOARD_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof fetchFn !== "function") {
    throw new DashboardRequestError("The dashboard request function is unavailable.", {
      code: "REQUEST_FAILED",
    });
  }
  return withDashboardTimeout((signal) => fetchFn(input, { ...init, signal }), { timeoutMs });
}

export async function fetchDashboardJson(input, init = {}, options = {}) {
  let response;
  try {
    response = await fetchDashboard(input, init, options);
  } catch (error) {
    if (error instanceof DashboardRequestError) throw error;
    throw new DashboardRequestError(error?.message || "The dashboard request failed.", {
      code: "NETWORK",
      cause: error,
    });
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new DashboardRequestError(`The server returned invalid data (HTTP ${response.status}).`, {
      code: "INVALID_RESPONSE",
      status: response.status,
      cause: error,
    });
  }

  // AUDIT-B3: 401 (session ended) and 403 (signed in but not allowed) are
  // different facts. Treating 403 as AUTH told permission-limited team
  // members their session had ended and could bounce them into a login loop.
  if (response.status === 401 || (body?.ok === false && isDashboardAuthError(body))) {
    throw new DashboardRequestError("Your session has ended.", {
      code: "AUTH",
      status: response.status,
    });
  }
  if (response.status === 403) {
    throw new DashboardRequestError(body?.error || "You don't have access to do that.", {
      code: "FORBIDDEN",
      status: response.status,
    });
  }
  if (!response.ok) {
    // Preserve a server-supplied machine code (e.g. "kick_reconnect_required")
    // so callers can react to specific failures instead of parsing messages.
    const serverCode = typeof body?.code === "string" && body.code.trim() ? body.code.trim() : "";
    throw new DashboardRequestError(body?.error || `The server returned HTTP ${response.status}.`, {
      code: serverCode || (response.status >= 500 ? "SERVER" : "REQUEST_FAILED"),
      status: response.status,
    });
  }
  if (body?.ok === false) {
    // Preserve a server-supplied machine code (e.g. "concurrency_conflict")
    // so callers can react to specific failures instead of parsing messages.
    const serverCode = typeof body?.code === "string" && body.code.trim() ? body.code.trim() : "";
    throw new DashboardRequestError(body?.error || `The server returned an unsuccessful response (HTTP ${response.status}).`, {
      code: serverCode || "REQUEST_FAILED",
      status: response.status,
    });
  }
  return { response, body };
}
