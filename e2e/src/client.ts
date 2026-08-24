export interface ResponseLike {
  status: number;
  headers: Headers;
  body: string;
  json?: any;
}

export class Client {
  baseUrl: string;
  cookies: Record<string, string> = {};
  csrfToken: string = "";
  lastRes?: Response;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private setCookies(setCookie: string | null) {
    if (!setCookie) return;
    // Responses may combine multiple Set-Cookie values with ", ".
    // Neither yr_session nor __csrf uses Expires, so ", " is a safe separator.
    for (const part of setCookie.split(", ")) {
      const m = part.match(/^\s*([^=\s]+)=([^;]+)/);
      if (m) {
        const name = m[1];
        let value = m[2];
        try {
          value = decodeURIComponent(value);
        } catch {
          // leave as-is
        }
        if (name === "__csrf") {
          this.csrfToken = value;
        }
        this.cookies[name] = value;
      }
    }
  }

  private cookieHeader(): string {
    const parts: string[] = [];
    if (this.cookies["yr_session"]) parts.push(`yr_session=${encodeURIComponent(this.cookies["yr_session"])}`);
    if (this.cookies["__csrf"]) parts.push(`__csrf=${this.cookies["__csrf"]}`);
    if (this.cookies["yr_viewer"]) parts.push(`yr_viewer=${encodeURIComponent(this.cookies["yr_viewer"])}`);
    return parts.join("; ");
  }

  /** Adopts a viewer session captured out-of-band (Kick/Telegram OAuth cannot run headless). */
  setViewerSession(token: string) {
    this.cookies["yr_viewer"] = token;
  }

  async req(
    method: string,
    path: string,
    opts: { body?: any; headers?: Record<string, string>; skipCsrf?: boolean; redirect?: RequestRedirect } = {}
  ): Promise<ResponseLike> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    const cookie = this.cookieHeader();
    if (cookie) {
      headers["Cookie"] = cookie;
    }

    // Bot dashboard requires same Origin header; leaderboard requires CSRF token.
    if (method !== "GET" && method !== "HEAD" && !opts.skipCsrf) {
      headers["Origin"] = this.baseUrl;
      if (this.csrfToken) {
        headers["X-CSRF-Token"] = this.csrfToken;
      }
    }

    let body: string | undefined;
    if (opts.body !== undefined) {
      if (typeof opts.body === "string") {
        body = opts.body;
      } else {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.body);
      }
    }

    const res = await fetch(url, { method, headers, body, redirect: opts.redirect });
    this.lastRes = res;

    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.setCookies(setCookie);

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }

    return { status: res.status, headers: res.headers, body: text, json };
  }

  get(path: string, opts?: { headers?: Record<string, string>; redirect?: RequestRedirect }) {
    return this.req("GET", path, opts);
  }

  post(path: string, body?: any, opts?: { headers?: Record<string, string>; skipCsrf?: boolean }) {
    return this.req("POST", path, { ...opts, body });
  }

  put(path: string, body?: any, opts?: { headers?: Record<string, string> }) {
    return this.req("PUT", path, { ...opts, body });
  }

  patch(path: string, body?: any, opts?: { headers?: Record<string, string> }) {
    return this.req("PATCH", path, { ...opts, body });
  }

  delete(path: string, opts?: { headers?: Record<string, string> }) {
    return this.req("DELETE", path, opts);
  }
}

export async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}
