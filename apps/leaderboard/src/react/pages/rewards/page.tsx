import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { ChartLine, ShoppingBag } from "lucide-react";
import { reviewRewardReadiness } from "@yourrank/shared/reward-readiness";
import { kickDeliveryPresentation } from "../../../assets/kick-delivery-presentation.js";
import { optimizeRewardImage } from "../../../assets/reward-image.js";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import type {
  AnalyticsResponse,
  BoardContext,
  ChannelState,
  ClaimDetail,
  ClaimDetailResponse,
  ClaimPageResponse,
  ClaimSupport,
  ClaimSupportResponse,
  CreditsLimits,
  CreditsStatus,
  CreditsUsage,
  PageDependencies,
  RewardClaim,
  RewardMapping,
  RewardsTab,
  ShopItem,
} from "./types";

type PageProps = { tab: RewardsTab; dependencies?: Partial<PageDependencies> };
type Toast = { message: string; kind: "error" | "success" };
type ClaimFilter = "all" | "pending" | "needs_attention" | "completed";
type SortDirection = "cost" | "stock" | "active";
type ConfirmAction = {
  title: string;
  description: string;
  confirmText: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
};
type OAuthFeedback = { error: string | null; connected: boolean; deliveryFailed: boolean };

const BOARD_SHELL_MODULE = "/assets/dashboard/board-shell.js";
const DASHBOARD_SHELL_MODULE = "/assets/dashboard/shell.js";
const EMPTY_STATUS: CreditsStatus = {};
const EMPTY_USAGE: CreditsUsage = {};
const EMPTY_LIMITS: CreditsLimits = {};
const CLAIM_FILTER_PARAM: Record<ClaimFilter, string> = {
  all: "all",
  pending: "action_required",
  needs_attention: "needs_attention",
  completed: "completed",
};
const CLAIM_EMPTY: Record<ClaimFilter, { title: string; body: string }> = {
  all: { title: "No claims yet", body: "Claims will appear after a member redeems a shop item." },
  pending: { title: "No pending claims", body: "Every claim has been completed or cancelled." },
  needs_attention: { title: "Nothing needs attention", body: "No pending claims and no open support requests." },
  completed: { title: "No completed claims yet", body: "Completed claims will appear here." },
};
const OAUTH_MESSAGES: Record<string, string> = {
  no_site_selected: "Select a site before connecting Kick.",
  site_not_found: "That site is no longer available. Select another site.",
  site_not_authorized: "You do not have permission to connect Kick for this site.",
  rate_limited: "Too many connection attempts. Try again shortly.",
  missing_oauth_params: "Kick did not return the information needed. Try again.",
  oauth_state_expired: "That took too long — try connecting again.",
  oauth_user_mismatch: "This connection started in another account. Try again.",
  access_denied: "Kick connection was cancelled.",
  kick_auth_failed: "Kick connection could not be completed. Try again.",
};
const DEFAULT_DEPENDENCIES: PageDependencies = {
  api,
  loadBoardShell: async () => {
    const module = await import(BOARD_SHELL_MODULE) as { loadBoardShell: () => Promise<BoardContext> };
    return module.loadBoardShell();
  },
  optimizeRewardImage: async (file) => optimizeRewardImage(file),
  requestDashboardRoute: async (page, tab, options) => {
    const module = await import(DASHBOARD_SHELL_MODULE) as {
      requestDashboardRoute: (page: string, tab: string, options?: { query?: string; force?: boolean }) => void;
    };
    module.requestDashboardRoute(page, tab, options);
  },
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
const numberOr = (value: number | null | undefined, fallback: string) =>
  value == null ? fallback : String(value);
const sitePath = (path: string, siteId: string) =>
  siteId ? `${path}${path.includes("?") ? "&" : "?"}siteId=${encodeURIComponent(siteId)}` : path;
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const relativeLabel = (value?: string | null) => {
  if (!value) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1_440)}d ago`;
};
const claimSourceId = (claim: RewardClaim) =>
  claim.source?.id || String(claim.id || "").replace(/^redemption:/, "");
const claimId = (redemptionId: string) => `redemption:${redemptionId}`;
const feedbackText = (error: unknown, fallback: string) => errorMessage(error, fallback);

function signalBoot() {
  (window as Window & { __yrBoot?: { signal?: () => void } }).__yrBoot?.signal?.();
}

function StatusText({ children, error = false, className }: { children: React.ReactNode; error?: boolean; className?: string }) {
  return <p className={cn("cr-react-status", "status", error && "error", className)} role={error ? "alert" : "status"} aria-live="polite">{children}</p>;
}

function InfoTip({ label, info }: { label: string; info: string }) {
  return <Popover>
    <PopoverTrigger asChild>
      <button className="cr-info-tip" type="button" aria-label={`About ${label}`}>i</button>
    </PopoverTrigger>
    <PopoverContent className="cr-info-popover" style={{ maxWidth: "min(15rem, calc(100vw - 2rem))" }}>{info}</PopoverContent>
  </Popover>;
}

function Metric({ label, info, value, scope, scopeTone = "period", foot }: {
  label: string;
  info: string;
  value: string;
  scope: string;
  scopeTone?: "period" | "now";
  foot?: React.ReactNode;
}) {
  return <div className="v3-kpi-card cr-metric-card">
    <div className="cr-metric-label"><span>{label}</span><InfoTip label={label} info={info} /></div>
    <strong className="cr-metric-value">{value}</strong>
    <span className={cn("cr-metric-scope", scopeTone === "now" && "is-now")}>{scope}</span>
    {foot && <div className="cr-metric-foot">{foot}</div>}
  </div>;
}

function DataTable({ children, label }: { children: React.ReactNode; label?: string }) {
  return <div className="cr-table-scroll"><table className="v3-table" aria-label={label}>{children}</table></div>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div className="v3-empty" role="status"><h2>{title}</h2><p>{body}</p>{action}</div>;
}

function CompactEmpty({ icon, title, body, action }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return <div className="cr-compact-empty" role="status">
    <span className="cr-compact-icon" aria-hidden="true">{icon}</span>
    <div className="cr-compact-copy"><strong>{title}</strong><p>{body}</p></div>
    {action && <div className="cr-compact-action">{action}</div>}
  </div>;
}

function RewardsHead({ tab }: { tab: RewardsTab }) {
  const heading: Record<RewardsTab, [string, string]> = {
    channel: ["Kick connection", "Site connection — this Kick channel powers the selected site's credits. Your account sign-ins live under Settings → Connections."],
    overview: ["Overview", "Your next step, plus how credits and claims are moving."],
    rules: ["Ways to earn", "Choose how members earn Credits."],
    shop: ["Shop", "Manage what members can claim with Credits."],
    redemptions: ["Claims", "Handle reward claims and keep fulfillment moving."],
  };
  const [title, subtitle] = heading[tab];
  return <header className="v3-head cr-react-head"><div><h1>{title}</h1><p className="v3-head-sub">{subtitle}</p></div></header>;
}

function ToastRegion({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return <div className={cn("toast", toast.kind === "error" && "toast--error")} role={toast.kind === "error" ? "alert" : "status"} aria-live="polite">{toast.message}</div>;
}

function LoadingPage() {
  return <div className="grid gap-4" role="status" aria-live="polite" aria-busy="true">
    <Skeleton className="h-8 w-52" />
    <Skeleton className="h-5 w-80 max-w-full" />
    <Skeleton className="h-36 w-full" />
  </div>;
}

function useStoredDraft<T extends Record<string, unknown>>(id: string, initial: T) {
  const [restored] = useState(() => {
    try {
      return Boolean(localStorage.getItem(`yr:credits:draft:${id}`));
    } catch {
      return false;
    }
  });
  const skipNextSave = useRef(false);
  const [values, setValues] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`yr:credits:draft:${id}`) || "null") as Partial<T> | null;
      return saved ? { ...initial, ...saved } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const saved = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "" && value !== false && value != null));
      try {
        if (Object.keys(saved).length) localStorage.setItem(`yr:credits:draft:${id}`, JSON.stringify(saved));
        else localStorage.removeItem(`yr:credits:draft:${id}`);
      } catch {
        return;
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [id, values]);
  const clear = useCallback(() => {
    skipNextSave.current = true;
    try {
      localStorage.removeItem(`yr:credits:draft:${id}`);
    } catch {
      return;
    }
  }, [id]);
  return [values, setValues, clear, restored] as const;
}

function useClearSuccessStatus(
  status: string,
  error: boolean,
  setStatus: React.Dispatch<React.SetStateAction<string>>,
) {
  useEffect(() => {
    if (!status || error) return;
    const timer = setTimeout(() => setStatus(""), 3_000);
    return () => clearTimeout(timer);
  }, [error, setStatus, status]);
}

function ConfirmDialog({ action, close }: { action: ConfirmAction | null; close: () => void }) {
  const [busy, setBusy] = useState(false);
  return <AlertDialog open={Boolean(action)} onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <AlertDialogContent className="yr-react">
      <AlertDialogHeader>
        <AlertDialogTitle>{action?.title}</AlertDialogTitle>
        <AlertDialogDescription>{action?.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>No</AlertDialogCancel>
        <AlertDialogAction disabled={busy} className={action?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          onClick={(event) => {
            event.preventDefault();
            if (!action) return;
            setBusy(true);
            void action.onConfirm().finally(() => {
              setBusy(false);
              close();
            });
          }}>{busy ? "Saving…" : action?.confirmText}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

function ChannelTab({
  data,
  siteId,
  oauth,
  deps,
  notify,
  reload,
}: {
  data: CreditsStatus;
  siteId: string;
  oauth: OAuthFeedback | null;
  deps: PageDependencies;
  notify: (message: string, kind?: Toast["kind"]) => void;
  reload: () => Promise<unknown>;
}) {
  const channel = data.channel || {};
  const capabilities = data.capabilities || {};
  const canManage = capabilities.manageConnections !== false;
  const connected = Boolean(channel.connected ?? channel.externalId);
  const connectionStatus = channel.status || (connected ? "authorized" : "not_connected");
  const attention = connected && (connectionStatus === "needs_attention" || connectionStatus === "delivery_failed");
  const delivery = kickDeliveryPresentation({
    connected,
    deliveryFailed: connectionStatus === "delivery_failed",
    status: connectionStatus,
    delivery: channel.delivery,
  });
  const [form, setForm, clearDraft, draftRestored] = useStoredDraft("channel", {
    externalId: channel.externalId || "",
    name: channel.name || "",
  });
  const [viewerAuth, setViewerAuth, clearViewerAuthDraft, authDraftRestored] = useStoredDraft("viewer-auth", {
    kick: data.viewerAuth?.kick !== false,
    discord: data.viewerAuth?.discord !== false,
    public: data.viewerAuth?.public !== false,
  });
  const [manualStatus, setManualStatus] = useState("");
  const [manualError, setManualError] = useState(false);
  const [authStatus, setAuthStatus] = useState("");
  const [authError, setAuthError] = useState(false);
  const [busy, setBusy] = useState("");

  useClearSuccessStatus(manualStatus, manualError, setManualStatus);
  useClearSuccessStatus(authStatus, authError, setAuthStatus);

  useEffect(() => {
    if (draftRestored) setManualStatus("Draft restored.");
  }, [draftRestored]);

  useEffect(() => {
    if (authDraftRestored) setAuthStatus("Draft restored.");
  }, [authDraftRestored]);

  useEffect(() => {
    if (!oauth) return;
    if (oauth.error) {
      setManualStatus(OAUTH_MESSAGES[oauth.error] || "Kick connection could not be completed. Try again.");
      setManualError(true);
    } else if (oauth.deliveryFailed) {
      setManualStatus("Kick is authorized, but event delivery could not be set up. Use “Repair delivery” to retry.");
      setManualError(true);
    } else {
      setManualStatus(`Connected to ${channel.name ? `@${channel.name}` : "your channel"} on Kick.`);
      setManualError(false);
    }
  }, [oauth, channel.name]);

  const updateForm = (key: "externalId" | "name", value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submitManualConnection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("manual");
    setManualStatus("");
    setManualError(false);
    try {
      const result = await deps.api<{ channel?: ChannelState }>("/api/credits/connect", {
        method: "POST",
        body: JSON.stringify({ externalId: form.externalId.trim(), name: form.name.trim() }),
      }, siteId);
      clearDraft();
      setForm({
        externalId: result.channel?.externalId || form.externalId,
        name: result.channel?.name || form.name,
      });
      setManualStatus("Channel saved.");
      await reload();
    } catch (error) {
      const message = feedbackText(error, "Something went wrong. Try again.");
      setManualStatus(message);
      setManualError(true);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  const repair = async () => {
    setBusy("repair");
    setManualStatus("");
    setManualError(false);
    try {
      const result = await deps.api<{ repaired?: boolean }>("/api/kick/repair", { method: "POST" }, siteId);
      if (result.repaired) {
        setManualStatus("Kick event delivery verified.");
      } else {
        setManualStatus("Kick is still not delivering all required events. Try again in a moment.");
        setManualError(true);
      }
      await reload();
    } catch (error) {
      const message = feedbackText(error, "Something went wrong. Try again.");
      setManualStatus(message);
      setManualError(true);
    } finally {
      setBusy("");
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setManualStatus("");
    setManualError(false);
    try {
      await deps.api("/api/kick/disconnect", { method: "POST" }, siteId);
      clearDraft();
      setForm({ externalId: "", name: "" });
      setManualStatus("Disconnected.");
      await reload();
    } catch (error) {
      setManualStatus(feedbackText(error, "Something went wrong. Try again."));
      setManualError(true);
    } finally {
      setBusy("");
    }
  };

  const saveAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("auth");
    setAuthStatus("");
    setAuthError(false);
    try {
      const saved = await deps.api<CreditsStatus["viewerAuth"]>("/api/credits/viewer-auth", {
        method: "POST",
        body: JSON.stringify(viewerAuth),
      }, siteId);
      clearViewerAuthDraft();
      if (saved) setViewerAuth({
        kick: saved.kick !== false,
        discord: saved.discord !== false,
        public: saved.public !== false,
      });
      setAuthStatus("Member login settings saved.");
    } catch (error) {
      setAuthStatus(feedbackText(error, "Something went wrong. Try again."));
      setAuthError(true);
    } finally {
      setBusy("");
    }
  };

  const usage = data.usage || EMPTY_USAGE;
  const limits = data.limits || EMPTY_LIMITS;
  const usageRows: Array<[keyof CreditsUsage, keyof CreditsLimits, string]> = [
    ["rewardMappings", "rewardMappings", "ways to earn"],
    ["shopItems", "shopItems", "items"],
    ["pendingRedemptions", "pendingRedemptions", "pending claims"],
    ["redemptionsPer30Days", "redemptionsPer30Days", "claims / 30 days"],
    ["newViewersPer30Days", "newViewersPer30Days", "new members / 30 days"],
  ];

  return <div className="cr-react-grid">
    <Card className="cr-channel-card">
      <CardContent className="p-6">
        {connected ? <div>
          <div className="cr-react-head">
            <div className="flex items-center gap-3">
              <span className="cr-kick-mark" aria-hidden="true">K</span>
              <div>
                <h2 className="text-lg font-semibold">@{channel.name || "Kick"} on Kick</h2>
                <Badge variant={attention ? "warning" : "success"} className="mt-2">
                  ● {channel.statusLabel || (connectionStatus === "needs_attention" ? "Needs attention" : "Authorized")}
                </Badge>
              </div>
            </div>
            {canManage && <Button type="button" variant="destructive" size="sm" onClick={() => void disconnect()} disabled={Boolean(busy)}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </Button>}
          </div>
          <div className="cr-react-grid cr-react-grid--two mt-6">
            <div><span className="hint">Connection</span><p className={cn(attention && "cr-attention")}>{channel.connected ? channel.statusLabel || "Connected" : "Not connected"}</p></div>
            <div><span className="hint">Token</span><p className={cn(attention && "cr-attention")}>{channel.detail || (connected ? "Authorization can renew automatically" : "Not connected yet")}</p></div>
            <div><span className="hint">Event delivery</span><p className={cn(connectionStatus === "delivery_failed" && "cr-attention")} title={delivery.detail}>{delivery.label}</p></div>
            <div><span className="hint">Connected on</span><p>{dateLabel(channel.linkedAt)}</p></div>
          </div>
          <div className="cr-react-actions mt-4">
            {canManage && connectionStatus === "needs_attention" && <a id="cr-channel-reconnect" href={sitePath("/auth/kick", siteId)}>Reconnect Kick</a>}
            {canManage && (channel.canRepair || connectionStatus === "delivery_failed" || connectionStatus === "authorized") &&
              <Button type="button" variant="outline" size="sm" onClick={() => void repair()} disabled={Boolean(busy)}>
                {busy === "repair" ? "Repairing…" : "Repair delivery"}
              </Button>}
          </div>
        </div> : canManage ? <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <span className="cr-kick-mark" aria-hidden="true">K</span>
            <div><h2 className="text-lg font-semibold">Connect your Kick channel</h2><p className="v3-head-sub">Link Kick to turn channel-point rewards into credits.</p></div>
          </div>
          <div className="cr-react-actions">
            <Button asChild><a id="cr-channel-connect" href={sitePath("/auth/kick", siteId)}>Connect with Kick</a></Button>
          </div>
          <details className="cr-advanced">
            <summary>Manual channel ID</summary>
            <form className="cr-react-form mt-4" onSubmit={(event) => void submitManualConnection(event)}>
              <div className="cr-react-field">
                <Label htmlFor="cr-channel-id-input">Kick channel/broadcaster ID</Label>
                <Input id="cr-channel-id-input" name="externalId" type="text" placeholder="12345678" value={form.externalId} onChange={(event) => updateForm("externalId", event.target.value)} />
                <span className="hint">Your numeric Kick channel ID (e.g. 12345678). Tip: The green "Connect with Kick" button above links automatically.</span>
              </div>
              <div className="cr-react-field">
                <Label htmlFor="cr-channel-name-input">Channel name (optional)</Label>
                <Input id="cr-channel-name-input" name="name" type="text" placeholder="yourchannel" value={form.name} onChange={(event) => updateForm("name", event.target.value)} />
                <span className="hint">Your Kick username / handle without the @ sign.</span>
              </div>
              <div className="cr-react-field cr-react-field--full">
                <Button id="cr-channel-submit" type="submit" disabled={Boolean(busy)}>{busy === "manual" ? "Saving…" : "Save channel"}</Button>
              </div>
            </form>
          </details>
        </div> : <StatusText>The site owner manages the Kick connection.</StatusText>}
        <StatusText error={manualError}>{manualStatus}</StatusText>
        {oauth?.error && !manualStatus && <StatusText error>{OAUTH_MESSAGES[oauth.error] || "Kick connection could not be completed. Try again."}</StatusText>}
      </CardContent>
    </Card>
    <section className="account-related-setting">
      <div><strong>Account connections</strong><p>Sign-in accounts and partner delivery settings are managed once for your account.</p></div>
      <a className="btn btn--ghost" href="/dashboard/settings/connections">Open account connections</a>
    </section>
    <details className="cr-detail-panel">
      <summary>Usage and member login</summary>
      <div className="cr-react-grid cr-react-grid--two mt-4">
        <Card>
          <CardHeader><CardTitle>Plan usage</CardTitle></CardHeader>
          <CardContent className="cr-usage-grid">
            {usageRows.map(([used, limit, label]) => <div className="cr-usage-card" key={label}>
              <div className="hint">{label}</div>
              <div className="cr-usage-number">{numberOr(usage[used], "—")} / {numberOr(limits[limit], "—")}</div>
              {usage[used] != null && limits[limit] != null && usage[used]! >= limits[limit]! &&
                <a className="cr-usage-upgrade" href="/dashboard/settings/billing">Upgrade plan</a>}
            </div>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Member login settings</CardTitle></CardHeader>
          <CardContent>
            {canManage ? <form className="grid gap-4" onSubmit={(event) => void saveAuth(event)}>
              <label className="cr-auth-option"><Checkbox checked={viewerAuth.kick} onCheckedChange={(checked) => setViewerAuth((current) => ({ ...current, kick: checked === true }))} /><span>Allow “Sign in with Kick”</span></label>
              <label className="cr-auth-option"><Checkbox checked={viewerAuth.discord} onCheckedChange={(checked) => setViewerAuth((current) => ({ ...current, discord: checked === true }))} /><span>Allow “Sign in with Discord”</span></label>
              <p className="hint">Public username lookup and claiming is not available. Members must sign in with Kick or Discord.</p>
              <div><Button type="submit" disabled={Boolean(busy)}>{busy === "auth" ? "Saving…" : "Save settings"}</Button><StatusText error={authError}>{authStatus}</StatusText></div>
            </form> : <p className="status">Connection credentials and authentication settings are managed by the site owner.</p>}
          </CardContent>
        </Card>
      </div>
    </details>
  </div>;
}

type ShopDraft = {
  id: string;
  name: string;
  description: string;
  cost: string;
  stock: string;
  cooldownSeconds: string;
  active: boolean;
};

const EMPTY_SHOP_DRAFT: ShopDraft = {
  id: "",
  name: "",
  description: "",
  cost: "100",
  stock: "",
  cooldownSeconds: "0",
  active: true,
};

function ShopTab({
  data,
  siteId,
  deps,
  notify,
  reload,
}: {
  data: CreditsStatus;
  siteId: string;
  deps: PageDependencies;
  notify: (message: string, kind?: Toast["kind"]) => void;
  reload: () => Promise<unknown>;
}) {
  const items = data.shopItems || [];
  const capabilities = data.capabilities || {};
  const canManage = capabilities.manageRewards !== false;
  const usage = data.usage || EMPTY_USAGE;
  const limits = data.limits || EMPTY_LIMITS;
  const shopAtLimit = usage.shopItems != null && limits.shopItems != null && usage.shopItems >= limits.shopItems;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortDirection>("cost");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [draft, setDraft, clearDraft, draftRestored] = useStoredDraft("shop", EMPTY_SHOP_DRAFT);
  const [imageData, setImageData] = useState<string | null | undefined>(undefined);
  const imageVersionRef = useRef(0);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageStatus, setImageStatus] = useState("JPG, PNG or WebP up to 12 MB. Automatically resized to 960 pixels and compressed under 180 KB.");
  const [imageError, setImageError] = useState(false);
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useClearSuccessStatus(status, statusError, setStatus);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = items.filter((item) =>
      !normalized || `${item.name} ${item.description || ""} ${item.cost} ${item.stock ?? ""}`.toLowerCase().includes(normalized));
    return [...filtered].sort((left, right) =>
      sort === "active" ? Number(right.active) - Number(left.active) :
        sort === "stock" ? ((right.stock ?? Number.POSITIVE_INFINITY) - (left.stock ?? Number.POSITIVE_INFINITY)) :
          (right.cost || 0) - (left.cost || 0));
  }, [items, query, sort]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / 10));
  const visibleItems = filteredItems.slice((page - 1) * 10, page * 10);
  const findings = useMemo(() => reviewRewardReadiness(
    { id: draft.id || undefined, name: draft.name, description: draft.description },
    { siblings: items, contactReady: data.creatorContact?.ready !== false },
  ), [data.creatorContact?.ready, draft.description, draft.id, draft.name, items]);
  const activeFindings = draft.active ? findings.findings : [];
  const reviewIntro = activeFindings.some((finding) => finding.field === "contact")
    ? "A contact method is required before a new reward goes live. Rewards that are already active stay active."
    : "These are warnings, not blockers: you can still save. Fix them so members know what they get and how to reach you.";
  const contactHref = () => {
    const base = data.creatorContact?.editHref || "/dashboard/site#siteContactCard";
    if (!siteId) return base;
    const [path, hash] = base.split("#");
    return `${path}?board=${encodeURIComponent(siteId)}${hash ? `#${hash}` : ""}`;
  };
  const imageSrc = imageData || (draft.id && items.find((item) => item.id === draft.id)?.has_image
    ? sitePath(`/api/credits/shop/${encodeURIComponent(draft.id)}/image`, siteId)
    : "");

  const openEditor = useCallback((item?: ShopItem, trigger?: HTMLElement) => {
    imageVersionRef.current += 1;
    setImageProcessing(false);
    setImageData(undefined);
    setImageStatus("JPG, PNG or WebP up to 12 MB. Automatically resized to 960 pixels and compressed under 180 KB.");
    setImageError(false);
    setStatus(draftRestored && !item ? "Draft restored." : "");
    setStatusError(false);
    setDraft(item ? {
      id: item.id,
      name: item.name,
      description: item.description || "",
      cost: String(item.cost),
      stock: item.stock === null ? "" : String(item.stock),
      cooldownSeconds: String(Number(item.cooldown_seconds) || 0),
      active: item.active !== false,
    } : draftRestored ? draft : { ...EMPTY_SHOP_DRAFT });
    triggerRef.current = trigger || document.getElementById("cr-shop-new");
    setOpen(true);
  }, [draft, draftRestored]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("new") !== "1") return;
    params.delete("new");
    const query = params.toString();
    history.replaceState({}, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    openEditor();
  }, [openEditor]);

  const closeEditor = () => {
    imageVersionRef.current += 1;
    setImageProcessing(false);
    setOpen(false);
  };

  const optimizeImage = async (file?: File) => {
    if (!file) return;
    const version = imageVersionRef.current + 1;
    imageVersionRef.current = version;
    setImageProcessing(true);
    setImageError(false);
    setImageStatus("Optimizing picture…");
    try {
      const result = await deps.optimizeRewardImage(file);
      if (version !== imageVersionRef.current) return;
      setImageData(result.data);
      setImageStatus(`Ready: ${Math.ceil(result.bytes / 1024)} KB WebP. Save the item to apply.`);
    } catch (error) {
      if (version !== imageVersionRef.current) return;
      setImageStatus(feedbackText(error, "Could not read that image."));
      setImageError(true);
    } finally {
      if (version === imageVersionRef.current) setImageProcessing(false);
    }
  };

  const removeImage = () => {
    imageVersionRef.current += 1;
    setImageProcessing(false);
    setImageData(null);
    setImageStatus("Picture removed. Save the item to apply.");
    setImageError(false);
  };

  const saveItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (imageProcessing) return;
    setBusy(true);
    setStatus("");
    setStatusError(false);
    try {
      await deps.api("/api/credits/shop", {
        method: "POST",
        body: JSON.stringify({
          id: draft.id || undefined,
          name: draft.name.trim(),
          description: draft.description.trim(),
          cost: Number(draft.cost),
          stock: draft.stock === "" ? null : Number(draft.stock),
          cooldownSeconds: Number(draft.cooldownSeconds) || 0,
          active: draft.active,
          imageData,
        }),
      }, siteId);
      setStatus("Shop item saved.");
      notify("Shop item saved.");
      clearDraft();
      setDraft({ ...EMPTY_SHOP_DRAFT });
      closeEditor();
      await reload();
    } catch (error) {
      const message = feedbackText(error, "Something went wrong. Try again.");
      setStatus(message);
      setStatusError(true);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = async (item: ShopItem, active: boolean) => {
    setBusy(true);
    try {
      await deps.api("/api/credits/shop", {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          name: item.name,
          description: item.description || "",
          cost: item.cost,
          stock: item.stock ?? null,
          cooldownSeconds: Number(item.cooldown_seconds) || 0,
          active,
        }),
      }, siteId);
      await reload();
    } catch (error) {
      notify(feedbackText(error, "Something went wrong. Try again."), "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = (item: ShopItem) => setConfirm({
    title: "Delete reward",
    description: "Remove this reward from your shop? Existing claims and their history will be kept. This cannot be undone.",
    confirmText: "Delete reward",
    destructive: true,
    onConfirm: async () => {
      setBusy(true);
      try {
        await deps.api(`/api/credits/shop/${encodeURIComponent(item.id)}`, { method: "DELETE" }, siteId);
        await reload();
      } catch (error) {
        notify(feedbackText(error, "Something went wrong. Try again."), "error");
      } finally {
        setBusy(false);
      }
    },
  });

  const shopForm = <form className="grid gap-4" onSubmit={(event) => void saveItem(event)}>
    <input type="hidden" id="cr-shop-item-id" value={draft.id} />
    <div className="cr-react-field">
      <Label htmlFor="cr-shop-name">Shop item name</Label>
      <Input id="cr-shop-name" name="name" type="text" placeholder="e.g. VIP Role (1 Month), Steam Key, Play Next Game" required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
      <span className="hint">What the member will receive when claiming this item.</span>
    </div>
    <div className="cr-react-field">
      <Label htmlFor="cr-shop-desc">Description</Label>
      <Textarea id="cr-shop-desc" name="description" rows={3} placeholder="Add details or instructions for your members." value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
      <span className="hint">Shown to members in your public shop.</span>
    </div>
    <div className="cr-react-field">
      <Label htmlFor="cr-shop-image">Reward picture</Label>
      <Input id="cr-shop-image" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="cr-shop-image-status" onChange={(event) => void optimizeImage(event.target.files?.[0])} />
      {imageSrc && <img className="reward-image-preview" src={imageSrc} alt="Selected reward picture" />}
      {imageSrc && <Button type="button" size="sm" variant="outline" className="w-fit" onClick={removeImage}>Remove picture</Button>}
      <StatusText error={imageError} className="hint">{imageStatus}</StatusText>
    </div>
    <div className="cr-react-grid cr-react-grid--two">
      <div className="cr-react-field cr-suffix-field"><Label htmlFor="cr-shop-cost">Credit cost</Label><Input id="cr-shop-cost" name="cost" type="number" min={1} value={draft.cost} onChange={(event) => setDraft((current) => ({ ...current, cost: event.target.value }))} required /><span className="hint">Credits needed to claim.</span></div>
      <div className="cr-react-field cr-suffix-field"><Label htmlFor="cr-shop-stock">Stock</Label><Input id="cr-shop-stock" name="stock" type="number" min={0} placeholder="∞" value={draft.stock} onChange={(event) => setDraft((current) => ({ ...current, stock: event.target.value }))} /><span className="hint">Leave empty for unlimited (∞).</span></div>
    </div>
    <div className="cr-react-field">
      <Label htmlFor="cr-shop-cooldown">Wait between claims</Label>
      <select id="cr-shop-cooldown" name="cooldownSeconds" className="v3-select" value={draft.cooldownSeconds} onChange={(event) => setDraft((current) => ({ ...current, cooldownSeconds: event.target.value }))}>
        <option value="0">No wait</option><option value="3600">1 hour</option><option value="21600">6 hours</option><option value="43200">12 hours</option><option value="86400">24 hours</option><option value="259200">3 days</option><option value="604800">7 days</option>
      </select>
      <span className="hint">How long a member waits before claiming this item again.</span>
    </div>
    <label className="cr-toggle-row" htmlFor="cr-shop-active">
      <span><b>Active</b><small>Visible and available for members to claim in your public shop.</small></span>
      <Switch id="cr-shop-active" name="active" checked={draft.active} onCheckedChange={(active) => setDraft((current) => ({ ...current, active }))} />
    </label>
    {activeFindings.length > 0 && <section className="cr-shop-review" aria-labelledby="cr-shop-review-title">
      <h3 id="cr-shop-review-title">Before this goes live</h3>
      <p className="hint">{reviewIntro}</p>
      <ul className="cr-shop-review-list">
        {activeFindings.map((finding) => <li data-review-code={finding.code} key={finding.code}>
          <span>{finding.message}</span>{" "}
          {finding.field === "contact"
            ? <a className="cr-shop-review-fix" href={contactHref()}>Add a contact method</a>
            : <button className="cr-shop-review-fix" type="button" onClick={() => document.getElementById("cr-shop-desc")?.focus()}>Edit description</button>}
        </li>)}
      </ul>
    </section>}
    <StatusText error={statusError}>{status}</StatusText>
    <DialogFooter className="cr-drawer-actions">
      <Button type="button" variant="outline" onClick={closeEditor}>Cancel</Button>
      <Button id="cr-shop-submit" type="submit" disabled={busy || imageProcessing || !canManage || shopAtLimit && !draft.id}>{busy ? "Saving…" : "Save shop item"}</Button>
    </DialogFooter>
  </form>;

  return <div className="cr-react-grid">
    <section className="cr-shop-layout" id="cr-shop">
      <div className="v3-section-head">
        <p className="v3-head-sub v3-head-sub--mono">
          {numberOr(usage.shopItems, "—")} / {numberOr(limits.shopItems, "—")} active items
          {shopAtLimit && <> · <a href="/dashboard/settings/billing">Billing limit reached — upgrade plan</a></>}
        </p>
        {canManage && <Button id="cr-shop-new" type="button" size="sm" onClick={(event) => openEditor(undefined, event.currentTarget)} disabled={shopAtLimit} title={shopAtLimit ? "Upgrade your plan to add more items" : undefined}>Create item</Button>}
      </div>
      {items.length > 0 && <div id="cr-shop-controls" className="cr-react-grid cr-react-grid--two">
        <div className="cr-react-field"><Label htmlFor="cr-shop-search">Search shop items</Label><Input id="cr-shop-search" type="search" placeholder="Search…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></div>
        <div className="cr-react-field"><Label htmlFor="cr-shop-sort">Sort</Label><select id="cr-shop-sort" className="v3-select" value={sort} onChange={(event) => setSort(event.target.value as SortDirection)}><option value="cost">Cost</option><option value="stock">Stock</option><option value="active">Active first</option></select></div>
      </div>}
      {visibleItems.length > 0 ? <div className="cr-shop-grid">
        <div className="cr-shop-cards">
          {visibleItems.map((item) => {
            const itemReview = reviewRewardReadiness(item, { siblings: items, contactReady: data.creatorContact?.ready !== false });
            return <article className={cn("cr-react-shop-row", !item.active && "is-inactive")} key={item.id}>
              <div className="cr-shop-row-main">
                {item.has_image && <img className="cr-react-shop-image" src={sitePath(`/api/credits/shop/${encodeURIComponent(item.id)}/image`, siteId)} alt={`Picture for ${item.name}`} width={60} height={40} loading="lazy" decoding="async" />}
                <button className="cr-shop-row-title" type="button" onClick={(event) => openEditor(item, event.currentTarget)}>{item.name}</button>
                {item.active && !itemReview.ready && <button className="v3-chip v3-chip--pending cr-shop-review-chip" type="button" onClick={(event) => openEditor(item, event.currentTarget)} aria-label={`Review ${item.name}: live with incomplete details`}>Needs review</button>}
                <p>{item.description || "No description"}</p>
              </div>
              <dl className="cr-shop-row-facts">
                <div><dt>Cost</dt><dd>{item.cost} Credits</dd></div>
                <div><dt>Stock</dt><dd>{item.stock === null ? "Unlimited" : `${item.stock} left`}</dd></div>
              </dl>
              <label className="cr-shop-row-availability">
                <span>{item.active ? "Available" : "Hidden"}</span>
                <Switch checked={item.active} disabled={!canManage || busy} onCheckedChange={(active) => void toggleItem(item, active)} aria-label={`Make ${item.name} available`} />
              </label>
              {canManage && <div className="cr-shop-row-actions">
                <Button type="button" size="sm" variant="outline" onClick={(event) => openEditor(item, event.currentTarget)}>Edit</Button>
                <Button type="button" size="sm" variant="destructive" aria-label={`Delete ${item.name}`} onClick={() => deleteItem(item)}>Delete</Button>
              </div>}
            </article>;
          })}
        </div>
      </div> : <EmptyState
        title={items.length ? "No matching items" : "No shop items yet"}
        body={items.length ? "Try a different item name, cost, or stock value." : "Create a shop item members can claim with Credits."}
        action={!items.length && canManage && <Button type="button" onClick={(event) => openEditor(undefined, event.currentTarget)} disabled={shopAtLimit}>Create item</Button>}
      />}
      {filteredItems.length > 10 && <div className="v3-table-foot flex items-center justify-between">
        <span>Page {page} of {pageCount} ({filteredItems.length})</span><div className="cr-react-actions">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
          <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button>
        </div>
      </div>}
    </section>
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeEditor(); }}>
      <DialogContent className="yr-react cr-react-shop-dialog" aria-describedby="cr-shop-dialog-description"
        onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle id="cr-shop-drawer-title">{draft.id ? "Edit item" : "Create item"}</DialogTitle>
          <DialogDescription id="cr-shop-dialog-description">Manage what members can claim with Credits.</DialogDescription>
        </DialogHeader>
        <div className="cr-react-dialog-body mt-4">{shopForm}</div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog action={confirm} close={() => setConfirm(null)} />
  </div>;
}

function normalizedClaimId(value: string) {
  return value.startsWith("redemption:") ? value : claimId(value);
}

function fallbackClaimStatus(status: string) {
  if (status === "completed" || status === "fulfilled") return "Fulfilled";
  if (status === "cancelled") return "Cancelled";
  if (status === "refunded") return "Refunded";
  return "Pending";
}

function claimDisplayStatus(claim: RewardClaim) {
  return claim.statusLabel || fallbackClaimStatus(claim.status);
}

function ClaimsTab({ siteId, deps, notify }: {
  siteId: string;
  deps: PageDependencies;
  notify: (message: string, kind?: Toast["kind"]) => void;
}) {
  const [filter, setFilter] = useState<ClaimFilter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [claims, setClaims] = useState<RewardClaim[]>([]);
  const [pageMeta, setPageMeta] = useState<ClaimPageResponse["page"]>({ hasMore: false, nextCursor: null });
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState(false);
  const claimRequest = useRef(0);
  const detailRequest = useRef(0);
  const supportBusy = useRef(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const selectedIdRef = useRef("");
  const [selectedClaim, setSelectedClaim] = useState<ClaimDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailStatus, setDetailStatus] = useState("");
  const [support, setSupport] = useState<ClaimSupport | null>(null);
  const [supportStatus, setSupportStatus] = useState("");
  const [supportError, setSupportError] = useState(false);
  const [reply, setReply] = useState("");
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [actionBusy, setActionBusy] = useState("");
  const detailTrigger = useRef<HTMLButtonElement | null>(null);

  useClearSuccessStatus(detailStatus, Boolean(detailError), setDetailStatus);
  useClearSuccessStatus(supportStatus, supportError, setSupportStatus);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const loadClaims = useCallback(async (cursor?: string, append = false) => {
    const request = ++claimRequest.current;
    if (append) {
      setLoadingMore(true);
      setMoreError(false);
    } else {
      setLoading(true);
      setError("");
      setClaims([]);
      setPageMeta({ hasMore: false, nextCursor: null });
    }
    const params = new URLSearchParams();
    params.set("status", CLAIM_FILTER_PARAM[filter]);
    if (query) params.set("q", query);
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await deps.api<ClaimPageResponse>(`/api/claims?${params.toString()}`, {}, siteId);
      if (request !== claimRequest.current) return;
      setClaims((current) => append ? [...current, ...(result.claims || [])] : (result.claims || []));
      setPageMeta(result.page || { hasMore: false, nextCursor: null });
      setTotal(result.total ?? null);
    } catch (loadError) {
      if (request !== claimRequest.current) return;
      if (append) setMoreError(true);
      else setError(errorMessage(loadError, "Couldn't load claims"));
    } finally {
      if (request === claimRequest.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [deps, filter, query, siteId]);

  useEffect(() => {
    void loadClaims();
    return () => { claimRequest.current += 1; };
  }, [loadClaims]);

  const loadSupport = useCallback(async (redemptionId: string, silent = false) => {
    const request = detailRequest.current;
    try {
      const result = await deps.api<ClaimSupportResponse>(
        `/api/claims/${encodeURIComponent(normalizedClaimId(redemptionId))}/support`, {}, siteId);
      if (request !== detailRequest.current || redemptionId !== selectedIdRef.current) return;
      setSupport(result.support || null);
      if (!silent) {
        setSupportStatus("");
        setSupportError(false);
      }
    } catch (error) {
      if (request !== detailRequest.current || redemptionId !== selectedIdRef.current) return;
      if (!silent) {
        setSupportStatus("Couldn't load the support conversation.");
        setSupportError(true);
      }
    }
  }, [deps, siteId]);

  const loadDetail = useCallback(async (redemptionId: string) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError("");
    setDetailStatus("Loading claim details…");
    setSelectedClaim(null);
    setSupport(null);
    setSupportStatus("");
    try {
      const result = await deps.api<ClaimDetailResponse>(
        `/api/claims/${encodeURIComponent(normalizedClaimId(redemptionId))}`, {}, siteId);
      if (request !== detailRequest.current) return;
      setSelectedClaim(result.claim || null);
      setDetailStatus("Claim details loaded.");
      await loadSupport(redemptionId);
    } catch (error) {
      if (request !== detailRequest.current) return;
      setDetailError("Couldn't load this claim. Try again.");
      setDetailStatus("");
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }, [deps, loadSupport, siteId]);

  useEffect(() => {
    if (!detailOpen || !selectedId || support?.status !== "open") return;
    const refresh = () => {
      if (document.visibilityState === "visible" && !supportBusy.current) void loadSupport(selectedId, true);
    };
    const timer = setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [detailOpen, loadSupport, selectedId, support?.status]);

  const openDetail = (claim: RewardClaim, trigger: HTMLButtonElement) => {
    const id = claimSourceId(claim);
    detailTrigger.current = trigger;
    detailRequest.current += 1;
    selectedIdRef.current = id;
    setSelectedId(id);
    setSelectedClaim(claim as ClaimDetail);
    setSupport(claim.support && "messages" in claim.support ? claim.support as ClaimSupport : null);
    setDetailOpen(true);
    void loadDetail(id);
  };

  const closeDetail = () => {
    detailRequest.current += 1;
    selectedIdRef.current = "";
    setDetailOpen(false);
    setSelectedId("");
    setSelectedClaim(null);
    setSupport(null);
    setDetailStatus("");
    setDetailError("");
    setSupportStatus("");
    setReply("");
  };

  const updateClaim = async (claim: RewardClaim, action: "cancel" | "complete", detail = false) => {
    const id = claimSourceId(claim);
    setActionBusy(action);
    try {
      await deps.api(`/api/claims/${encodeURIComponent(normalizedClaimId(id))}/transition`, {
        method: "POST",
        body: JSON.stringify({ action, expectedStatus: "submitted" }),
      }, siteId);
      await loadClaims();
      if (detail && id === selectedIdRef.current) await loadDetail(id);
    } catch (error) {
      const message = feedbackText(error, "Something went wrong. Try again.");
      if (detail) setDetailError(message);
      notify(message, "error");
    } finally {
      setActionBusy("");
    }
  };

  const askTransition = (claim: RewardClaim, action: "cancel" | "complete", detail = false) => {
    const cancelling = action === "cancel";
    setConfirm({
      title: cancelling ? "Cancel claim" : "Complete claim",
      description: cancelling
        ? "This restores the member’s credits and returns one item to stock."
        : "This marks the reward claim as completed.",
      confirmText: cancelling ? "Cancel claim" : "Complete claim",
      destructive: cancelling,
      onConfirm: () => updateClaim(claim, action, detail),
    });
  };

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (supportBusy.current || !selectedId) return;
    const message = reply.trim();
    if (!message) {
      setSupportStatus("Write a reply first.");
      setSupportError(true);
      document.getElementById("cr-claim-support-message")?.focus();
      return;
    }
    const id = selectedId;
    supportBusy.current = true;
    setActionBusy("reply");
    try {
      const result = await deps.api<ClaimSupportResponse>(
        `/api/claims/${encodeURIComponent(normalizedClaimId(id))}/support/messages`,
        { method: "POST", body: JSON.stringify({ message }) },
        siteId,
      );
      if (id !== selectedIdRef.current) return;
      setSupport(result.support || null);
      setReply("");
      setSupportStatus("Reply sent.");
      setSupportError(false);
    } catch (error) {
      if (id === selectedIdRef.current) {
        setSupportStatus(feedbackText(error, "Something went wrong. Try again."));
        setSupportError(true);
        notify(feedbackText(error, "Something went wrong. Try again."), "error");
      }
    } finally {
      supportBusy.current = false;
      setActionBusy("");
    }
  };

  const resolveSupport = async () => {
    if (supportBusy.current || !selectedId) return;
    const id = selectedId;
    supportBusy.current = true;
    setActionBusy("resolve");
    try {
      const result = await deps.api<ClaimSupportResponse>(
        `/api/claims/${encodeURIComponent(normalizedClaimId(id))}/support/resolve`,
        { method: "POST" },
        siteId,
      );
      if (id !== selectedIdRef.current) return;
      setSupport(result.support || null);
      await loadClaims();
    } catch (error) {
      if (id === selectedIdRef.current) {
        setSupportStatus(feedbackText(error, "Something went wrong. Try again."));
        setSupportError(true);
      }
    } finally {
      supportBusy.current = false;
      setActionBusy("");
    }
  };

  const selectedClaimActions = selectedClaim?.allowedActions || [];
  const claimSupportOpen = support?.status === "open";
  const showSupportReply = claimSupportOpen && support?.canReply !== false;
  const empty = error ? null : query
    ? { title: "No matching claims", body: "Try a different member or reward name." }
    : CLAIM_EMPTY[filter];

  return <div className="cr-react-grid">
    <Card id="cr-redemptions">
      <CardHeader>
        <CardTitle>Reward claims</CardTitle>
        <p className="v3-head-sub">Reward claims are member-submitted redemptions. Complete or cancel pending claims only from this site's authenticated memberships.</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="cr-claim-filters" role="group" aria-label="Filter claims">
          {(["all", "pending", "needs_attention", "completed"] as ClaimFilter[]).map((key) => {
            const label = key === "needs_attention" ? "Needs attention" : key === "pending" ? "Pending" : key === "completed" ? "Completed" : "All";
            return <Button key={key} type="button" size="sm" variant="outline" className={filter === key ? "is-active" : undefined}
              aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</Button>;
          })}
        </div>
        <div className="cr-list-toolbar cr-react-field max-w-md">
          <Label htmlFor="cr-claim-search">Search claims</Label>
          <Input id="cr-claim-search" type="search" placeholder="Search…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {loading ? <div role="status" aria-live="polite" aria-busy="true" className="grid gap-3">
          <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
        </div> : error ? <EmptyState title="Couldn't load claims" body="Reward claims for the selected site could not be loaded."
          action={<Button type="button" onClick={() => void loadClaims()}>Try again</Button>} /> :
          claims.length > 0 ? <>
            <DataTable label="Reward claims">
              <thead><tr><th>Member</th><th>Reward</th><th className="num">Cost</th><th>Status</th><th>Claimed</th><th className="ta-r">Actions</th></tr></thead>
              <tbody>{claims.map((claim) => {
                const id = claimSourceId(claim);
                const actions = claim.allowedActions || [];
                const displayStatus = claimDisplayStatus(claim);
                return <tr key={claim.id}>
                  <td data-label="Member"><b>{claim.subject?.displayName || "Member"}</b></td>
                  <td data-label="Reward">{claim.reward?.name || claim.source?.title || "Reward"}</td>
                  <td data-label="Cost" className="num"><b>{Number(claim.reward?.cost) || 0}</b><span className="hint">credits</span></td>
                  <td data-label="Status">
                    <Badge variant={claim.status === "submitted" ? "warning" : claim.status === "cancelled" ? "destructive" : "success"}>{displayStatus}</Badge>
                    {claim.support?.status === "open" && <span className="v3-chip v3-chip--pending" title="The member asked for help with this claim">Support open</span>}
                  </td>
                  <td data-label="Claimed" title={dateLabel(claim.submittedAt)}>{relativeLabel(claim.submittedAt)}</td>
                  <td data-label="Actions" className="ta-r"><div className="cr-row-actions">
                    <Button type="button" size="sm" variant="outline" aria-controls="cr-claim-detail-drawer" aria-expanded={detailOpen && selectedId === id}
                      onClick={(event) => openDetail(claim, event.currentTarget)}>Details</Button>
                    {actions.includes("cancel") && <Button type="button" size="sm" variant="outline" onClick={() => askTransition(claim, "cancel")}>Cancel</Button>}
                    {actions.includes("complete") && <Button type="button" size="sm" onClick={() => askTransition(claim, "complete")}>Complete</Button>}
                  </div></td>
                </tr>;
              })}</tbody>
            </DataTable>
            <div className="v3-table-foot flex items-center justify-between">
              <span aria-live="polite">
                {loadingMore ? "Loading…" : `Showing ${claims.length}${total != null ? ` of ${total}` : pageMeta?.hasMore ? "" : ` of ${claims.length}`} claims${pageMeta?.hasMore && total == null ? " · more available" : ""}`}
              </span>
              {pageMeta?.hasMore && <Button type="button" size="sm" variant="outline" disabled={loadingMore}
                onClick={() => void loadClaims(pageMeta.nextCursor || undefined, true)}>
                {moreError ? "Couldn't load more — retry" : loadingMore ? "Loading…" : "Load more"}
              </Button>}
            </div>
          </> : <EmptyState title={empty?.title || "No claims yet"} body={empty?.body || "Claims will appear after a member redeems a shop item."} />}
      </CardContent>
    </Card>
    <Dialog open={detailOpen} onOpenChange={(open) => { if (!open) closeDetail(); }}>
      <DialogContent id="cr-claim-detail-drawer" className="yr-react cr-react-claim-drawer" aria-describedby="cr-claim-detail-description"
        onCloseAutoFocus={(event) => { event.preventDefault(); detailTrigger.current?.focus(); }}>
        <DialogHeader>
          <p className="v3-head-sub v3-head-sub--mono">Reward claim</p>
          <DialogTitle id="cr-claim-detail-title">{selectedClaim?.reward?.name || "Claim details"}</DialogTitle>
          <DialogDescription id="cr-claim-detail-description">{selectedClaim ? `${selectedClaim.subject?.displayName || "Member"} · ${claimDisplayStatus(selectedClaim)}` : "Claim details"}</DialogDescription>
        </DialogHeader>
        <div className="cr-react-dialog-body mt-4" aria-busy={detailLoading}>
          <StatusText error={Boolean(detailError)}>{detailError || detailStatus}</StatusText>
          {detailLoading ? <div role="status"><Skeleton className="h-32 w-full" /></div> : selectedClaim && <>
            <dl className="cr-member-facts">
              <div><dt>Member</dt><dd>{selectedClaim.subject?.displayName || "Member"}</dd></div>
              <div><dt>Reward</dt><dd>{selectedClaim.reward?.name || selectedClaim.source?.title || "Reward"}</dd></div>
              <div><dt>Claimed</dt><dd>{dateLabel(selectedClaim.submittedAt)}</dd></div>
              <div><dt>Status</dt><dd>{claimDisplayStatus(selectedClaim)}</dd></div>
            </dl>
            <section>
              <h3>Fulfillment data</h3>
              <p className="hint">{selectedClaim.fulfillmentDetails?.note || "No private fulfillment details are stored for reward claims yet."}</p>
            </section>
            <section>
              <h3>History</h3>
              {selectedClaim.history?.length ? <ol className="cr-member-history-list" role="list">
                {selectedClaim.history.map((item, index) => <li key={`${item.createdAt}-${index}`}>
                  <div><strong>{item.label || item.action || "Claim updated"}</strong>{item.actor?.displayName && <span> · {item.actor.displayName}</span>}</div>
                  <time dateTime={item.createdAt} title={dateLabel(item.createdAt)}>{relativeLabel(item.createdAt)}</time>
                </li>)}
              </ol> : <p className="hint">No claim history.</p>}
            </section>
            {support && <section className="cr-claim-support">
              <div className="cr-claim-support-head">
                <h3>Viewer support request</h3>
                <Badge variant={claimSupportOpen ? "warning" : "success"}>{support.statusLabel || (claimSupportOpen ? "Open" : "Resolved")}</Badge>
              </div>
              <p className="hint">Issue: {support.issueLabel || "Other"}</p>
              <ol className="cr-claim-support-thread" role="list" aria-live="polite">
                {(support.messages || []).map((message) => <li className={`cr-claim-support-msg cr-claim-support-msg--${message.senderType}`} key={message.id}>
                  <div><strong>{message.senderType === "creator" ? "You" : message.senderName}</strong><span>{message.message}</span></div>
                  <time dateTime={message.createdAt} title={dateLabel(message.createdAt)}>{relativeLabel(message.createdAt)}</time>
                </li>)}
              </ol>
              <StatusText error={supportError}>{supportStatus || (!claimSupportOpen ? support.resolvedAt ? `Resolved ${relativeLabel(support.resolvedAt)}. Replies are closed.` : "Resolved. Replies are closed." : "")}</StatusText>
              {showSupportReply && <form className="cr-claim-support-reply" onSubmit={(event) => void sendReply(event)}>
                <Label className="sr-only" htmlFor="cr-claim-support-message">Reply to the viewer</Label>
                <Textarea id="cr-claim-support-message" name="message" maxLength={2_000} rows={3} placeholder="Write a reply…" required value={reply} onChange={(event) => setReply(event.target.value)} />
                <div className="cr-drawer-actions">
                  {support.canReply !== false && <Button type="button" size="sm" variant="outline" onClick={() => void resolveSupport()} disabled={Boolean(actionBusy)}>{actionBusy === "resolve" ? "Resolving…" : "Mark resolved"}</Button>}
                  <Button id="cr-claim-support-send" type="submit" size="sm" disabled={Boolean(actionBusy)}>{actionBusy === "reply" ? "Sending…" : "Reply"}</Button>
                </div>
              </form>}
            </section>}
            <div className="cr-drawer-actions" id="cr-claim-detail-actions">
              {selectedClaimActions.includes("cancel") && <Button type="button" size="sm" variant="outline" onClick={() => askTransition(selectedClaim, "cancel", true)}>Cancel claim</Button>}
              {selectedClaimActions.includes("complete") && <Button type="button" size="sm" onClick={() => askTransition(selectedClaim, "complete", true)}>Complete claim</Button>}
            </div>
          </>}
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog action={confirm} close={() => setConfirm(null)} />
  </div>;
}

function RulesTab({
  data,
  siteId,
  deps,
  notify,
  reload,
}: {
  data: CreditsStatus;
  siteId: string;
  deps: PageDependencies;
  notify: (message: string, kind?: Toast["kind"]) => void;
  reload: () => Promise<unknown>;
}) {
  const capabilities = data.capabilities || {};
  const canManage = capabilities.manageRewards !== false;
  const canCreateKickReward = capabilities.manageConnections !== false;
  const mappings = data.mappings || [];
  const usage = data.usage || EMPTY_USAGE;
  const limits = data.limits || EMPTY_LIMITS;
  const rewardAtLimit = usage.rewardMappings != null && limits.rewardMappings != null && usage.rewardMappings >= limits.rewardMappings;
  const [checkinActive, setCheckinActive] = useState(false);
  const [checkinAmount, setCheckinAmount] = useState("50");
  const [checkinStatus, setCheckinStatus] = useState("");
  const [checkinError, setCheckinError] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [formStatus, setFormStatus] = useState("");
  const [formError, setFormError] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortDirection>("cost");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [mappingDraft, setMappingDraft, clearMappingDraft, mappingDraftRestored] = useStoredDraft("reward", {
    id: "",
    kickRewardId: "",
    title: "",
    cost: "",
    credits: "",
  });
  const [kickDraft, setKickDraft, clearKickDraft, kickDraftRestored] = useStoredDraft("reward-create", {
    title: "",
    cost: "100",
    credits: "50",
    backgroundColor: "#00e701",
    description: "",
  });

  useClearSuccessStatus(checkinStatus, checkinError, setCheckinStatus);
  useClearSuccessStatus(formStatus, formError, setFormStatus);

  useEffect(() => {
    if (mappingDraftRestored || kickDraftRestored) setFormStatus("Draft restored.");
  }, [kickDraftRestored, mappingDraftRestored]);

  useEffect(() => {
    let current = true;
    void deps.api<{ dailyCheckin?: { active?: boolean; amount?: number } }>("/api/credits/earning-rules", {}, siteId)
      .then((result) => {
        if (!current) return;
        setCheckinActive(Boolean(result.dailyCheckin?.active));
        setCheckinAmount(String(result.dailyCheckin?.amount ?? 50));
      })
      .catch((error: unknown) => {
        if (!current) return;
        const message = feedbackText(error, "Couldn't load daily check-in settings.");
        setCheckinStatus(message);
        setCheckinError(true);
        notify(message, "error");
      });
    return () => { current = false; };
  }, [deps, notify, siteId]);

  useEffect(() => {
    const editId = new URLSearchParams(location.search).get("edit");
    const mapping = mappings.find((item) => item.id === editId);
    if (mapping) {
      setMappingDraft({
        id: mapping.id,
        kickRewardId: mapping.kick_reward_id,
        title: mapping.kick_reward_title,
        cost: String(mapping.kick_reward_cost),
        credits: String(mapping.credits),
      });
      setCreateOpen(false);
      setManualOpen(true);
      setFormStatus("Editing way to earn.");
    }
    const formId = location.hash.slice(1);
    if (formId === "cr-reward-form") setManualOpen(true);
    if (formId === "cr-reward-create-form") setCreateOpen(true);
  }, [mappings, setMappingDraft]);

  const filteredMappings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = mappings.filter((mapping) =>
      `${mapping.kick_reward_title} ${mapping.kick_reward_id} ${mapping.kick_reward_cost} ${mapping.credits}`.toLowerCase().includes(normalized));
    return filtered.sort((left, right) => {
      if (sort === "cost") return (right.kick_reward_cost || 0) - (left.kick_reward_cost || 0);
      if (sort === "stock") return (right.credits || 0) - (left.credits || 0);
      return Number(right.active) - Number(left.active);
    });
  }, [mappings, query, sort]);
  const pageCount = Math.max(1, Math.ceil(filteredMappings.length / 10));
  const visibleMappings = filteredMappings.slice((page - 1) * 10, page * 10);

  const openForm = (kind: "manual" | "kick", focus = false) => {
    setCreateOpen(kind === "kick");
    setManualOpen(kind === "manual");
    if (focus) setTimeout(() => document.getElementById(kind === "kick" ? "cr-reward-create-title" : "cr-reward-kick-id")?.focus(), 0);
  };

  const editMapping = (mapping: RewardMapping) => {
    const params = new URLSearchParams();
    params.set("edit", mapping.id);
    if (siteId) params.set("siteId", siteId);
    deps.requestDashboardRoute("rewards", "rules", { query: `?${params.toString()}`, force: true });
  };

  const saveCheckin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(checkinAmount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000) {
      setCheckinStatus("Check-in credits must be a whole number from 1 to 1,000.");
      setCheckinError(true);
      notify("Check-in credits must be a whole number from 1 to 1,000.", "error");
      return;
    }
    setCheckinBusy(true);
    setCheckinStatus("");
    setCheckinError(false);
    try {
      const result = await deps.api<{ dailyCheckin?: { active?: boolean; amount?: number } }>("/api/credits/earning-rules", {
        method: "PUT",
        body: JSON.stringify({ dailyCheckin: { active: checkinActive, amount } }),
      }, siteId);
      setCheckinActive(Boolean(result.dailyCheckin?.active));
      setCheckinAmount(String(result.dailyCheckin?.amount ?? amount));
      setCheckinStatus("Daily check-in saved.");
      notify("Daily check-in saved.");
    } catch (error) {
      const message = feedbackText(error, "Couldn't save daily check-in.");
      setCheckinStatus(message);
      setCheckinError(true);
      notify(message, "error");
    } finally {
      setCheckinBusy(false);
    }
  };

  const saveMapping = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("mapping");
    setFormStatus("");
    setFormError(false);
    try {
      await deps.api("/api/credits/rewards", {
        method: "POST",
        body: JSON.stringify({
          id: mappingDraft.id || undefined,
          kickRewardId: mappingDraft.kickRewardId.trim(),
          kickRewardTitle: mappingDraft.title.trim(),
          kickRewardCost: Number(mappingDraft.cost),
          credits: Number(mappingDraft.credits),
        }),
      }, siteId);
      setFormStatus("Way to earn saved.");
      clearMappingDraft();
      setMappingDraft({ id: "", kickRewardId: "", title: "", cost: "", credits: "" });
      await reload();
    } catch (error) {
      const message = feedbackText(error, "Something went wrong. Try again.");
      setFormStatus(message);
      setFormError(true);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  const createKickReward = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("create");
    setFormStatus("");
    setFormError(false);
    try {
      await deps.api("/api/credits/rewards/create", {
        method: "POST",
        body: JSON.stringify({
          title: kickDraft.title.trim(),
          cost: Number(kickDraft.cost),
          credits: Number(kickDraft.credits),
          description: kickDraft.description.trim(),
          backgroundColor: kickDraft.backgroundColor,
        }),
      }, siteId);
      setFormStatus("Kick reward created and linked to credits.");
      clearKickDraft();
      setKickDraft({ title: "", cost: "100", credits: "50", backgroundColor: "#00e701", description: "" });
      await reload();
    } catch (error) {
      const message = feedbackText(error, "Something went wrong. Try again.");
      setFormStatus(message);
      setFormError(true);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  const toggleMapping = async (mapping: RewardMapping, active: boolean) => {
    if (!active) {
      setConfirm({
        title: "Disable way to earn",
        description: "This disables the way to earn; credit activity is retained.",
        confirmText: "Confirm",
        onConfirm: async () => {
          setBusy(mapping.id);
          try {
            await deps.api(`/api/credits/rewards/${encodeURIComponent(mapping.id)}`, { method: "DELETE" }, siteId);
            await reload();
          } catch (error) {
            const message = feedbackText(error, "Something went wrong. Try again.");
            setFormStatus(message);
            setFormError(true);
          } finally {
            setBusy("");
          }
        },
      });
      return;
    }
    setBusy(mapping.id);
    try {
      await deps.api("/api/credits/rewards", {
        method: "POST",
        body: JSON.stringify({
          id: mapping.id,
          kickRewardId: mapping.kick_reward_id,
          kickRewardTitle: mapping.kick_reward_title,
          kickRewardCost: mapping.kick_reward_cost,
          credits: mapping.credits,
        }),
      }, siteId);
      await reload();
    } catch (error) {
      const message = feedbackText(error, "Something went wrong. Try again.");
      setFormStatus(message);
      setFormError(true);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  };

  return <div className="cr-react-grid">
    <Card id="cr-checkin">
      <CardHeader><CardTitle>Daily check-in</CardTitle><p className="v3-head-sub">Signed-in members can check in once a day (UTC) to earn credits. Works without Kick.</p></CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(event) => void saveCheckin(event)}>
          <label className="cr-auth-option" htmlFor="cr-checkin-active">
            <Checkbox id="cr-checkin-active" checked={checkinActive} disabled={!canManage} onCheckedChange={(checked) => setCheckinActive(checked === true)} />
            <span>Turn on daily check-in</span>
          </label>
          <div className="cr-react-field max-w-sm">
            <Label htmlFor="cr-checkin-amount">Credits per check-in</Label>
            <Input id="cr-checkin-amount" type="number" min={1} max={1_000} step={1} value={checkinAmount} disabled={!canManage} onChange={(event) => setCheckinAmount(event.target.value)} required />
            <span className="hint">Credits awarded once per UTC day.</span>
          </div>
          <p className="hint">Want to reward someone directly? <a href="/dashboard/audience/members">Award credits from Members.</a></p>
          <StatusText error={checkinError}>{checkinStatus}</StatusText>
          {canManage && <Button className="w-fit" type="submit" disabled={checkinBusy}>{checkinBusy ? "Saving…" : "Save daily check-in"}</Button>}
        </form>
      </CardContent>
    </Card>
    <Card id="cr-rewards">
      <CardHeader className="cr-react-head">
        <div><CardTitle>Ways to earn</CardTitle><p className="v3-head-sub">{numberOr(usage.rewardMappings, "—")} / {numberOr(limits.rewardMappings, "—")} ways to earn
          {rewardAtLimit && <> · <a href="/dashboard/settings/billing">Billing limit reached — upgrade plan</a></>}
        </p></div>
        {canManage && <Button id="cr-add-mapping" type="button" variant={rewardAtLimit ? "outline" : "default"} disabled={rewardAtLimit}
          title={rewardAtLimit ? "Upgrade your plan to add more ways to earn" : undefined}
          onClick={() => openForm(canCreateKickReward ? "kick" : "manual", true)}>
          {canCreateKickReward ? "+ Create Kick reward" : "+ Add way to earn"}
        </Button>}
      </CardHeader>
      <CardContent className="grid gap-4">
        {mappings.length === 0 ? <EmptyState title="No ways to earn yet" body="Set how Kick rewards award credits to your members."
          action={canManage && <Button type="button" onClick={() => openForm(canCreateKickReward ? "kick" : "manual", true)} disabled={rewardAtLimit}>
            {canCreateKickReward ? "Create Kick reward" : "Add way to earn"}
          </Button>} /> : <>
          <div className="cr-react-grid cr-react-grid--two">
            <div className="cr-react-field"><Label htmlFor="cr-mapping-search">Search ways to earn</Label><Input id="cr-mapping-search" value={query} placeholder="Search ways to earn…" onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></div>
            <div className="cr-react-field"><Label htmlFor="cr-mapping-sort">Sort by</Label>
              <select id="cr-mapping-sort" className="v3-select" value={sort} onChange={(event) => setSort(event.target.value as SortDirection)}>
                <option value="cost">Kick cost</option><option value="stock">Credits</option><option value="active">Active first</option>
              </select>
            </div>
          </div>
          {visibleMappings.length ? <DataTable label="Ways to earn">
            <thead><tr><th>Kick reward</th><th>Type / condition</th><th>Credits awarded</th><th>Status</th><th className="ta-r">Actions</th></tr></thead>
            <tbody>{visibleMappings.map((mapping) => <tr key={mapping.id}>
              <td data-label="Kick reward"><b>{mapping.kick_reward_title}</b><br /><span className="hint">{mapping.kick_reward_id}</span></td>
              <td data-label="How it works" className="hint">Kick reward used · {mapping.kick_reward_cost} points</td>
              <td data-label="Credits" className="num"><b>+{mapping.credits} credits</b></td>
              <td data-label="Available"><label className="sr-only" htmlFor={`reward-toggle-${mapping.id}`}>Make {mapping.kick_reward_title} available</label>
                <Switch id={`reward-toggle-${mapping.id}`} checked={mapping.active} disabled={!canManage || busy === mapping.id} onCheckedChange={(checked) => void toggleMapping(mapping, checked)} />
              </td>
              <td data-label="Actions" className="ta-r"><div className="cr-row-actions">
                {canManage && <><Button type="button" size="sm" variant="outline" onClick={() => editMapping(mapping)}>Edit</Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => void toggleMapping(mapping, false)}>Disable</Button></>}
              </div></td>
            </tr>)}</tbody>
          </DataTable> : <EmptyState title="No matching ways to earn" body="No way to earn matches this search." />}
          {filteredMappings.length > 10 && <div className="v3-table-foot flex items-center justify-between">
            <span>{filteredMappings.length} ways to earn</span><div className="cr-react-actions">
              <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <span aria-live="polite">Page {page} of {pageCount}</span>
              <Button type="button" size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button>
            </div>
          </div>}
        </>}
        {canManage && <div className="cr-react-grid cr-react-grid--two">
          {canCreateKickReward && <details className="cr-advanced" open={createOpen} onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) setManualOpen(false); }}>
            <summary>Create a Kick reward <span className="cr-primary-badge">Recommended</span></summary>
            <form id="cr-reward-create-form" className="cr-react-form mt-4" onSubmit={(event) => void createKickReward(event)}>
              <div className="cr-react-field"><Label htmlFor="cr-reward-create-title">Title</Label><Input id="cr-reward-create-title" name="title" required maxLength={50} placeholder="e.g. Claim 100 Credits" value={kickDraft.title} onChange={(event) => setKickDraft((current) => ({ ...current, title: event.target.value }))} /><span className="hint">Title displayed in your Kick stream channel points menu.</span></div>
              <div className="cr-react-field"><Label htmlFor="cr-reward-create-cost">Kick point cost</Label><Input id="cr-reward-create-cost" name="cost" type="number" min={1} value={kickDraft.cost} onChange={(event) => setKickDraft((current) => ({ ...current, cost: event.target.value }))} required /><span className="hint">Kick channel points the viewer spends on Kick.</span></div>
              <div className="cr-react-field"><Label htmlFor="cr-reward-create-credits">Credits awarded</Label><Input id="cr-reward-create-credits" name="credits" type="number" min={1} value={kickDraft.credits} onChange={(event) => setKickDraft((current) => ({ ...current, credits: event.target.value }))} required /><span className="hint">YourRank credits added to the member balance.</span></div>
              <div className="cr-react-field"><Label htmlFor="cr-reward-create-color">Background color</Label><Input id="cr-reward-create-color" name="backgroundColor" type="color" value={kickDraft.backgroundColor} onChange={(event) => setKickDraft((current) => ({ ...current, backgroundColor: event.target.value }))} /><span className="hint">Button color for this reward in Kick chat.</span></div>
              <div className="cr-react-field cr-react-field--full"><Label htmlFor="cr-reward-create-desc">Description</Label><Input id="cr-reward-create-desc" name="description" type="text" maxLength={200} placeholder="e.g. Earn credits to buy VIP and gifts in our reward shop!" value={kickDraft.description} onChange={(event) => setKickDraft((current) => ({ ...current, description: event.target.value }))} /><span className="hint">Short explanation shown to viewers on Kick.</span></div>
              <div className="cr-react-field cr-react-field--full"><Button id="cr-reward-create-submit" type="submit" disabled={rewardAtLimit || busy === "create"}>{busy === "create" ? "Creating…" : "Create in Kick"}</Button></div>
            </form>
          </details>}
          <details className="cr-advanced" open={manualOpen} onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) setCreateOpen(false); }}>
            <summary>{mappingDraft.id ? "Edit way to earn" : "Add way to earn"}</summary>
            <p className="hint">Find this reward in Kick Creator Dashboard → <strong>Community</strong> → <strong>Channel Points</strong> → <strong>Rewards</strong>, then copy its ID.</p>
            <form id="cr-reward-form" className="cr-react-form mt-4" onSubmit={(event) => void saveMapping(event)}>
              <input type="hidden" id="cr-reward-id" name="id" value={mappingDraft.id} />
              <div className="cr-react-field"><Label htmlFor="cr-reward-kick-id">Kick reward ID</Label><Input id="cr-reward-kick-id" name="kickRewardId" required value={mappingDraft.kickRewardId} onChange={(event) => setMappingDraft((current) => ({ ...current, kickRewardId: event.target.value }))} /></div>
              <div className="cr-react-field"><Label htmlFor="cr-reward-title">Kick reward title</Label><Input id="cr-reward-title" name="title" required value={mappingDraft.title} onChange={(event) => setMappingDraft((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="cr-react-field"><Label htmlFor="cr-reward-cost">Kick point cost</Label><Input id="cr-reward-cost" name="cost" type="number" min={0} required value={mappingDraft.cost} onChange={(event) => setMappingDraft((current) => ({ ...current, cost: event.target.value }))} /></div>
              <div className="cr-react-field"><Label htmlFor="cr-reward-credits">Credits awarded</Label><Input id="cr-reward-credits" name="credits" type="number" min={1} required value={mappingDraft.credits} onChange={(event) => setMappingDraft((current) => ({ ...current, credits: event.target.value }))} /></div>
              <div className="cr-react-field cr-react-field--full cr-react-actions">
                <Button id="cr-reward-submit" type="submit" disabled={rewardAtLimit || busy === "mapping"}>{busy === "mapping" ? "Saving…" : "Save way to earn"}</Button>
                {mappingDraft.id && <Button type="button" variant="outline" onClick={() => { setMappingDraft({ id: "", kickRewardId: "", title: "", cost: "", credits: "" }); clearMappingDraft(); setFormStatus(""); }}>Cancel editing</Button>}
              </div>
            </form>
          </details>
        </div>}
        <StatusText error={formError}>{formStatus}</StatusText>
      </CardContent>
    </Card>
    <ConfirmDialog action={confirm} close={() => setConfirm(null)} />
  </div>;
}

function OverviewTab({ data, siteId, deps, board, notify }: {
  data: CreditsStatus;
  siteId: string;
  deps: PageDependencies;
  board: BoardContext["board"];
  notify: (message: string, kind?: Toast["kind"]) => void;
}) {
  const [days, setDays] = useState("30");
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await deps.api<AnalyticsResponse>(`/api/credits/analytics?days=${days}`, {}, siteId);
      setAnalytics(result);
    } catch {
      setError("Analytics are temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [days, deps, siteId]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const channel = data.channel || {};
  const usage = data.usage || EMPTY_USAGE;
  const limits = data.limits || EMPTY_LIMITS;
  const connected = Boolean(channel.connected ?? channel.externalId);
  const mappings = (data.mappings || []).filter((mapping) => mapping.active).length;
  const items = (data.shopItems || []).filter((item) => item.active).length;
  const claimCount = Number(usage.redemptionsPer30Days) || (data.recentClaims || []).length;
  const openClaims = Number(usage.pendingRedemptions) || 0;
  const setupDone = connected && mappings > 0 && items > 0;
  const publicPageUrl = board?.published && board.slug ? `${location.origin}/${board.slug}` : null;
  const currentSetupStep = !connected
    ? { id: 1, title: "Connect Kick", body: "Link your channel so Kick reward claims become credits here.", href: "/dashboard/site/connections", action: "Connect" }
    : mappings === 0
      ? { id: 2, title: "Add a way to earn", body: "Choose a Kick reward and set how many credits it gives.", href: "/dashboard/rewards/rules", action: "Create way to earn" }
      : { id: 3, title: "Add a shop item", body: "Add something members can claim with their credits.", href: "/dashboard/rewards/shop", action: "Create shop item" };
  const progressSteps = [
    { id: 1, done: connected, label: "Kick connected", pending: "Connect Kick" },
    { id: 2, done: mappings > 0, label: "Way to earn", pending: "Way to earn" },
    { id: 3, done: items > 0, label: "Shop item", pending: "Shop item" },
    { id: 4, done: claimCount > 0, label: "First claim", pending: "First claim" },
  ];
  const currentProgressId = !setupDone
    ? currentSetupStep.id
    : openClaims === 0 && claimCount === 0 ? 4 : null;
  const nextTitle = !setupDone
    ? currentSetupStep.title
    : openClaims > 0
      ? `${openClaims} ${openClaims === 1 ? "claim needs" : "claims need"} action`
      : claimCount === 0 ? "Get your first claim" : "You're all caught up";
  const nextBody = !setupDone
    ? currentSetupStep.id === 1 && !data.capabilities?.manageConnections
      ? "Ask the site owner to connect Kick."
      : currentSetupStep.body
    : openClaims > 0
      ? "Complete or cancel claims so members get their rewards."
      : claimCount === 0
        ? "Setup is done. Share your public page with members, or claim your Kick reward on stream to test the full flow."
        : "No claims are waiting. Add more shop items or ways to earn to keep members engaged.";
  const copyPublicPageLink = async () => {
    if (!publicPageUrl) return;
    try {
      await navigator.clipboard.writeText(publicPageUrl);
      notify("Public page link copied.");
    } catch {
      notify("Couldn't copy the link.", "error");
    }
  };
  const nextActions = !setupDone
    ? currentSetupStep.id === 1 && !data.capabilities?.manageConnections
      ? null
      : <a className="btn btn--sm btn--accent" href={currentSetupStep.href}>{currentSetupStep.action}</a>
    : openClaims > 0
      ? <>
          <a className="btn btn--sm btn--accent" href="/dashboard/rewards/redemptions">Review claims</a>
          <a className="btn btn--sm" href="/dashboard/rewards/shop">Add shop item</a>
        </>
      : claimCount === 0
        ? <>
            {publicPageUrl && <button className="btn btn--sm btn--accent" type="button" onClick={() => void copyPublicPageLink()}>Copy public page link</button>}
            <a className={cn("btn btn--sm", !publicPageUrl && "btn--accent")} href="/dashboard/rewards/shop">View shop</a>
          </>
        : <>
            <a className="btn btn--sm btn--accent" href="/dashboard/rewards/shop">Add shop item</a>
            <a className="btn btn--sm" href="/dashboard/rewards/rules">Add a way to earn</a>
          </>;

  const summary = analytics?.summary || {};
  const topItems = analytics?.topItems || [];
  const claimedItems = topItems.filter((item) => Number(item.redemptions) > 0);
  const chartDays = useMemo(() => {
    const totals = new Map<string, { earn: number; spend: number }>();
    for (const row of analytics?.creditsByDay || []) {
      const point = totals.get(row.day) || { earn: 0, spend: 0 };
      if (row.type === "earn") point.earn = row.total;
      if (row.type === "spend") point.spend = row.total;
      totals.set(row.day, point);
    }
    return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [analytics]);
  const chartMax = Math.max(1, ...chartDays.map(([, point]) => point.earn + point.spend));
  const chartTotal = chartDays.reduce((total, [, point]) => total + point.earn + point.spend, 0);
  const usedClaims = Number(usage.redemptionsPer30Days) || 0;
  const claimsLimit = limits.redemptionsPer30Days;
  const usagePercent = claimsLimit == null ? 0 : claimsLimit > 0
    ? Math.min((usedClaims / claimsLimit) * 100, 100)
    : usedClaims > 0 ? 100 : 0;
  const planLimitClauses = [
    claimsLimit == null ? null : `${claimsLimit.toLocaleString()} claims in any rolling 30 days`,
    limits.pendingRedemptions == null ? null : `${limits.pendingRedemptions.toLocaleString()} open claims at once`,
  ].filter((clause): clause is string => Boolean(clause));
  const planUsageInfo = planLimitClauses.length
    ? `Your plan allows ${planLimitClauses.join(" and ")}.`
    : "Your plan limits aren't available.";
  const numberLabel = (value: number | undefined) => (value ?? 0).toLocaleString();

  return <div className="cr-react-grid">
    <Card className="cr-next-step">
      <CardContent>
        <div className="cr-next-row">
          <div className="cr-next-copy">
            <p className="cr-next-eyebrow">Next step</p>
            <h2>{nextTitle}</h2>
            <p>{nextBody}</p>
          </div>
          <div className="cr-next-actions">{nextActions}</div>
        </div>
        {(!setupDone || (openClaims === 0 && claimCount === 0)) && <div className="cr-progress-steps" aria-label="Rewards setup progress">
          {progressSteps.map((step) => {
            const current = currentProgressId === step.id;
            return <span className={cn(step.done && "is-done", current && "is-current")} aria-current={current ? "step" : undefined} key={step.id}>
              {step.done ? `✓ ${step.label}` : current ? `${step.id} · ${step.label}` : step.pending}
            </span>;
          })}
        </div>}
      </CardContent>
    </Card>
    <div className="cr-status-strip">
      <div className="cr-connection-state">
        {connected
          ? <><span className="cr-connection-pill">● Kick connected</span>{channel.name && <span className="cr-connection-name">@{channel.name}</span>}</>
          : data.capabilities?.manageConnections
            ? <a className="cr-connection-link" href="/dashboard/site/connections">Not connected · Connect Kick</a>
            : <span className="cr-connection-muted">Not connected · Owner action required</span>}
      </div>
      <span className="cr-status-divider" aria-hidden="true" />
      <div className="cr-plan-usage">
        <span className="cr-plan-label">Plan usage</span>
        {claimsLimit != null && <div
          className="cr-plan-progress"
          role="meter"
          aria-label="Claims used in the last 30 days"
          aria-valuemin={0}
          aria-valuemax={claimsLimit}
          aria-valuenow={Math.min(usedClaims, claimsLimit)}
        ><span style={{ width: `${usagePercent}%` }} /></div>}
        <span className="cr-plan-count">{usedClaims.toLocaleString()} of {claimsLimit == null ? "—" : claimsLimit.toLocaleString()} claims · last 30 days</span>
        <InfoTip label="Plan usage" info={planUsageInfo} />
      </div>
      <a className="cr-plan-manage" href="/dashboard/settings/billing">Manage plan</a>
    </div>
    <section className="cr-overview-activity" aria-labelledby="cr-activity-title">
      <div className="cr-activity-header">
        <h2 id="cr-activity-title">Activity · Last {days} days</h2>
        <div className="v3-range-filter">
          <Label className="sr-only" htmlFor="cr-analytics-days">Date range</Label>
          <select id="cr-analytics-days" value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </select>
        </div>
      </div>
      {error && <StatusText error>{error}</StatusText>}
      <div className="cr-overview-kpis">
        <Metric
          label="Credits earned"
          info="Credits members received in this period from every source — Kick rewards, daily check-ins and manual adjustments — net of refunds."
          value={loading ? "—" : numberLabel(summary.periodEarned)}
          scope={`Last ${days} days`}
          foot={!loading ? <>All time <strong>{numberLabel(summary.allTimeEarned)}</strong></> : undefined}
        />
        <Metric
          label="Credits spent"
          info="Credits members used to claim shop items in this period, net of revoked spends."
          value={loading ? "—" : numberLabel(summary.periodSpent)}
          scope={`Last ${days} days`}
          foot={!loading ? <>All time <strong>{numberLabel(summary.allTimeSpent)}</strong></> : undefined}
        />
        <Metric
          label="Claims"
          info="Shop item claims submitted in this period, excluding cancelled ones."
          value={loading ? "—" : numberLabel(summary.redemptionsTotal)}
          scope={`Last ${days} days`}
          foot={!loading ? openClaims > 0
            ? <>{openClaims.toLocaleString()} open right now · <a href="/dashboard/rewards/redemptions">Review</a></>
            : "No open claims" : undefined}
        />
        <Metric
          label="Credits held by members"
          info="Total credits all members hold right now."
          value={loading ? "—" : numberLabel(summary.viewerBalance)}
          scope="Right now"
          scopeTone="now"
          foot={!loading ? "Not affected by the date range" : undefined}
        />
      </div>
      <div className="cr-overview-two">
        <Card className="cr-overview-card">
          <CardHeader><CardTitle>Most claimed items</CardTitle><p className="v3-head-sub">Last {days} days</p></CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-24 w-full" /> : claimedItems.length
              ? <DataTable label="Top items"><thead><tr><th>Item</th><th className="num">Claims</th><th className="num">Credits spent</th></tr></thead>
                  <tbody>{claimedItems.map((item) => <tr key={item.id}><td data-label="Item">{item.name}</td><td data-label="Claims" className="num">{item.redemptions.toLocaleString()}</td><td data-label="Credits spent" className="num">{item.credits_spent.toLocaleString()}</td></tr>)}</tbody></DataTable>
              : <CompactEmpty
                  icon={<ShoppingBag size={18} />}
                  title="No items claimed yet"
                  body={items > 0 ? `You have ${items} shop ${items === 1 ? "item" : "items"}. They'll rank here once members claim them.` : "Add a shop item so members have something to claim."}
                  action={<a className="btn btn--sm" href="/dashboard/rewards/shop">{items > 0 ? "View shop" : "Create shop item"}</a>}
                />}
          </CardContent>
        </Card>
        <Card className="cr-overview-card">
          <CardHeader><CardTitle>Credits by day</CardTitle><p className="v3-head-sub">Earned vs spent · Last {days} days</p></CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-40 w-full" /> : chartDays.length
              ? <>
                  <div className="cr-react-chart" role="img" aria-label={`Bar chart of credits across ${chartDays.length} days with activity. Total: ${chartTotal} credits.`}>
                    {chartDays.map(([day, point]) => <div className="cr-react-chart-column" key={day} title={`${new Date(day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${point.earn + point.spend} (${point.earn} earned, ${point.spend} spent)`}>
                      <div className="cr-react-chart-earn" style={{ height: `${(point.earn / chartMax) * 100}%` }} />
                      <div className="cr-react-chart-spend" style={{ height: `${(point.spend / chartMax) * 100}%` }} />
                    </div>)}
                  </div>
                  <div className="cr-chart-legend">
                    <span><i className="cr-react-chart-earn" />Earned</span>
                    <span><i className="cr-react-chart-spend" />Spent</span>
                  </div>
                </>
              : <CompactEmpty
                  icon={<ChartLine size={18} />}
                  title={`No credit activity in the last ${days} days`}
                  body="The chart appears after members earn or spend credits."
                  action={days !== "90" ? <button className="btn btn--sm" type="button" onClick={() => setDays("90")}>Show last 90 days</button> : undefined}
                />}
          </CardContent>
        </Card>
      </div>
    </section>
  </div>;
}

export function RewardsPage({ tab, dependencies }: PageProps) {
  const deps = useMemo(() => ({ ...DEFAULT_DEPENDENCIES, ...dependencies }), [dependencies]);
  const [data, setData] = useState<CreditsStatus>(EMPTY_STATUS);
  const [siteId, setSiteId] = useState("");
  const [board, setBoard] = useState<BoardContext["board"]>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [oauth, setOAuth] = useState<OAuthFeedback | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string, kind: Toast["kind"] = "success") => {
    setToast({ message, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4_000);
  }, []);

  const showPage = useCallback((isLoading: boolean) => {
    const root = document.getElementById("cr-app");
    const spinner = document.getElementById("cr-loading");
    const empty = document.getElementById("cr-empty");
    if (root) root.hidden = isLoading;
    if (spinner) spinner.hidden = !isLoading;
    if (empty) empty.hidden = true;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    showPage(true);
    try {
      const shell = await deps.loadBoardShell();
      setBoard(shell.board);
      const selectedSiteId = new URLSearchParams(location.search).get("siteId") || shell.activeSiteId;
      setSiteId(selectedSiteId);
      const result = await deps.api<CreditsStatus>("/api/credits/status", {}, selectedSiteId);
      setData(result);
      setLoading(false);
      showPage(false);
      signalBoot();
      return { selectedSiteId, result };
    } catch (error) {
      setLoadError(errorMessage(error, "Your rewards data could not be loaded."));
      setLoading(false);
      showPage(false);
      signalBoot();
      return null;
    }
  }, [deps, showPage]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const error = params.get("error");
    const connected = params.get("kick_connected") === "1";
    const deliveryFailed = params.get("kick_delivery") === "failed";
    if (error || connected) {
      setOAuth({ error, connected, deliveryFailed });
      const clean = new URL(location.href);
      clean.searchParams.delete("error");
      clean.searchParams.delete("kick_connected");
      clean.searchParams.delete("kick_delivery");
      history.replaceState({}, "", `${clean.pathname}${clean.search}${clean.hash}`);
    }
    void load();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      const root = document.getElementById("cr-app");
      if (root) root.hidden = true;
      const spinner = document.getElementById("cr-loading");
      if (spinner) spinner.hidden = true;
    };
  }, [load]);

  return <div className="yr-react cr-react-rewards">
    {loading ? <LoadingPage /> : loadError ? (
      <section className="v3-empty" role="alert">
        <h2>Couldn't load your credits dashboard</h2>
        <p>{loadError || "Your rewards data could not be loaded."}</p>
        <Button type="button" onClick={() => void load()}>Try again</Button>
      </section>
    ) : <>
      <RewardsHead tab={tab} />
      {tab === "channel" && <ChannelTab data={data} siteId={siteId} oauth={oauth} deps={deps} notify={notify} reload={load} />}
      {tab === "overview" && <OverviewTab data={data} siteId={siteId} deps={deps} board={board} notify={notify} />}
      {tab === "rules" && <RulesTab data={data} siteId={siteId} deps={deps} notify={notify} reload={load} />}
      {tab === "shop" && <ShopTab data={data} siteId={siteId} deps={deps} notify={notify} reload={load} />}
      {tab === "redemptions" && <ClaimsTab siteId={siteId} deps={deps} notify={notify} />}
    </>}
    <ToastRegion toast={toast} />
  </div>;
}
