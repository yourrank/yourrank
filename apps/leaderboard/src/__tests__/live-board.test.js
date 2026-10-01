import { describe, expect, it } from "bun:test";
import { LiveBoard } from "../live-board.js";

function makeState() {
  const values = new Map();
  const alarms = [];
  return {
    alarms,
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
      setAlarm: async (at) => alarms.push(at),
    },
  };
}

function siteSnapshot(players = [{ name: "Alice", amount: 10 }]) {
  return {
    id: "site-1",
    data: { players, playerCount: players.length },
  };
}

function makeBoard({ versions = ["v1"], getPublicSite, max = 10 } = {}) {
  const state = makeState();
  let versionIndex = 0;
  const board = new LiveBoard(state, {
    LIVE_BOARD_MAX_SUBSCRIBERS: String(max),
    LIVE_BOARD_FALLBACK_POLL_MS: "60000",
  }, {
    getPublicSite: getPublicSite || (async () => siteSnapshot()),
    getPublicLiveBoardVersion: async () => versions[Math.min(versionIndex++, versions.length - 1)],
  });
  return { board, state };
}

async function connect(board, cookie = "board_password=valid") {
  const headers = cookie ? { cookie } : {};
  const response = await board.fetch(new Request("https://do/connect?site=site-1&slug=board", {
    headers,
  }));
  return { response, reader: response.body?.getReader() };
}

describe("LiveBoard Durable Object", () => {
  it("fans out one update to multiple subscribers", async () => {
    const { board } = makeBoard({ versions: ["v1", "v1", "v2"] });
    const first = await connect(board);
    const second = await connect(board);
    await first.reader.read();
    await second.reader.read();

    await board.fetch(new Request("https://do/notify", {
      method: "POST",
      body: JSON.stringify({ siteId: "site-1", version: "v2" }),
    }));

    const [firstUpdate, secondUpdate] = await Promise.all([first.reader.read(), second.reader.read()]);
    expect(new TextDecoder().decode(firstUpdate.value)).toContain('"players"');
    expect(new TextDecoder().decode(secondUpdate.value)).toContain('"players"');
  });

  it("closes every subscriber when the board becomes suspended", async () => {
    let suspended = false;
    const { board } = makeBoard({
      getPublicSite: async () => suspended ? { suspended: true } : siteSnapshot(),
    });
    const connection = await connect(board);
    await connection.reader.read();
    suspended = true;

    await board.fetch(new Request("https://do/notify", {
      method: "POST",
      body: JSON.stringify({ siteId: "site-1", version: "v2" }),
    }));

    expect((await connection.reader.read()).done).toBe(true);
  });

  it("closes authorized and unauthorized subscribers when the board becomes password protected", async () => {
    let protectedBoard = false;
    const { board } = makeBoard({
      getPublicSite: async () => protectedBoard ? { requiresPassword: true } : siteSnapshot(),
    });
    const authorized = await connect(board, "board_password=valid");
    const unauthorized = await connect(board, "");
    await authorized.reader.read();
    await unauthorized.reader.read();
    protectedBoard = true;

    await board.fetch(new Request("https://do/notify", {
      method: "POST",
      body: JSON.stringify({ siteId: "site-1", version: "v2" }),
    }));

    expect((await authorized.reader.read()).done).toBe(true);
    expect((await unauthorized.reader.read()).done).toBe(true);
  });

  it("refuses connections over the per-board subscriber cap", async () => {
    const { board } = makeBoard({ max: 1 });
    const first = await connect(board);
    const second = await connect(board);
    expect(second.response.status).toBe(503);
    expect(second.response.headers.get("retry-after")).toBe("30");
    await first.reader.cancel();
  });

  it("does not emit a stale notification and retries with bounded backoff", async () => {
    const { board, state } = makeBoard({ versions: ["v1", "v1", "v2"] });
    const connection = await connect(board);
    await connection.reader.read();

    await board.fetch(new Request("https://do/notify", {
      method: "POST",
      body: JSON.stringify({ siteId: "site-1", version: "v2" }),
    }));

    expect(state.alarms.length).toBeGreaterThan(0);
    const pendingRead = connection.reader.read();
    const noStaleUpdate = await Promise.race([
      pendingRead,
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 10)),
    ]);
    expect(noStaleUpdate.timeout).toBe(true);

    await board.alarm();
    const update = await pendingRead;
    expect(new TextDecoder().decode(update.value)).toContain('"updatedAt":"v2"');
  });

  it("uses the fallback poll when no notification arrives", async () => {
    const { board } = makeBoard({ versions: ["v1", "v2"] });
    const connection = await connect(board);
    await connection.reader.read();

    await board.alarm();
    const update = await connection.reader.read();
    expect(new TextDecoder().decode(update.value)).toContain('"updatedAt":"v2"');
  });

  it("refreshes unversioned notifications without inventing a timestamp", async () => {
    const { board } = makeBoard({ versions: ["v1", "v1"] });
    const connection = await connect(board);
    await connection.reader.read();

    await board.fetch(new Request("https://do/notify", {
      method: "POST",
      body: JSON.stringify({ siteId: "site-1" }),
    }));

    const update = await connection.reader.read();
    expect(new TextDecoder().decode(update.value)).toContain('"updatedAt":"v1"');
  });
});
