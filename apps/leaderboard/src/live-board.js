import { getPublicSite, getPublicLiveBoardVersion } from "./site.js";
import {
  liveBoardFallbackPollMs,
  liveBoardMaxSubscribers,
  liveBoardRetryAfter,
} from "./live-board-config.js";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

function requestForBoard(request, siteId, slug) {
  const headers = new Headers(request.headers);
  headers.set("x-live-board-site-id", String(siteId));
  headers.set("x-live-board-slug", String(slug));
  return new Request(`https://live-board/connect?site=${encodeURIComponent(siteId)}&slug=${encodeURIComponent(slug)}`, {
    method: "GET",
    headers,
  });
}

export async function connectLiveBoard(request, env, siteId, slug) {
  const id = env.LIVE_BOARD_DO.idFromName(String(siteId));
  return env.LIVE_BOARD_DO.get(id).fetch(requestForBoard(request, siteId, slug));
}

export class LiveBoard {
  constructor(state, env, deps = {}) {
    this.state = state;
    this.env = env;
    this.getPublicSite = deps.getPublicSite || getPublicSite;
    this.getPublicLiveBoardVersion = deps.getPublicLiveBoardVersion || getPublicLiveBoardVersion;
    this.subscribers = new Map();
    this.refreshing = null;
    this.lastVersion = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect" && request.method === "GET") {
      return this.connect(request);
    }
    if (url.pathname === "/notify" && request.method === "POST") {
      return this.notify(request);
    }
    return new Response("LiveBoard DO", { status: 200 });
  }

  async connect(request) {
    const url = new URL(request.url);
    const siteId = url.searchParams.get("site") || request.headers.get("x-live-board-site-id");
    const slug = url.searchParams.get("slug") || request.headers.get("x-live-board-slug");
    if (!siteId || !slug) return new Response("not found", { status: 404 });
    if (this.subscribers.size >= liveBoardMaxSubscribers(this.env)) {
      return new Response("Leaderboard stream is busy. Try again shortly.", {
        status: 503,
        headers: { "retry-after": String(liveBoardRetryAfter()) },
      });
    }

    const snapshot = await this.readSnapshot(request, siteId, slug);
    if (snapshot.error) return snapshot.error;

    const id = crypto.randomUUID();
    let closed = false;
    const encoder = new TextEncoder();
    let controllerRef;
    const stream = new ReadableStream({
      start: (controller) => {
        controllerRef = controller;
        controller.enqueue(encoder.encode(this.format(snapshot.payload)));
      },
      cancel: () => {
        closed = true;
        this.subscribers.delete(id);
        this.schedulePoll();
      },
    });
    this.subscribers.set(id, {
      controller: controllerRef,
      siteId,
      slug,
      close: () => {
        if (closed) return;
        closed = true;
        try { controllerRef?.close(); } catch { controllerRef = null; }
        this.subscribers.delete(id);
      },
    });
    this.schedulePoll();
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
    });
  }

  async notify(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("invalid notification", { status: 400 });
    }
    if (!body?.siteId) return new Response("invalid notification", { status: 400 });
    if (!body.version) {
      const pendingVersion = await this.state.storage.get("pendingVersion");
      await this.state.storage.put("pendingRefresh", true);
      await this.refresh(pendingVersion || null, !pendingVersion);
      return new Response("ok");
    }
    const version = String(body.version);
    const pendingVersion = await this.state.storage.get("pendingVersion");
    const requiredVersion = pendingVersion && String(pendingVersion) > version
      ? String(pendingVersion)
      : version;
    await this.state.storage.put("pendingVersion", requiredVersion);
    await this.state.storage.put("retryAttempt", 0);
    await this.refresh(requiredVersion);
    return new Response("ok");
  }

  async alarm() {
    await this.state.storage.delete("alarmAt");
    const pendingVersion = await this.state.storage.get("pendingVersion");
    const pendingRefresh = await this.state.storage.get("pendingRefresh");
    await this.refresh(pendingVersion || null, !!pendingRefresh);
    if (
      this.subscribers.size
      && !(await this.state.storage.get("pendingVersion"))
      && !(await this.state.storage.get("pendingRefresh"))
    ) this.schedulePoll();
  }

  schedulePoll() {
    if (!this.subscribers.size) return;
    const when = Date.now() + liveBoardFallbackPollMs(this.env);
    this.scheduleAlarm(when).catch((error) => {
      console.error("[live-board] alarm failed:", String(error?.message || error));
    });
  }

  async scheduleAlarm(when) {
    const current = await this.state.storage.get("alarmAt");
    // Durable Objects have one alarm slot: preserve whichever deadline is soonest.
    if (current && Number(current) <= when) return;
    await this.state.storage.put("alarmAt", when);
    await this.state.storage.setAlarm(when);
  }

  format(payload) {
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  async readSnapshot(request, siteId, slug) {
    const data = await this.getPublicSite(this.env, slug, request, { limit: 100, offset: 0, fresh: true });
    if (!data || data.suspended) return { error: new Response("not found", { status: 404 }) };
    if (data.requiresPassword) return { error: new Response("Password required.", { status: 401 }) };
    const version = await this.getPublicLiveBoardVersion(siteId);
    return {
      payload: {
        players: data.data.players,
        total: data.data.playerCount,
        updatedAt: version,
      },
    };
  }

  async refresh(requiredVersion, force = false) {
    if (!this.subscribers.size || this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const first = this.subscribers.values().next().value;
      if (!first) return;
      const snapshot = await this.readSnapshot(null, first.siteId, first.slug);
      if (snapshot.error) {
        for (const subscriber of [...this.subscribers.values()]) subscriber.close();
        await this.state.storage.delete("pendingVersion");
        await this.state.storage.delete("pendingRefresh");
        return;
      }
      if (requiredVersion && snapshot.payload.updatedAt < requiredVersion) {
        const attempt = Number(await this.state.storage.get("retryAttempt")) || 0;
        if (attempt < RETRY_DELAYS_MS.length) {
          await this.state.storage.put("retryAttempt", attempt + 1);
          await this.scheduleAlarm(Date.now() + RETRY_DELAYS_MS[attempt]);
        } else {
          await this.state.storage.delete("pendingVersion");
          await this.state.storage.delete("retryAttempt");
        }
        return;
      }
      if (!force && !requiredVersion && snapshot.payload.updatedAt === this.lastVersion) return;
      await this.state.storage.delete("pendingVersion");
      await this.state.storage.delete("pendingRefresh");
      await this.state.storage.delete("retryAttempt");
      this.lastVersion = snapshot.payload.updatedAt;
      const message = new TextEncoder().encode(this.format(snapshot.payload));
      for (const subscriber of [...this.subscribers.values()]) {
        try {
          subscriber.controller.enqueue(message);
        } catch {
          subscriber.close();
        }
      }
    })().catch((error) => {
      console.error("[live-board] refresh failed:", String(error?.message || error));
    }).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
}
