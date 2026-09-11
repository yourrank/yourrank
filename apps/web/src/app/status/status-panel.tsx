"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type HealthResponse = {
  status?: string;
  timestamp?: string;
  db?: boolean;
  consumer?: { healthy?: boolean };
  dlq?: { pending?: number };
};

type CheckState = "operational" | "degraded" | "unknown";

const DOT: Record<CheckState, string> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  unknown: "bg-devin-ink-soft/40",
};

const LABEL: Record<CheckState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  unknown: "Unknown",
};

function Row({ name, description, state }: { name: string; description: string; state: CheckState }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-devin-line py-5 last:border-b-0">
      <div>
        <p className="font-medium">{name}</p>
        <p className="mt-1 text-sm text-devin-ink-soft">{description}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-2 font-mono text-xs uppercase tracking-widest text-devin-ink-soft">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[state]}`} />
        {LABEL[state]}
      </span>
    </div>
  );
}

export function StatusPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/health", { cache: "no-store" });
      const data = (await res.json()) as HealthResponse;
      setHealth(data);
      setCheckedAt(new Date().toLocaleTimeString());
    } catch {
      setHealth(null);
      setError(true);
      setCheckedAt(new Date().toLocaleTimeString());
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const siteState: CheckState = error ? "degraded" : health ? "operational" : "unknown";
  const dbState: CheckState = health ? (health.db ? "operational" : "degraded") : "unknown";
  const analyticsState: CheckState = health ? (health.consumer?.healthy ? "operational" : "degraded") : "unknown";
  const overall: CheckState = error
    ? "degraded"
    : health
      ? health.status === "ok"
        ? "operational"
        : "degraded"
      : "unknown";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-devin-line bg-white p-6">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={`h-3 w-3 rounded-full ${DOT[overall]}`} />
          <p className="text-lg font-medium">
            {overall === "operational" && "All systems operational"}
            {overall === "degraded" && (error ? "Status check unreachable" : "Some systems degraded")}
            {overall === "unknown" && "Checking systems…"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* DEF-20: Manual refresh trigger — no need to wait 60s during an incident */}
          <p className="font-mono text-xs text-devin-ink-soft">
            {checkedAt ? `Live check · as of ${checkedAt}` : "Running live check…"}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="font-mono text-xs text-devin-primary underline underline-offset-4 hover:opacity-80"
            aria-label="Refresh status now"
          >
            Refresh now
          </button>
        </div>
      </div>

      <div className="mt-8 rounded-[16px] border border-devin-line bg-white px-6">
        <Row name="Sites & dashboard" description="Public leaderboard sites, overlays, and the streamer dashboard." state={siteState} />
        <Row name="Database" description="Standings, credits, and account data." state={dbState} />
        <Row name="Analytics pipeline" description="Views, clicks, and dashboard stats processing." state={analyticsState} />
      </div>

      <p className="mt-6 text-sm leading-relaxed text-devin-ink-soft">
        This page runs a live health check against production when you open it and refreshes every minute — it shows
        current status, not a historical uptime record. Seeing a problem we don&apos;t?{" "}
        <Link href="/help/support" className="text-devin-ink underline underline-offset-4 hover:text-devin-primary">Tell us</Link>.
      </p>
    </div>
  );
}
