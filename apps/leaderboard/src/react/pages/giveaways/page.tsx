import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Crown,
  Download,
  Gift,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { engageCardState } from "../../../assets/dashboard/engage-hub-state.js";
import { withDashboardTimeout } from "../../../assets/dashboard/request.js";
import { ENGAGE_FEATURES, GIVEAWAY_TABS } from "../../../pages/giveaway-pages.js";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import type {
  BoardShell,
  ChatGiveawayPayload,
  GiveawayDraw,
  GiveawayEntrant,
  GiveawayPageDependencies,
  GiveawayRules,
  GiveawayWinner,
} from "./types";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    __yrBoot?: {
      fail: (message: string) => void;
      signal: () => void;
    };
  }
}

const BOARD_SHELL_MODULE = "/assets/dashboard/board-shell.js";
const DEFAULT_AVATAR = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#e2e8f0"/><circle cx="32" cy="24" r="12" fill="#94a3b8"/><path d="M10 60c2-13 10-20 22-20s20 7 22 20" fill="#94a3b8"/></svg>')}`;
const CHAT_POLL_MS = 4_000;
const HUB_UNAVAILABLE = {
  tone: "neutral",
  status: "unavailable",
  label: "Status unavailable",
  meta: "Couldn't load status. Open the page to check.",
};

type ActiveTab = "chat" | "hub" | "tournaments";
type ApiErrorData = ChatGiveawayPayload & { error?: string; code?: string };
type EngageRowState = {
  tone: string;
  status: string;
  label: string;
  meta: string;
};
type Confirmation = {
  title: string;
  description: string;
  action: string;
  cancelLabel?: string;
  destructive?: boolean;
};
type PageDependencies = GiveawayPageDependencies;
type GiveawayPageProps = {
  initialTab?: string;
  dependencies?: Partial<PageDependencies>;
};

const DEFAULT_DEPENDENCIES: PageDependencies = {
  api: <T = unknown>(
    path: string,
    options: Parameters<PageDependencies["api"]>[1] = {},
    siteId = "",
  ) => withDashboardTimeout((signal: AbortSignal) => api<T>(path, { ...options, signal }, siteId)),
  loadBoardShell: async () => {
    const shell = await import(BOARD_SHELL_MODULE) as { loadBoardShell: () => Promise<BoardShell> };
    return shell.loadBoardShell();
  },
};

const EMPTY_CONNECTION = { connected: false, chatReady: false, channelName: null };
const DEFAULT_RULES: GiveawayRules = {
  entryMode: "chat",
  subscriberOnly: false,
  vipOnly: false,
  excludePreviousWinners: false,
  winnerRepeat: "once",
  onePerIp: false,
  vpnDetection: false,
  winnerMustRespond: false,
  responseTimeout: 60,
  autoReroll: false,
};
function post(body: object): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

function errorData(error: unknown): ApiErrorData {
  if (!(error instanceof Error) || !("data" in error)) return {};
  const data = error.data;
  if (typeof data !== "object" || data === null) return {};
  const result: ApiErrorData = {};
  if ("error" in data && typeof data.error === "string") result.error = data.error;
  if ("code" in data && typeof data.code === "string") result.code = data.code;
  if ("connection" in data && typeof data.connection === "object" && data.connection !== null) result.connection = data.connection as ChatGiveawayPayload["connection"];
  if ("session" in data && (data.session === null || typeof data.session === "object")) result.session = data.session as ChatGiveawayPayload["session"];
  if ("entries" in data && Array.isArray(data.entries)) result.entries = data.entries as GiveawayEntrant[];
  if ("winner" in data && (data.winner === null || typeof data.winner === "object")) result.winner = data.winner as GiveawayWinner | null;
  if ("draws" in data && Array.isArray(data.draws)) result.draws = data.draws as GiveawayDraw[];
  return result;
}

function errorMessage(error: unknown, fallback: string) {
  return errorData(error).error || (error instanceof Error && error.message) || fallback;
}

function errorStatus(error: unknown) {
  return error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 0;
}

function formatEnteredAt(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function safeAvatarUrl(value: string | null | undefined) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    if (url.protocol === "https:" && url.hostname === "files.kick.com") return url.href;
  } catch {
    return DEFAULT_AVATAR;
  }
  return DEFAULT_AVATAR;
}

function safeKickProfileUrl(username: string) {
  return `https://kick.com/${encodeURIComponent(username)}`;
}

function playWinnerSound() {
  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.15, context.currentTime + index * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + index * 0.1 + 0.6);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + index * 0.1);
      oscillator.stop(context.currentTime + index * 0.1 + 0.6);
    });
  } catch {}
}

function formatAdvancedSummary(rules: GiveawayRules) {
  const enabled = [
    rules.subscriberOnly && "Subscriber only",
    rules.vipOnly && "VIP only",
    rules.excludePreviousWinners && "Exclude past winners",
    rules.onePerIp && "One per IP",
    rules.vpnDetection && "VPN blocked",
  ].filter(Boolean);
  return enabled.length ? enabled.join(" · ") : "Off";
}

function isEligible(entrant: GiveawayEntrant) {
  return entrant.eligibility_status === "eligible";
}

function linkedReasonLabel(code: string) {
  return ({
    same_device: "Same device",
    same_identity: "Same account",
    same_ip_24h: "Same IP",
    same_time_claims: "Same-time claims",
  } as Record<string, string>)[code] || code.replaceAll("_", " ");
}

function linkedExcludePlan(entries: GiveawayEntrant[]) {
  const linked = entries.filter((entry) => Array.isArray(entry.linked) && entry.linked.length > 0);
  const parent = new Map<string, string>();
  const find = (value: string): string => {
    const previous = parent.get(value);
    if (!previous || previous === value) return value;
    const root = find(previous);
    parent.set(value, root);
    return root;
  };
  const join = (left: string, right: string) => {
    parent.set(left, find(left));
    parent.set(right, find(right));
    parent.set(find(left), find(right));
  };
  for (const entry of linked) parent.set(entry.id, entry.id);
  const byUsername = new Map(entries.map((entry) => [entry.username.toLowerCase(), entry.id]));
  for (const entry of linked) {
    for (const link of entry.linked || []) {
      const otherId = byUsername.get(link.username.toLowerCase());
      if (otherId) join(entry.id, otherId);
    }
  }
  const components = new Map<string, GiveawayEntrant[]>();
  for (const entry of linked) {
    const root = find(entry.id);
    components.set(root, [...(components.get(root) || []), entry]);
  }
  const excludable: GiveawayEntrant[] = [];
  for (const group of components.values()) {
    const eligible = group
      .filter(isEligible)
      .sort((left, right) => new Date(left.entered_at).getTime() - new Date(right.entered_at).getTime());
    excludable.push(...eligible.slice(1));
  }
  return excludable;
}

function StatusMessage({
  children,
  tone = "neutral",
  role = "status",
  className,
  id,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "error" | "success";
  role?: "status" | "alert";
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "success" && "border-emerald-600/25 bg-emerald-600/5 text-emerald-800",
        tone === "neutral" && "border-border bg-muted/40 text-muted-foreground",
        className,
      )}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
    >
      {children}
    </div>
  );
}

function ConfirmAction({
  confirmation,
  onConfirm,
  onCancel,
}: {
  confirmation: Confirmation | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{confirmation?.cancelLabel || "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            className={confirmation?.destructive ? "bg-destructive text-white hover:bg-destructive/90" : ""}
            onClick={onConfirm}
          >
            {confirmation?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function GiveawaysPage({ initialTab, dependencies }: GiveawayPageProps) {
  const deps = useMemo(() => ({ ...DEFAULT_DEPENDENCIES, ...dependencies }), [dependencies]);
  const [tab, setTab] = useState<ActiveTab>(() => {
    const routeTab = initialTab || document.getElementById("giveaway-root")?.getAttribute("data-tab") || "chat";
    return (["chat", "hub", "tournaments"].includes(routeTab) ? routeTab : "chat") as ActiveTab;
  });
  const [siteId, setSiteId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [bootReady, setBootReady] = useState(false);
  const [bootError, setBootError] = useState("");
  const [pageAlert, setPageAlert] = useState("");

  useEffect(() => {
    let active = true;
    void deps.loadBoardShell().then((shell) => {
      if (!active) return;
      setSiteId(shell.activeSiteId || "");
      setSiteName(shell.board?.name || shell.board?.slug || "");
      setBootReady(true);
    }).catch((error: unknown) => {
      if (!active) return;
      setBootError(errorMessage(error, "The dashboard shell could not be loaded."));
      window.__yrBoot?.fail(errorMessage(error, "The dashboard shell could not be loaded."));
    });
    return () => { active = false; };
  }, [deps]);

  const setTabFromRoot = useCallback(() => {
    const routeTab = document.getElementById("giveaway-root")?.getAttribute("data-tab") || initialTab || "chat";
    if (["chat", "hub", "tournaments"].includes(routeTab)) setTab(routeTab as ActiveTab);
  }, [initialTab]);

  useEffect(() => {
    setTabFromRoot();
  }, [setTabFromRoot]);

  useEffect(() => {
    if (bootReady && !bootError) window.__yrBoot?.signal();
  }, [bootReady, bootError]);

  const alert = (message: string) => setPageAlert(message);
  const clearAlert = () => setPageAlert("");

  if (bootError) {
    return (
      <div className="mx-auto max-w-5xl p-5 md:p-8">
        <StatusMessage tone="error" role="alert">{bootError}</StatusMessage>
      </div>
    );
  }

  if (!bootReady) {
    return <div className="mx-auto max-w-5xl p-5 md:p-8"><StatusMessage>Loading your engagement workspace…</StatusMessage></div>;
  }

  if (tab === "tournaments") return null;

  if (tab === "hub") {
    return (
      <div className="space-y-6">
        <PageHeading
          title="Engage"
          description="What is running for this community right now, and where to run more."
          scopeName={siteName}
        />
        {pageAlert && <StatusMessage id="gw-page-alert" tone="error" role="alert">{pageAlert}</StatusMessage>}
        <EngageHub apiClient={deps.api} siteId={siteId} />
      </div>
    );
  }

  const activeLabel = GIVEAWAY_TABS[0][1];
  const description = "Collect chat entries, draw a winner, and confirm the result live.";

  return (
    <div className="space-y-6">
      <PageHeading title="Giveaways" description={`${activeLabel} · ${description}`} />
      <GiveawaysSubnav active={tab} />
      {pageAlert && <StatusMessage id="gw-page-alert" tone="error" role="alert">{pageAlert}</StatusMessage>}
      <ChatGiveaway apiClient={deps.api} siteId={siteId} onAlert={alert} onClearAlert={clearAlert} />
    </div>
  );
}

function PageHeading({ title, description, scopeName }: { title: string; description: string; scopeName?: string }) {
  return (
    <header className="v3-head v3-head--row">
      <div className="v3-head-col">
        <h1>{title}</h1>
        <p className="v3-head-sub">{description}</p>
      </div>
      <div id="engage-scope" className="v3-scope" data-scope="site" aria-label={scopeName ? `Site: ${scopeName}` : "Site"}>
        {scopeName && <span className="v3-scope-name">{scopeName}</span>}
      </div>
    </header>
  );
}

function GiveawaysSubnav({ active }: { active: "chat" }) {
  const hrefs = { chat: "/dashboard/giveaways/chat" };
  return (
    <nav className="v3-tabs gw-subnav" aria-label="Giveaways">
      {GIVEAWAY_TABS.map(([key, label]) => (
        <a
          key={key}
          className={cn("v3-tab", active === key && "is-on")}
          href={hrefs[key as keyof typeof hrefs]}
          aria-current={active === key ? "page" : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function EngageHub({ apiClient, siteId }: { apiClient: PageDependencies["api"]; siteId: string }) {
  const [states, setStates] = useState<Record<string, EngageRowState>>({});
  useEffect(() => {
    let active = true;
    const settle = <T,>(promise: Promise<T>) => promise.catch(() => undefined);
    void Promise.all([
      settle(apiClient("/api/activities?state=open&limit=100", {}, siteId)),
      settle(apiClient<ChatGiveawayPayload>("/api/giveaways/chat", {}, siteId)),
      settle(apiClient("/api/tournaments", {}, siteId)),
    ]).then(([activities, chat, tournaments]) => {
      if (!active) return;
      const next: Record<string, EngageRowState> = {};
      next.activities = activities ? engageCardState("activities", activities) as EngageRowState : HUB_UNAVAILABLE;
      next.giveaways = engageCardState("giveaways", { chat }) as EngageRowState || HUB_UNAVAILABLE;
      next.tournaments = tournaments ? engageCardState("tournaments", tournaments) as EngageRowState : HUB_UNAVAILABLE;
      setStates(next);
    });
    return () => { active = false; };
  }, [apiClient, siteId]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-base">Engage destinations</CardTitle>
        <CardDescription>Live activity across your community.</CardDescription>
      </CardHeader>
      <ul className="divide-y">
        {ENGAGE_FEATURES.map((feature) => {
          const state = states[feature.feature] || {
            tone: "neutral",
            status: "pending",
            label: "Checking…",
            meta: feature.idle.meta,
          };
          const Icon = feature.feature === "activities" || feature.feature === "giveaways" ? Gift : Trophy;
          return (
            <li key={feature.feature} className="engage-row" data-feature={feature.feature} data-status={state.status}>
              <a className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:px-6" href={feature.href}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground" aria-hidden="true">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">{feature.title}</span>
                  <span className="block text-sm text-muted-foreground">{feature.desc}</span>
                </span>
                <span className="hidden text-right sm:block">
                  <Badge
                    className={cn(
                      "mb-1 rounded-full",
                      state.tone === "success" && "border-emerald-700/25 bg-emerald-600/5 text-emerald-800",
                      state.tone === "warning" && "border-amber-700/25 bg-amber-500/10 text-amber-900",
                    )}
                    data-status={state.status}
                    data-tone={state.tone}
                  >
                    {state.label}
                  </Badge>
                  <span className="block max-w-72 text-xs text-muted-foreground" data-status-meta>{state.meta}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ChatGiveaway({
  apiClient,
  siteId,
  onAlert,
  onClearAlert,
}: {
  apiClient: PageDependencies["api"];
  siteId: string;
  onAlert: (message: string) => void;
  onClearAlert: () => void;
}) {
  const [data, setData] = useState<ChatGiveawayPayload>({
    connection: EMPTY_CONNECTION,
    entries: [],
    session: null,
    winner: null,
  });
  const [rules, setRules] = useState<GiveawayRules>(DEFAULT_RULES);
  const [keyword, setKeyword] = useState("!win");
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualError, setManualError] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [savingResponseRules, setSavingResponseRules] = useState(false);
  const [adding, setAdding] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [revealNames, setRevealNames] = useState<string[]>([]);
  const [revealPosition, setRevealPosition] = useState(0);
  const [revealBlur, setRevealBlur] = useState(false);
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [winnerJustDrawn, setWinnerJustDrawn] = useState(false);
  const [winnerAction, setWinnerAction] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [customRule, setCustomRule] = useState("");
  const [responseRemaining, setResponseRemaining] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    try { return window.localStorage.getItem("yr:gw-advanced-open") === "1"; } catch { return false; }
  });
  const manualInputRef = useRef<HTMLInputElement>(null);
  const ruleSessionIdRef = useRef<string | null>(null);
  const autoRerollKeyRef = useRef("");
  const session = data.session || null;
  const entries = data.entries || [];
  const verificationPath = session
    ? `/giveaways/verify?sessionId=${encodeURIComponent(session.id)}`
    : "";
  const verificationUrl = session
    ? new URL(verificationPath, window.location.origin).href
    : "";
  const pendingCount = entries.filter((entry) => entry.eligibility_status === "pending_verification").length;
  const connection = data.connection || EMPTY_CONNECTION;
  const capabilities = data.capabilities || {};
  const winner = data.winner || null;
  const winnerId = winner?.id || null;
  const finalized = Boolean(session?.winner_finalized_at);
  const confirmedDrawCount = data.draws?.filter((draw) => Boolean(draw.confirmed_at)).length || 0;
  const drawCount = confirmedDrawCount + (winner && !finalized ? 1 : 0);
  const active = session?.status === "active";
  const settingsLocked = active || Boolean(session?.winner_entry_id && !session.winner_finalized_at);
  const manualSetup = !connection.connected && !active;
  const manualUi = manualSetup || session?.provider === "manual";
  const eligibleEntries = entries.filter(isEligible);
  const filteredEntries = entries.filter((entry) => entry.username.toLowerCase().includes(search.trim().toLowerCase()));
  const linkedCount = entries.filter((entry) =>
    (entry.linked?.length || 0) > 0 || entry.eligibility_reason === "excluded_linked_account").length;
  const excludePlan = useMemo(() => linkedExcludePlan(entries), [entries]);
  const winnerClaimed = Boolean(session?.winner_confirmed_at);
  const responseRequired = Boolean(session?.winner_response_required ?? session?.rules?.winnerMustRespond);
  const responseTimeout = Number(session?.winner_response_timeout_seconds || session?.rules?.responseTimeout || 60);
  const responseRulesEditable = Boolean(session && session.provider === "kick" && session.status !== "cancelled");
  const claimExpired = responseRequired && !winnerClaimed && responseRemaining <= 0 && Boolean(session?.drawn_at);
  const autoRerollExhausted = Boolean(session?.auto_reroll_exhausted_at) && !finalized && !winnerClaimed;
  const canConfirm = Boolean(winner && !finalized && (!responseRequired || winnerClaimed));

  const refresh = useCallback(async () => {
    try {
      const next = await apiClient<ChatGiveawayPayload>("/api/giveaways/chat", {}, siteId);
      setData((previous) => ({
        ...previous,
        ...next,
        connection: next.connection || previous.connection || EMPTY_CONNECTION,
        entries: next.entries || [],
      }));
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [apiClient, siteId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, CHAT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (session?.id && ruleSessionIdRef.current !== session.id) {
      ruleSessionIdRef.current = session.id;
      setRules({ ...DEFAULT_RULES, ...session.rules });
      setKeyword(session.keyword || "!win");
      return;
    }
    if (!session && ruleSessionIdRef.current) {
      ruleSessionIdRef.current = null;
      setRules(DEFAULT_RULES);
    }
  }, [session?.id]);

  useEffect(() => {
    if (!session?.started_at) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [session?.started_at, session?.stopped_at, session?.status]);

  useEffect(() => {
    if (!session?.drawn_at || !responseRequired || winnerClaimed) {
      setResponseRemaining(0);
      return;
    }
    const deadline = session.winner_response_deadline
      ? Date.parse(session.winner_response_deadline)
      : Date.parse(session.drawn_at) + responseTimeout * 1_000;
    setResponseRemaining(Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - clock) / 1_000)) : 0);
  }, [clock, session?.drawn_at, session?.winner_response_deadline, responseRequired, responseTimeout, winnerClaimed]);

  useEffect(() => {
    const deadline = session?.winner_response_deadline ? Date.parse(session.winner_response_deadline) : Number.NaN;
    if (
      !session?.id
      || !session.drawn_at
      || !session.rules?.autoReroll
      || session.winner_confirmed_at
      || session.winner_finalized_at
      || !Number.isFinite(deadline)
      || deadline > clock
    ) return;
    const key = `${session.id}:${session.drawn_at}`;
    if (autoRerollKeyRef.current === key) return;
    autoRerollKeyRef.current = key;
    void (async () => {
      try {
        const response = await apiClient<ChatGiveawayPayload>("/api/giveaways/chat/draw", post({
          sessionId: session.id,
          siteId: siteId || undefined,
          automatic: true,
          expectedWinnerEntryId: session.winner_entry_id,
          expectedDrawnAt: session.drawn_at,
        }), siteId);
        applyState(response);
      } catch (error) {
        const payload = errorData(error);
        if (payload.session) applyState(payload);
        if (payload.error) onAlert(payload.error);
        else onAlert("Network error during auto re-roll.");
      }
    })();
  }, [apiClient, clock, onAlert, session, siteId]);

  useEffect(() => {
    if (winnerJustDrawn && winnerId && !finalized) {
      const timer = window.setTimeout(() => setWinnerOpen(true), 950);
      return () => window.clearTimeout(timer);
    }
  }, [winnerJustDrawn, winnerId, session?.drawn_at, finalized]);

  useEffect(() => {
    if (!winnerJustDrawn || !winnerId) return;
    const stage = document.getElementById("gw-winner-stage");
    if (!stage) return;
    if (typeof stage.scrollIntoView === "function") {
      stage.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    const animation = typeof stage.animate === "function"
      ? stage.animate(
        [{ opacity: 0, transform: "scale(.9)" }, { opacity: 1, transform: "scale(1)" }],
        { duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      )
      : null;
    if (animation) void animation.finished.catch(() => undefined);
    return () => animation?.cancel();
  }, [winnerJustDrawn, winnerId, session?.drawn_at]);

  const applyState = (next: ChatGiveawayPayload) => {
    setData((previous) => ({
      ...previous,
      ...next,
      connection: next.connection || previous.connection || EMPTY_CONNECTION,
      entries: next.entries || previous.entries || [],
    }));
  };

  const chatApi = (path: string, body?: object) =>
    apiClient<ChatGiveawayPayload>(`/api/giveaways/chat${path}`, body ? post(body) : {}, siteId);

  const updateRule = (key: keyof GiveawayRules, value: string | boolean | number) => {
    setRules((previous) => {
      const next = { ...previous, [key]: value };
      if (key === "entryMode" && value !== "verified") {
        next.onePerIp = false;
        next.vpnDetection = false;
      }
      if (key === "winnerMustRespond" && value === false) next.autoReroll = false;
      return next;
    });
  };

  const saveResponseRules = async (nextRules = rules) => {
    if (!responseRulesEditable || !session || savingResponseRules) return;
    setSavingResponseRules(true);
    try {
      const response = await chatApi("/response-rules", {
        sessionId: session.id,
        winnerMustRespond: Boolean(nextRules.winnerMustRespond),
        responseTimeout: Number(nextRules.responseTimeout || 60),
        autoReroll: Boolean(nextRules.autoReroll),
        siteId: siteId || undefined,
      });
      applyState(response);
    } catch (error) {
      const payload = errorData(error);
      if (payload.session) applyState(payload);
      const persistedRules = payload.session?.rules || session.rules;
      setRules((current) => ({
        ...current,
        winnerMustRespond: Boolean(persistedRules?.winnerMustRespond),
        responseTimeout: Number(persistedRules?.responseTimeout || 60),
        autoReroll: Boolean(persistedRules?.autoReroll),
      }));
      onAlert(errorMessage(error, "Could not save winner response rules."));
    } finally {
      setSavingResponseRules(false);
    }
  };

  const setRule = (key: keyof GiveawayRules, value: string | boolean | number) => {
    updateRule(key, value);
    if (responseRulesEditable && ["winnerMustRespond", "responseTimeout", "autoReroll"].includes(key)) {
      const next = { ...rules, [key]: value } as GiveawayRules;
      if (key === "winnerMustRespond" && value === false) next.autoReroll = false;
      void saveResponseRules(next);
    }
  };

  const toggleGiveaway = async (event: FormEvent) => {
    event.preventDefault();
    onClearAlert();
    if (active) {
      setStarting(true);
      try {
        applyState(await chatApi("/stop", { sessionId: session?.id, siteId: siteId || undefined }));
      } catch (error) {
        onAlert(errorMessage(error, "Network error stopping entries."));
      } finally {
        setStarting(false);
      }
      return;
    }
    const trimmedKeyword = keyword.trim();
    if (!manualSetup && !trimmedKeyword) {
      onAlert("Enter the keyword viewers should type.");
      return;
    }
    if (!manualSetup && !connection.connected) {
      onAlert("Chat giveaways require a connected Kick channel.");
      return;
    }
    const nextRules = {
      ...rules,
      entryMode: manualSetup ? "chat" : rules.entryMode || "chat",
      subscriberOnly: manualSetup ? false : Boolean(rules.subscriberOnly),
      vipOnly: manualSetup ? false : Boolean(rules.vipOnly),
      onePerIp: manualSetup ? false : Boolean(rules.onePerIp),
      vpnDetection: manualSetup ? false : Boolean(rules.vpnDetection),
      winnerMustRespond: manualSetup ? false : Boolean(rules.winnerMustRespond),
      autoReroll: manualSetup ? false : Boolean(rules.autoReroll),
    };
    setStarting(true);
    try {
      const body = manualSetup
        ? { mode: "manual", rules: nextRules, siteId: siteId || undefined }
        : { keyword: trimmedKeyword, rules: nextRules, siteId: siteId || undefined };
      applyState(await chatApi("/start", body));
    } catch (error) {
      onAlert(errorMessage(error, "Network error starting the giveaway."));
    } finally {
      setStarting(false);
    }
  };

  const addEntrant = async (event: FormEvent) => {
    event.preventDefault();
    onClearAlert();
    setManualError("");
    if (!active || !session) {
      const message = "Start a giveaway before adding entrants.";
      onAlert(message);
      setManualError(message);
      return;
    }
    setAdding(true);
    try {
      applyState(await chatApi("/entries/add", {
        sessionId: session.id,
        username: manualName,
        siteId: siteId || undefined,
      }));
      setManualName("");
      manualInputRef.current?.focus();
    } catch (error) {
      const message = errorMessage(error, "Network error adding entrant.");
      onAlert(message);
      setManualError(message);
    } finally {
      setAdding(false);
    }
  };

  const mutateEntry = async (path: string, body: object, fallback: string) => {
    if (!session) return;
    onClearAlert();
    try {
      const result = await chatApi(path, { ...body, sessionId: session.id, siteId: siteId || undefined });
      applyState(result);
      if (path === "/entries/exclude") {
        const count = Array.isArray(result.excluded) ? result.excluded.length : 0;
        onAlert(`Excluded ${count} linked entrant${count === 1 ? "" : "s"}. Use Include again to undo.`);
      }
    } catch (error) {
      onAlert(errorMessage(error, fallback));
    }
  };

  const drawWinner = async () => {
    if (!session || isRolling) return;
    onClearAlert();
    setIsRolling(true);
    setWinnerJustDrawn(false);
    try {
      const result = await chatApi("/draw", {
        sessionId: session.id,
        expectedWinnerEntryId: session.winner_entry_id ?? null,
        expectedDrawnAt: session.drawn_at ?? null,
        next: finalized,
        siteId: siteId || undefined,
      });
      if (!result.winner) {
        applyState(result);
        onAlert(result.message || "Could not draw a winner.");
        return;
      }
      const drawnUsernames = new Set(
        (data.draws || []).map((draw) => draw.username?.trim().toLowerCase()).filter(Boolean),
      );
      const visualPool = eligibleEntries.filter((entry) =>
        session.rules?.winnerRepeat === "again"
          || (!drawnUsernames.has(entry.username.trim().toLowerCase()) && entry.id !== session.winner_entry_id),
      );
      await runWinnerReveal(visualPool, result.winner);
      applyState(result);
      setClock(Date.now());
      setWinnerJustDrawn(true);
      playWinnerSound();
    } catch (error) {
      const payload = errorData(error);
      if (payload.session) applyState(payload);
      onAlert(errorMessage(error, "Network error drawing a winner."));
    } finally {
      setIsRolling(false);
    }
  };

  const runWinnerReveal = async (pool: GiveawayEntrant[], drawnWinner: GiveawayWinner) => {
    const names = [...new Set(pool.map((entry) => entry.username))];
    if (!names.includes(drawnWinner.username)) names.push(drawnWinner.username);
    const pick = () => names[Math.floor(Math.random() * names.length)];
    const sequence: string[] = [];
    let previous: string | null = null;
    for (let index = 0; index < 22; index += 1) {
      let name = pick();
      while (names.length > 1 && name === previous) name = pick();
      sequence.push(name);
      previous = name;
    }
    let decoy = pick();
    while (names.length > 1 && decoy === drawnWinner.username) decoy = pick();
    sequence.push(decoy, drawnWinner.username);
    setRevealNames(sequence);
    setRevealPosition(0);
    setRevealBlur(false);

    const winnerIndex = sequence.length - 1;
    const decoyIndex = winnerIndex - 1;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setRevealPosition(winnerIndex);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      return;
    }

    const animate = (from: number, to: number, duration: number, easing: (progress: number) => number) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        let lastTime = start;
        let lastProgress = from;
        const step = (time: number) => {
          const progress = Math.min(1, (time - start) / duration);
          const position = from + (to - from) * easing(progress);
          const velocity = Math.abs(position - lastProgress) / Math.max(1, time - lastTime) * 1_000;
          setRevealBlur(velocity > 6);
          setRevealPosition(position);
          lastTime = time;
          lastProgress = position;
          if (progress < 1) window.requestAnimationFrame(step);
          else {
            setRevealBlur(false);
            resolve();
          }
        };
        window.requestAnimationFrame(step);
      });

    await animate(0, decoyIndex, 2_600, (progress) => 1 - Math.pow(1 - progress, 5));
    await new Promise((resolve) => window.setTimeout(resolve, 380));
    await animate(decoyIndex, winnerIndex, 620, (progress) => 1 - Math.pow(1 - progress, 3));
    await new Promise((resolve) => window.setTimeout(resolve, 260));
  };

  const confirmWinner = async () => {
    if (!winner || !session || finalized || (responseRequired && !winnerClaimed)) return;
    onClearAlert();
    setWinnerAction("confirming");
    try {
      applyState(await chatApi("/finalize", {
        sessionId: session.id,
        winnerEntryId: session.winner_entry_id,
        drawnAt: session.drawn_at,
        siteId: siteId || undefined,
      }));
      setWinnerOpen(false);
    } catch (error) {
      const payload = errorData(error);
      if (payload.session) applyState(payload);
      else if (errorStatus(error) === 409) void refresh();
      onAlert(errorMessage(error, "Network error confirming the winner."));
    } finally {
      setWinnerAction("");
    }
  };

  const rerollWinner = async () => {
    if (!session) return;
    setWinnerAction("rerolling");
    setWinnerOpen(false);
    await drawWinner();
    setWinnerAction("");
  };

  const exportCsv = () => {
    const sanitize = (value: string | null | undefined) => {
      const clean = String(value || "").replace(/"/g, '""');
      return /^[=+\-@]/.test(clean) ? `'${clean}` : clean;
    };
    const rows = [
      ["Index", "Kick Username", "Status", "Chat Message", "Entered At", "Profile URL"],
      ...entries.map((entry, index) => [
        String(index + 1),
        sanitize(entry.username),
        sanitize(entry.eligibility_status || "eligible"),
        sanitize(entry.provider === "manual" ? "—" : entry.message),
        sanitize(entry.entered_at),
        sanitize(safeKickProfileUrl(entry.username)),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `kick-giveaway-entrants-${connection.channelName || "stream"}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyWinner = async () => {
    if (!winner) return;
    const text = `Winner: ${winner.username}`;
    try {
      await navigator.clipboard.writeText(text);
      onAlert("Winner info copied.");
    } catch {
      onAlert("Could not copy winner info.");
    }
  };

  const copyVerificationLink = async () => {
    try {
      await navigator.clipboard.writeText(verificationUrl);
      onAlert("Verification link copied.");
    } catch {
      onAlert("Could not copy the verification link.");
    }
  };

  const clearEntries = async () => {
    if (!session) return;
    setConfirmation(null);
    onClearAlert();
    try {
      applyState(await chatApi("/entries/clear", {
        sessionId: session.id,
        siteId: siteId || undefined,
      }));
    } catch (error) {
      onAlert(errorMessage(error, "Could not clear participants."));
    }
  };

  const updateAdvancedOpen = (open: boolean) => {
    setAdvancedOpen(open);
    try { window.localStorage.setItem("yr:gw-advanced-open", open ? "1" : "0"); } catch { /* storage unavailable */ }
  };

  const statusLabel = active
    ? "LIVE"
    : !connection.connected
      ? "Kick not connected"
      : !connection.chatReady
        ? "Chat events unavailable"
        : session?.status === "stopped"
          ? "Entries closed"
          : session?.status === "completed"
            ? "Winner drawn"
            : loading
              ? "Checking…"
              : "Ready";

  return (
    <div className="space-y-6">
      <div className="grid gap-6 min-[961px]:grid-cols-2 min-[1280px]:grid-cols-[minmax(17rem,0.9fr)_minmax(0,1.4fr)_minmax(17rem,1fr)]">
        <div className={cn("min-w-0 space-y-6 min-[961px]:max-[1279px]:row-span-2", active ? "max-[960px]:order-3" : "max-[960px]:order-1")}>
          <Card id="gw-setup-card">
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <CardTitle className="text-lg">Settings</CardTitle>
              <Badge className={cn("shrink-0 rounded-full", active ? "border-emerald-700/25 bg-emerald-600/10 text-emerald-800" : "")} aria-live="polite">
                <span className={cn("mr-1.5 size-1.5 rounded-full bg-muted-foreground", active && "bg-emerald-600")} />
                {statusLabel}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {connection.connected ? (
                <div id="gw-channel-connected" className="space-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Kick: <strong id="gw-channel-name">{connection.channelName || ""}</strong></span>
                    <Badge className="border-emerald-700/25 bg-emerald-600/5 text-emerald-800">✓ Connected</Badge>
                  </div>
                  {connection.chatReady === false && (
                    <p id="gw-chat-events-notice" className="mt-2 text-xs text-amber-800">
                      Kick did not confirm chat events for this channel yet. Reconnect Kick in Connections to enable Chat giveaways.
                    </p>
                  )}
                </div>
              ) : (
                <div id="gw-channel-disconnected" className="rounded-lg border border-amber-700/20 bg-amber-500/5 p-3">
                  <p className="text-sm font-medium">Chat giveaways require a connected Kick channel.</p>
                  <a className="mt-3 inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline" id="gw-btn-connect-kick" href="/dashboard/settings/connections">Connect Kick</a>
                  {manualSetup && <p id="gw-manual-start-hint" className="mt-3 text-sm text-muted-foreground">Or run it manually — add viewer names yourself.</p>}
                </div>
              )}
              <form id="gw-setup-form" className="space-y-4" onSubmit={toggleGiveaway}>
                {!manualSetup && session?.provider !== "manual" && (
                  <div id="gw-keyword-field" className="space-y-2">
                    <Label htmlFor="gw-keyword-input">Keyword</Label>
                    <Input
                      id="gw-keyword-input"
                      name="keyword"
                      value={keyword}
                      maxLength={64}
                      placeholder="e.g. !win, !enter, YOURRANK"
                      readOnly={settingsLocked}
                      onChange={(event) => setKeyword(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Viewers who type this word in chat are entered once each. Matching ignores upper/lowercase.</p>
                  </div>
                )}
              </form>
              <fieldset id="gw-settings" disabled={settingsLocked} className="mx-0 min-w-0 border-0 p-0">
                <fieldset id="gw-entry-modes" disabled={settingsLocked} hidden={manualUi} className="mx-0 min-w-0 border-0 p-0 space-y-2">
                  <legend id="gw-entry-mode-legend" hidden={manualUi} className="mb-2 text-sm font-semibold">Entry mode</legend>
                  {(["chat", "members", "verified"] as const).map((mode) => (
                    <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="gw-entry-mode"
                        value={mode}
                        checked={(rules.entryMode || "chat") === mode}
                        disabled={settingsLocked}
                        onChange={(event) => setRule("entryMode", event.target.value)}
                      />
                      <span>{mode === "chat" ? "Anyone in chat" : mode === "members" ? "Members only" : "Verified Entry"}</span>
                    </label>
                  ))}
                  <p id="gw-entry-mode-desc" hidden={manualUi} className="text-xs text-muted-foreground" aria-live="polite">
                    {rules.entryMode === "members"
                      ? "Requires a YourRank account linked to the Kick account used in chat."
                      : rules.entryMode === "verified"
                        ? "Viewers type the keyword, then verify through YourRank before entering the draw."
                        : "Anyone who types the keyword can participate."}
                  </p>
                </fieldset>
              </fieldset>
              {session?.rules?.entryMode === "verified" && (session.status === "active" || session.status === "stopped") && (
                <section id="gw-verification-share" aria-labelledby="gw-verification-share-title" className="space-y-2">
                  <Label id="gw-verification-share-title" htmlFor="gw-verification-url">Verification link</Label>
                  <div className="flex items-center gap-2">
                    <Input id="gw-verification-url" readOnly aria-label="Verification link" value={verificationUrl} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" />
                    <Button id="gw-btn-copy-verification" type="button" size="icon" variant="outline" aria-label="Copy verification link" title="Copy link" onClick={() => void copyVerificationLink()}>
                      <Copy aria-hidden="true" />
                    </Button>
                  </div>
                </section>
              )}
              <fieldset id="gw-winner-repeat-modes" disabled={settingsLocked} className="mx-0 min-w-0 border-0 p-0">
                <RuleCheckbox id="gw-opt-winner-repeat" label="Same person can win again" checked={rules.winnerRepeat === "again"} disabled={settingsLocked} onChange={(value) => setRule("winnerRepeat", value ? "again" : "once")} />
              </fieldset>
              <fieldset id="gw-response-settings" className="mx-0 min-w-0 border-0 p-0 space-y-4">
                <div id="gw-winner-verification-section" hidden={manualUi} className="space-y-3">
                  <RuleCheckbox id="gw-opt-claim-req" label="Winner must respond in chat" checked={Boolean(rules.winnerMustRespond)} disabled={savingResponseRules} onChange={(value) => setRule("winnerMustRespond", value)} />
                  <div id="gw-claim-duration-wrap" className="space-y-2" hidden={!rules.winnerMustRespond}>
                    <Label htmlFor="gw-opt-claim-duration">Response timeout</Label>
                    <Select value={String(rules.responseTimeout || 60)} onValueChange={(value) => setRule("responseTimeout", Number(value))}>
                      <SelectTrigger id="gw-opt-claim-duration" disabled={savingResponseRules || !rules.winnerMustRespond}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[30, 60, 90, 120].map((seconds) => <SelectItem key={seconds} value={String(seconds)}>{seconds} seconds</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div id="gw-auto-reroll-wrap" hidden={!rules.winnerMustRespond}>
                    <RuleCheckbox id="gw-opt-auto-reroll" label="Auto re-roll on timeout" checked={Boolean(rules.autoReroll)} disabled={savingResponseRules || !rules.winnerMustRespond} onChange={(value) => setRule("autoReroll", value)} />
                    <p className="ml-6 text-xs text-muted-foreground">Runs at expiry, or within 5 minutes if this page is closed.</p>
                  </div>
                </div>
              </fieldset>
              {responseRulesEditable && <p id="gw-response-live-note" className="text-xs text-muted-foreground">Changes apply to the next draw or re-roll.</p>}
              {manualUi && <p id="gw-manual-rules-note" className="text-xs text-muted-foreground">Other rules need a connected Kick channel.</p>}
              {settingsLocked && <p id="gw-settings-note" className="text-xs text-muted-foreground">Entry rules are locked for the current giveaway. Winner verification can still change until you confirm a winner.</p>}
              <Button
                id="gw-btn-listen"
                type="submit"
                form="gw-setup-form"
                disabled={starting || (!active && !(connection.connected && connection.chatReady) && !manualSetup)}
                variant={active ? "destructive" : "default"}
                className="w-full"
              >
                {starting && <Loader2 className="animate-spin" />}
                <span id="gw-listen-btn-label">{active ? "Stop entries" : manualSetup ? "Start manual giveaway" : "Start giveaway"}</span>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className={cn(
          "min-w-0",
          "max-[960px]:order-2",
          "min-[961px]:max-[1279px]:col-start-2 min-[961px]:max-[1279px]:row-start-2",
        )}>
          <Card id="gw-entrants-card">
            <CardHeader className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-lg">Participants (<span id="gw-count-header">{entries.length.toLocaleString()}</span>)</CardTitle>
                {pendingCount > 0 && <p id="gw-verification-pending" className="text-xs text-muted-foreground" role="status">{pendingCount} waiting for verification</p>}
              </div>
              <div className="flex w-full items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input aria-label="Search participants" id="gw-search-entrants" className="w-full pl-9" placeholder="Search participant…" value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
                <Button id="gw-btn-clear" type="button" variant="outline" size="icon" aria-label="Clear list" title="Clear list" disabled={!entries.length || !session || isRolling || Boolean(winner && !finalized)} onClick={() => setConfirmation({
                  title: "Clear all participants?",
                  description: "Everyone will need to type the keyword again. Winners stay in the Winners list.",
                  action: "Clear list",
                  destructive: true,
                })}>
                  <Trash2 aria-hidden="true" />
                </Button>
                <Button id="gw-btn-export" type="button" variant="outline" size="icon" aria-label="Export CSV" title="Export CSV" disabled={!entries.length} onClick={exportCsv}>
                  <Download aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {linkedCount > 0 && (
                <div id="gw-linked-banner" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-700/20 bg-amber-500/5 px-4 py-3 text-sm" role="status">
                  <span id="gw-linked-banner-text">{linkedCount} entrant{linkedCount === 1 ? " is" : "s are"} linked to another entrant.</span>
                  {excludePlan.length > 0 && <Button id="gw-linked-exclude-all" size="sm" variant="outline" onClick={() => void mutateEntry("/entries/exclude", { entryIds: excludePlan.map((entry) => entry.id) }, "Could not exclude linked entrants.")}>Exclude linked duplicates ({excludePlan.length})</Button>}
                </div>
              )}
              {active && (
                <form id="gw-add-entrant-form" className="space-y-2" onSubmit={(event) => void addEntrant(event)}>
                  <div className="flex items-center gap-2">
                    <Label className="sr-only" htmlFor="gw-add-entrant-name">Add viewer name</Label>
                    <Input ref={manualInputRef} id="gw-add-entrant-name" name="username" type="text" maxLength={40} autoComplete="off" required value={manualName} onChange={(event) => setManualName(event.target.value)} className="min-w-0 flex-1" placeholder="Add viewer name…" />
                    <Button size="sm" type="submit" disabled={adding}>{adding ? <Loader2 className="animate-spin" /> : null}Add</Button>
                  </div>
                  {manualError && <p id="gw-add-entrant-error" className="text-sm text-destructive" role="alert" aria-live="assertive">{manualError}</p>}
                </form>
              )}
              <div className="h-[28rem] overflow-y-auto rounded-lg border">
                {entries.length === 0 ? (
                  <div id="gw-entrants-empty" className="flex min-h-full flex-col items-center justify-center px-5 py-8 text-center" role="status">
                    <p className="font-semibold">No entrants yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">Start a giveaway, then add viewer names or collect entries from Kick chat.</p>
                  </div>
                ) : filteredEntries.length === 0 ? (
                  <div id="gw-entrants-no-match" className="flex min-h-full flex-col items-center justify-center gap-3 px-5 py-8 text-center" role="status">
                    <div><strong id="gw-entrants-no-match-text">No entrants match "{search.trim()}"</strong><p className="mt-1 text-sm text-muted-foreground">Clear the search to see all entrants.</p></div>
                    <Button id="gw-btn-clear-search" variant="outline" size="sm" onClick={() => setSearch("")}>Clear search</Button>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3">Viewer</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3 text-right"><span className="sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody id="gw-entrants-list" className="divide-y">
                      {filteredEntries.map((entrant) => (
                        <EntrantRow
                          key={entrant.id}
                          entrant={entrant}
                          verifiedMode={session?.rules?.entryMode === "verified"}
                          onInclude={() => void mutateEntry("/entries/include", { entryId: entrant.id }, "Could not include the entrant again.")}
                          onExclude={() => void mutateEntry("/entries/exclude", { entryIds: [entrant.id] }, "Could not exclude linked entrants.")}
                          onRemove={() => void mutateEntry("/entries/remove", { entryId: entrant.id }, "Could not remove entrant.")}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <Button id="gw-btn-roll" type="button" className="mt-3 w-full" hidden={Boolean(winner && !isRolling && !finalized)} disabled={!entries.length || !session || isRolling} onClick={() => void drawWinner()}>
                {isRolling ? "Drawing…" : finalized ? "Draw next winner" : "Draw winner"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div
          className={cn(
            "min-w-0",
            active ? "is-live max-[960px]:order-1" : "max-[960px]:order-3",
            "min-[961px]:max-[1279px]:col-start-2 min-[961px]:max-[1279px]:row-start-1",
          )}
          id="gw-layout"
        >
          <Card id="gw-stage-card">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle className="text-lg">Winners ({drawCount})</CardTitle>
              {drawCount > 1 && <span className="text-xs text-muted-foreground">Newest first</span>}
            </CardHeader>
            <CardContent className="p-4">
              <div className="h-[28rem] overflow-y-auto rounded-lg border">
                <div className="min-h-full space-y-3 p-3">
                  {isRolling && (
                    <div id="gw-winner-reveal" className="space-y-3 rounded-xl border bg-muted/30 p-5 text-center" role="status" aria-live="polite">
                      {revealNames.length ? (
                        <div className="relative mx-auto h-[92px] max-w-md overflow-hidden rounded-lg border bg-card">
                          <div
                            id="gw-roller-track"
                            aria-hidden="true"
                            className={cn("will-change-transform", revealBlur && "blur-[1px]")}
                            style={{ transform: `translateY(${(1 - revealPosition) * 46}px)` }}
                          >
                            {revealNames.map((name, index) => (
                              <div key={`${index}-${name}`} className="gw-winner-reveal-item flex h-[46px] items-center justify-center font-semibold">
                                @{name}
                              </div>
                            ))}
                          </div>
                          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t-2 border-primary/60" aria-hidden="true" />
                        </div>
                      ) : <Loader2 className="mx-auto size-7 animate-spin text-primary" aria-hidden="true" />}
                      <p className="font-semibold">Drawing winner…</p>
                    </div>
                  )}
                  {winner && !isRolling && (
                    <div id="gw-winner-stage" role="status" aria-live="polite" className={cn("gw-winner-stage relative overflow-hidden rounded-lg border bg-primary/5 p-3", finalized && "gw-winner-stage--confirmed")}>
                      {winnerJustDrawn && <WinnerConfetti key={session?.drawn_at || winner.id} />}
                      <div className="flex items-center gap-3">
                        <img className="size-10 shrink-0 rounded-full border object-cover" src={safeAvatarUrl(winner.avatar_url)} alt="Winner avatar" />
                        <div className="min-w-0 flex-1">
                          <h3 id="gw-winner-name" className="truncate font-semibold">{winner.username}</h3>
                          {winner.message && <p id="gw-winner-message" className="mt-0.5 text-xs text-muted-foreground">{winner.message}</p>}
                        </div>
                      </div>
                      {customRule.trim() && <p id="gw-winner-instruction" className="mt-3 text-sm text-muted-foreground">{customRule.trim()}</p>}
                      {winner.provider === "manual" && session?.rules?.winnerMustRespond && (
                        <p id="gw-winner-manual-hint" className="mt-3 text-sm text-muted-foreground">This entrant was added manually; no chat response needed.</p>
                      )}
                      {responseRequired && (
                        <ClaimStatus
                          remaining={responseRemaining}
                          claimed={winnerClaimed}
                          message={session?.winner_confirmation_message}
                          timeout={responseTimeout}
                          exhausted={autoRerollExhausted}
                          winnerName={winner.username}
                        />
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button id="gw-btn-confirm" type="button" size="sm" disabled={!canConfirm || winnerAction === "confirming"} title={responseRequired && !winnerClaimed ? claimExpired ? "The winner did not respond — re-roll to pick another winner" : "Waiting for the winner to respond in chat" : undefined} onClick={() => void confirmWinner()}>
                          <Check /> {finalized ? "Winner confirmed" : "Confirm Winner"}
                        </Button>
                        <Button id="gw-btn-reroll" type="button" variant={claimExpired ? "default" : "outline"} size="sm" disabled={Boolean(winnerAction) || finalized} onClick={() => void rerollWinner()}>
                          <RefreshCw /> Re-roll
                        </Button>
                        <Button id="gw-btn-copy-winner" type="button" variant="outline" size="icon" aria-label="Copy winner info" title="Copy info" onClick={() => void copyWinner()}>
                          <Copy aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <DrawHistory
                    draws={data.draws || []}
                    currentWinner={Boolean(winner)}
                    autoRerollExhausted={autoRerollExhausted}
                    winnerName={winner?.username || "the winner"}
                    exhaustedAt={session?.auto_reroll_exhausted_at}
                  />
                  {!winner && !isRolling && !data.draws?.length && (
                    <div id="gw-stage-idle" className="flex min-h-full flex-col items-center justify-center px-5 py-10 text-center">
                      <h3 className="font-semibold">No winners yet</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Draw a winner from the participants list.</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

        </div>

        <Card id="gw-advanced-card" className="col-span-full max-[960px]:order-4">
          <CardContent className="pt-6">
            <fieldset id="gw-advanced-settings" disabled={settingsLocked} className="mx-0 min-w-0 border-0 p-0 space-y-4">
              <details id="gw-advanced-options" open={advancedOpen} onToggle={(event) => updateAdvancedOpen(event.currentTarget.open)} className="rounded-lg">
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-base font-semibold">
                  <span>Advanced options</span>
                  <span id="gw-advanced-summary" className="text-xs font-normal text-muted-foreground">{formatAdvancedSummary(rules)}</span>
                </summary>
                <div className="mt-4 grid gap-6 md:grid-cols-3">
                  <fieldset id="gw-advanced-eligibility-section" disabled={settingsLocked} hidden={manualUi} className="mx-0 min-w-0 border-0 p-0 space-y-3">
                    <h3 id="gw-advanced-eligibility-title" className="text-sm font-semibold">Eligibility</h3>
                    <fieldset id="gw-kick-eligibility-section" hidden={manualUi} className="mx-0 min-w-0 border-0 p-0">
                      <legend id="gw-eligibility-title" className="sr-only">Eligibility</legend>
                      <label id="gw-kick-identity-rule" className="flex items-center gap-2 text-sm">
                        <Checkbox checked disabled aria-label="One entry per Kick account" />
                        <span>
                          <strong>One entry per Kick account</strong>
                          <small className="mt-1 block text-muted-foreground">Always enforced by Kick account ID.</small>
                        </span>
                      </label>
                    </fieldset>
                    <div id="gw-subscriber-rule" hidden={manualUi}>
                      <RuleCheckbox id="gw-opt-subscriber" label="Subscriber only" checked={Boolean(rules.subscriberOnly)} onChange={(value) => setRule("subscriberOnly", value)} />
                    </div>
                    <div id="gw-vip-rule" hidden={manualUi}>
                      <RuleCheckbox id="gw-opt-vip" label="VIP only" checked={Boolean(rules.vipOnly)} onChange={(value) => setRule("vipOnly", value)} />
                    </div>
                    <RuleCheckbox id="gw-opt-skip-past" label="Exclude past giveaway winners" checked={Boolean(rules.excludePreviousWinners)} onChange={(value) => setRule("excludePreviousWinners", value)} />
                    <p className="text-xs text-muted-foreground">Skips winners from this community’s earlier giveaways.</p>
                    <p id="gw-subscriber-hint" hidden={manualUi} className="text-xs text-muted-foreground">Checked against chat badges. Both on requires both badges.</p>
                    <p id="gw-kick-history-hint" hidden={manualUi} className="text-xs text-muted-foreground">Account age and follow duration need Kick data that isn’t connected.</p>
                  </fieldset>
                  <fieldset id="gw-anti-abuse-section" disabled={settingsLocked} hidden={manualUi} className="mx-0 min-w-0 border-0 p-0 space-y-3">
                    <h3 id="gw-abuse-title" className="text-sm font-semibold">Anti-abuse</h3>
                    {rules.entryMode === "verified" ? (
                      <>
                        <RuleCheckbox id="gw-opt-ip" label="One account per IP" checked={Boolean(rules.onePerIp)} onChange={(value) => setRule("onePerIp", value)} />
                        <p id="gw-ip-requirement" className="text-xs text-muted-foreground">Shared connections may exclude people living together.</p>
                        {capabilities.vpnDetection === true && (
                          <>
                            <RuleCheckbox id="gw-opt-vpn" label="VPN / Proxy detection" checked={Boolean(rules.vpnDetection)} onChange={(value) => setRule("vpnDetection", value)} />
                            <p id="gw-vpn-requirement" className="text-xs text-muted-foreground">Blocks VPN, proxy, Tor and hosting networks.</p>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">Chat entries: one entry per Kick account.</p>
                        <p id="gw-verified-upsell" className="text-xs text-muted-foreground">
                          {capabilities.vpnDetection === true
                            ? "Turn on Verified Entry to add IP and VPN checks."
                            : "Turn on Verified Entry to add IP checks."}
                        </p>
                      </>
                    )}
                    <Button
                      id="gw-enable-verified"
                      type="button"
                      variant="link"
                      hidden={rules.entryMode === "verified" || settingsLocked}
                      onClick={() => setRule("entryMode", "verified")}
                    >
                      Enable Verified Entry
                    </Button>
                  </fieldset>
                  <div id="gw-winner-instruction-section" hidden={manualUi} className="space-y-2">
                    <h3 id="gw-winner-instruction-title" className="text-sm font-semibold">Winner instruction</h3>
                    <Label htmlFor="gw-custom-rule-text">Winner instruction (optional)</Label>
                    <Input id="gw-custom-rule-text" maxLength={160} placeholder="e.g. Say your in-game name in chat" value={customRule} onChange={(event) => setCustomRule(event.target.value)} />
                    <p className="text-xs text-muted-foreground">A display instruction on this page; not an eligibility check.</p>
                  </div>
                </div>
              </details>
            </fieldset>
          </CardContent>
        </Card>
      </div>

      <Dialog open={winnerOpen && Boolean(winner)} onOpenChange={(open) => { if (!open) setWinnerOpen(false); }}>
        <DialogContent id="gw-winner-modal" className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader className="text-center">
            <Crown className="mx-auto size-8 text-amber-500" aria-hidden="true" />
            <DialogTitle id="gw-modal-title">Winner Drawn</DialogTitle>
            <DialogDescription>The giveaway has finished. Verify the winner below.</DialogDescription>
          </DialogHeader>
          {winner && (
            <div className="space-y-5 text-center">
              <img id="gw-modal-avatar" className="mx-auto size-16 rounded-full border object-cover" src={safeAvatarUrl(winner.avatar_url)} alt="Winner avatar" />
              <h3 id="gw-modal-name" className="text-xl font-bold">{winner.username}</h3>
              <p id="gw-modal-msg" className="text-sm text-muted-foreground">{winner.message || ""}</p>
              {customRule && <p className="text-sm text-muted-foreground">Requirement: {customRule}</p>}
              <div className="flex justify-center gap-2">
                <Badge id="gw-modal-trust-badge">{winner.provider === "manual" ? "Added manually" : "Viewer"}</Badge>
                {winnerClaimed && <Badge id="gw-modal-verify-chip">Confirmed active</Badge>}
              </div>
              {responseRequired && (
                <ClaimStatus
                  remaining={responseRemaining}
                  claimed={winnerClaimed}
                  message={session?.winner_confirmation_message}
                  timeout={responseTimeout}
                  exhausted={autoRerollExhausted}
                  winnerName={winner.username}
                  modal
                />
              )}
              <WinnerChatLog
                winner={winner}
                confirmationMessage={winnerClaimed ? session?.winner_confirmation_message : null}
                confirmedAt={session?.winner_confirmed_at}
              />
              <div className="flex flex-wrap justify-center gap-2">
                <Button id="gw-modal-reroll" variant={claimExpired ? "default" : "outline"} disabled={Boolean(winnerAction) || finalized} onClick={() => void rerollWinner()}><RefreshCw /> Re-roll Winner</Button>
                <Button id="gw-modal-copy" variant="outline" onClick={() => void copyWinner()}>Copy Winner Info</Button>
                <Button id="gw-modal-confirm" disabled={!canConfirm || winnerAction === "confirming"} title={responseRequired && !winnerClaimed ? claimExpired ? "The winner did not respond — re-roll to pick another winner" : "Waiting for the winner to respond in chat" : undefined} onClick={() => void confirmWinner()}>
                  {winnerAction === "confirming" ? <Loader2 className="animate-spin" /> : <Check />}
                  Confirm Winner
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmAction confirmation={confirmation} onCancel={() => setConfirmation(null)} onConfirm={() => void clearEntries()} />
    </div>
  );
}

function RuleCheckbox({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", disabled && "cursor-not-allowed opacity-50")}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />
      {label}
    </label>
  );
}

function ClaimStatus({
  remaining,
  claimed,
  message,
  timeout,
  exhausted = false,
  winnerName,
  modal = false,
}: {
  remaining: number;
  claimed: boolean;
  message?: string | null;
  timeout: number;
  exhausted?: boolean;
  winnerName?: string;
  modal?: boolean;
}) {
  const [box, status, countdown] = modal
    ? ["gw-modal-claim-box", "gw-modal-claim-status", "gw-modal-claim-countdown"]
    : ["gw-claim-box", "gw-claim-status", "gw-claim-countdown"];
  const text = claimed ? (message || "Responded in chat") : remaining > 0 ? "Waiting for winner response…" : "Winner did not respond";
  return (
    <div id={box} className="mt-5 rounded-lg border bg-muted/30 p-4 text-left" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <strong id={status} className={cn("text-sm", claimed ? "text-emerald-700" : remaining <= 0 ? "text-destructive" : "text-foreground")}>{text}</strong>
        <span id={countdown} className="shrink-0 text-sm font-semibold tabular-nums">{claimed ? "Verified" : `${remaining}s`}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", claimed ? "bg-emerald-600" : remaining <= 0 ? "bg-destructive" : "bg-primary")} style={{ width: `${claimed ? 100 : Math.max(0, Math.min(100, (remaining / timeout) * 100))}%` }} />
      </div>
      {modal && <p id="gw-modal-claim-hint" className="mt-2 text-xs text-muted-foreground">Ask the winner to send a message in chat. Their live responses appear in the log below.</p>}
      <p
        id={modal ? "gw-modal-auto-reroll-stopped" : "gw-auto-reroll-stopped"}
        className="gw-auto-reroll-stopped mt-2 text-xs text-muted-foreground"
        role="status"
        hidden={!exhausted}
      >
        {exhausted ? `Auto re-roll stopped — ${winnerName || "the winner"} didn't respond and no other eligible entrants remain, so re-roll isn't possible. Start a new giveaway when you're ready.` : ""}
      </p>
    </div>
  );
}

function WinnerConfetti() {
  const [visible, setVisible] = useState(true);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const particles = useMemo(() => {
    const colors = ["var(--ws-accent)", "#8b5cf6", "#c4b5fd", "#e2e8f0"];
    return Array.from({ length: 24 }, (_, index) => ({
      color: colors[index % colors.length],
      x: (Math.random() * 2 - 1) * 150,
      y: -(50 + Math.random() * 150),
      rotation: Math.random() * 420 - 210,
      duration: 900 + Math.random() * 700,
    }));
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reducedMotion) return;
    const container = containerRef.current;
    if (!container) return;
    const animations: Animation[] = [];
    particles.forEach((particle, index) => {
      const piece = container.children.item(index);
      if (!piece || typeof piece.animate !== "function") return;
      const animation = piece.animate([
        { opacity: 0, transform: "translate(0, 0) rotate(0deg)" },
        { opacity: 1, offset: 0.12 },
        { opacity: 0, transform: `translate(${particle.x}px, ${particle.y}px) rotate(${particle.rotation}deg)` },
      ], {
        duration: particle.duration,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      });
      void animation.finished.catch(() => undefined);
      animations.push(animation);
    });
    const timer = window.setTimeout(() => setVisible(false), 2400);
    return () => {
      window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
    };
  }, [particles, reducedMotion]);

  if (!visible || reducedMotion) return null;
  return (
    <div ref={containerRef} id="gw-confetti" className="gw-confetti pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {particles.map((particle, index) => (
        <span
          key={index}
          className="gw-confetti-piece absolute left-1/2 top-[34%] h-3 w-[7px] rounded-sm opacity-0"
          style={{ backgroundColor: particle.color }}
        />
      ))}
    </div>
  );
}

function WinnerChatLog({
  winner,
  confirmationMessage,
  confirmedAt,
}: {
  winner: GiveawayWinner;
  confirmationMessage?: string | null;
  confirmedAt?: string | null;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [winner.id, winner.message, winner.entered_at, confirmationMessage, confirmedAt]);

  return (
    <div className="gw-winner-chat-card overflow-hidden rounded-lg border text-left">
      <div className="gw-winner-chat-head flex items-center justify-between gap-3 border-b px-4 py-3 text-sm font-semibold">
        <span>Winner&apos;s Live Chat Log</span>
        <span className="gw-winner-chat-tag inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium">
          <span className="gw-live-dot size-2 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" aria-hidden="true" />
          Live
        </span>
      </div>
      <div ref={feedRef} id="gw-winner-chat-feed" className="gw-winner-chat-feed max-h-36 space-y-2 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
        <div className="gw-winner-chat-item">
          <span className="gw-winner-chat-time text-muted-foreground">[{formatEnteredAt(winner.entered_at)}]</span>{" "}
          <span className="gw-winner-chat-user font-semibold">@{winner.username}:</span>
          <span className="gw-winner-chat-text"> {winner.message || ""}</span>
        </div>
        {confirmationMessage && (
          <div className="gw-winner-chat-item">
            <span className="gw-winner-chat-time text-muted-foreground">[{formatEnteredAt(confirmedAt)}]</span>{" "}
            <span className="gw-winner-chat-user font-semibold">@{winner.username}:</span>
            <span className="gw-winner-chat-text"> {confirmationMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EntrantRow({
  entrant,
  verifiedMode,
  onInclude,
  onExclude,
  onRemove,
}: {
  entrant: GiveawayEntrant;
  verifiedMode: boolean;
  onInclude: () => void;
  onExclude: () => void;
  onRemove: () => void;
}) {
  const manual = entrant.provider === "manual";
  const linked = entrant.linked || [];
  const excluded = entrant.eligibility_reason === "excluded_linked_account";
  const pending = !excluded && entrant.eligibility_status === "pending_verification";
  const rejected = excluded || entrant.eligibility_status === "rejected";
  const status = entrant.eligibility_reason === "excluded_linked_account"
    ? "Excluded: linked account"
    : pending
      ? "Pending"
      : entrant.eligibility_status === "rejected"
        ? entrant.eligibility_reason_label || `Rejected: ${String(entrant.eligibility_reason || "ineligible").replaceAll("_", " ")}`
        : verifiedMode && entrant.eligibility_status === "eligible"
          ? "Verified"
        : manual
          ? "Added manually"
          : entrant.badges?.some((badge) => badge.type === "subscriber")
            ? "Subscriber"
            : entrant.badges?.some((badge) => badge.type === "vip")
              ? "VIP"
              : "Entered";
  const statusClass = pending
    ? "border-amber-700/20 bg-amber-500/10 text-amber-800"
    : rejected
      ? "border-destructive/30 bg-destructive/5 text-destructive"
      : "border-emerald-700/20 bg-emerald-600/10 text-emerald-800";
  return (
    <tr id={`entrant-${entrant.id}`} data-username={entrant.username.toLowerCase()} className="align-middle">
      <td className="w-full max-w-0 px-3 py-3" data-label="Viewer">
        <div className="flex min-w-0 items-center gap-2">
          <img className="size-8 shrink-0 rounded-full bg-muted object-cover" src={manual ? DEFAULT_AVATAR : safeAvatarUrl(entrant.avatar_url)} alt="" />
          <div className="min-w-0 flex-1">
            {manual ? <span className="gw-entrant-name block truncate font-medium">{entrant.username}</span> : <a className="gw-entrant-name block truncate font-medium underline-offset-4 hover:underline" href={safeKickProfileUrl(entrant.username)} target="_blank" rel="noopener">{entrant.username}</a>}
            {!manual && entrant.message && <p className="gw-entrant-msg truncate text-xs text-muted-foreground">{entrant.message}</p>}
          </div>
        </div>
      </td>
      <td className="px-3 py-3 whitespace-nowrap" data-label="Status">
        <Badge className={cn("rounded-full whitespace-nowrap", statusClass)} title={pending ? "Waiting for verification — can't win yet" : undefined}>{status}</Badge>
        {linked.length > 0 && entrant.eligibility_reason !== "excluded_linked_account" && (
          <Badge className="gw-linked-badge ml-1 mt-1 rounded-full border-amber-700/20 bg-amber-500/5 text-amber-900" title={linked.map((link) => `${link.username}: ${(link.reasons || []).map(linkedReasonLabel).join(", ")}`).join(" · ")}>
            Linked · {linked[0].username}{linked.length > 1 ? ` (+${linked.length - 1})` : ""}
          </Badge>
        )}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap" data-label="Action">
        {entrant.eligibility_reason === "excluded_linked_account" && <Button type="button" size="sm" variant="outline" onClick={onInclude}>Include again</Button>}
        {linked.length > 0 && entrant.eligibility_reason !== "excluded_linked_account" && <Button type="button" size="sm" variant="outline" onClick={onExclude}>Exclude</Button>}
        <Button className="ml-1" type="button" size="icon" variant="ghost" title="Remove entrant" aria-label={`Remove ${entrant.username}`} onClick={onRemove}><X /></Button>
      </td>
    </tr>
  );
}

function DrawHistory({
  draws,
  currentWinner,
  autoRerollExhausted,
  winnerName,
  exhaustedAt,
}: {
  draws: GiveawayDraw[];
  currentWinner: boolean;
  autoRerollExhausted: boolean;
  winnerName: string;
  exhaustedAt?: string | null;
}) {
  const newestFirst = [...draws].reverse();
  const earlierDraws = newestFirst.slice(currentWinner ? 1 : 0);
  return (
    <div id="gw-draw-history" className={cn((autoRerollExhausted || earlierDraws.length > 0) && "border-t pt-3")}>
      <ul id="gw-draw-history-list" className="space-y-2 text-sm">
        {autoRerollExhausted && (
          <li className="gw-draw-history-row text-xs text-muted-foreground">
            Auto re-roll stopped — no other eligible entrants left ({winnerName} didn't respond) · {formatEnteredAt(exhaustedAt)}
          </li>
        )}
        {earlierDraws.map((draw, index) => {
          const name = draw.username || "a previous entrant";
          const replacedBy = newestFirst[index + (currentWinner ? 0 : -1)];
          const confirmed = Boolean(draw.confirmed_at);
          const label = confirmed ? "Confirmed" : replacedBy?.reason === "auto_reroll" ? "Didn't respond" : "Re-rolled";
          return (
            <li key={draw.id || `${draw.drawn_at}-${index}`} className="gw-draw-history-row flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="font-medium">{name}</span>
                <span className={cn("ml-2 text-xs", confirmed ? "text-emerald-700" : "text-muted-foreground")}>{label}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatEnteredAt(draw.drawn_at)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
