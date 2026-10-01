import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { adminApi, AdminApiError } from "./api";
import type {
  AdminIdentity,
  AdminLead,
  AdminPageProps,
  AdminPayment,
  AdminStats,
  AdminUser,
  AuditEvent,
  FeatureFlag,
  SupportMessage,
} from "./types";

type TabKey = "users" | "leads" | "payments" | "support" | "features" | "audit" | "identity";
type RowAction = "suspend" | "free" | "starter" | "pro" | "reset-link";
type NoticeTone = "info" | "success" | "error";
type Notice = { message: string; tone: NoticeTone };
type DialogState =
  | {
      kind: "confirm";
      title: string;
      description: string;
      confirmLabel: string;
      danger?: boolean;
      resolve: (value: boolean) => void;
    }
  | {
      kind: "prompt";
      title: string;
      description: string;
      confirmLabel: string;
      placeholder?: string;
      inputType?: "text" | "number";
      value: string;
      resolve: (value: string | null) => void;
    }
  | null;

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "users", label: "Users" },
  { key: "leads", label: "Leads" },
  { key: "payments", label: "Payments" },
  { key: "support", label: "Support" },
  { key: "features", label: "Features" },
  { key: "audit", label: "Audit" },
  { key: "identity", label: "Identity" },
];

const blankStats: AdminStats = { users: 0, paid: 0, leads: 0, revenue: 0 };

function formatWhen(value: number | string | null | undefined) {
  if (!value) return "–";
  const date = new Date(Number(value));
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function formatMoney(value: number | string | null | undefined) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function planName(user: AdminUser) {
  const plan = String(user.plan || "free").toLowerCase();
  const active = ["starter", "pro", "team"].includes(plan) && (user.plan_expires_at == null || Number(user.plan_expires_at) > Date.now());
  return active ? plan : "free";
}

function planText(user: AdminUser) {
  const plan = planName(user);
  const paid = plan !== "free";
  if (!paid) return "free";
  return `${plan} · ${user.plan_expires_at ? `until ${formatWhen(user.plan_expires_at)}` : "no expiry"}`;
}

function totpText(user: AdminUser) {
  if (!user.totp_enabled) return { label: "off", tone: "muted" };
  if (user.totp_locked_until) return { label: "locked", tone: "bad" };
  return { label: "on", tone: "good" };
}

function isTerminalError(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError && error.kind !== "network";
}

function AdminLoading() {
  return (
    <div id="loading" className="admin-loading" aria-busy="true">
      <div className="mb-18"><div className="skeleton skeleton-text--lg skel-w-160" /><div className="skeleton skeleton-text--sm skel-w-240 mt-8" /></div>
      <div className="stats"><div className="stat"><div className="skeleton skeleton-text skel-w-60" /><div className="skeleton skeleton-text--sm skel-w-50 mt-6" /></div><div className="stat"><div className="skeleton skeleton-text skel-w-40" /><div className="skeleton skeleton-text--sm skel-w-40 mt-6" /></div><div className="stat"><div className="skeleton skeleton-text skel-w-30" /><div className="skeleton skeleton-text--sm skel-w-50 mt-6" /></div><div className="stat"><div className="skeleton skeleton-text skel-w-70" /><div className="skeleton skeleton-text--sm skel-w-80 mt-6" /></div></div>
      <div className="card mt-18"><div className="skeleton skeleton-block skel-h-300" /></div>
    </div>
  );
}

function Topbar({ email, onLogout, busy }: { email: string; onLogout: () => void; busy: boolean }) {
  const target = typeof document === "undefined" ? null : document.getElementById("admin-topbar-controls");
  if (!target) return null;
  return createPortal(
    <>
      <span id="userEmail" className="muted">{email}</span>
      <a className="btn btn--sm btn--ghost" href="/dashboard">Dashboard</a>
      <a
        id="logout"
        className="btn btn--sm btn--ghost"
        href="/login"
        aria-disabled={busy ? "true" : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (!busy) onLogout();
        }}
      >
        Sign out
      </a>
    </>,
    target,
  );
}

function TabList({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.key === active);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex];
    onChange(next.key);
    document.getElementById(`tab-btn-${next.key}`)?.focus();
  };

  return (
    <div className="admin-tabs" role="tablist" aria-label="Admin sections" onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          aria-controls={`tab-${tab.key}`}
          aria-selected={active === tab.key}
          className={`admin-tab${active === tab.key ? " is-on" : ""}`}
          id={`tab-btn-${tab.key}`}
          key={tab.key}
          onClick={() => onChange(tab.key)}
          role="tab"
          tabIndex={active === tab.key ? 0 : -1}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function Stats({ stats }: { stats: AdminStats }) {
  return (
    <div className="admin-stats" aria-label="Overview statistics">
      <div className="admin-stat"><strong id="s_users">{stats.users}</strong><span>accounts</span></div>
      <div className="admin-stat"><strong id="s_pro">{stats.paid}</strong><span>on paid plans</span></div>
      <div className="admin-stat"><strong id="s_leads">{stats.leads}</strong><span>leads</span></div>
      <div className="admin-stat"><strong id="s_rev">{formatMoney(stats.revenue)}</strong><span>revenue (USD)</span></div>
    </div>
  );
}

function UserTable({
  users,
  busyAction,
  onAction,
}: {
  users: AdminUser[];
  busyAction: string | null;
  onAction: (user: AdminUser, action: RowAction) => void;
}) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>Email</th><th>Page</th><th>Plan</th><th>Status</th><th>2FA</th><th>Players</th><th>Joined</th><th>Actions</th></tr>
        </thead>
        <tbody id="usersBody">
          {users.map((user) => {
            const totp = totpText(user);
            const busy = busyAction?.startsWith(`${user.id}:`);
            return (
              <tr key={user.id}>
                <td>{user.email}{user.is_admin ? <span className="admin-pill admin-pill--info ml-6">admin</span> : null}</td>
                <td>{user.slug ? <a href={`/${user.slug}`} target="_blank" rel="noreferrer">/{user.slug}</a> : "–"}</td>
                <td><span className={`admin-pill ${planName(user) === "free" ? "admin-pill--muted" : "admin-pill--good"}`}>{planText(user)}</span></td>
                <td title={user.suspension_reason ? `Reason: ${user.suspension_reason}` : undefined}><span className={`admin-pill ${user.status === "active" ? "admin-pill--good" : "admin-pill--bad"}`}>{user.status}</span></td>
                <td><span className={`admin-pill admin-pill--${totp.tone}`}>{totp.label}</span></td>
                <td className="ta-r">{user.player_count ?? 0}</td>
                <td>{formatWhen(user.created_at)}</td>
                <td>
                  <div className="admin-actions">
                    <Button className="admin-button--tiny" data-act="starter" disabled={busy} onClick={() => onAction(user, "starter")} size="sm" title="Activate/extend Starter 31 days" type="button" variant="outline">+31d Starter</Button>
                    <Button className="admin-button--tiny" data-act="pro" disabled={busy} onClick={() => onAction(user, "pro")} size="sm" title="Activate/extend Pro 31 days" type="button" variant="outline">+31d Pro</Button>
                    <Button className="admin-button--tiny" data-act="free" disabled={busy} onClick={() => onAction(user, "free")} size="sm" title="Downgrade to Free" type="button" variant="outline">Free</Button>
                    <Button className={`admin-button--tiny ${user.status === "suspended" ? "" : "admin-button--danger"}`} data-act={user.status === "suspended" ? "unsuspend" : "suspend"} disabled={busy} onClick={() => onAction(user, "suspend")} size="sm" type="button" variant="outline">
                      {user.status === "suspended" ? "Unsuspend" : "Suspend"}
                    </Button>
                    <Button className="admin-button--tiny" data-act="reset-link" disabled={busy} onClick={() => onAction(user, "reset-link")} size="sm" title="Generate a 24h password reset link" type="button" variant="outline">Reset link</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ id, children = "Nothing here yet.", hidden = false }: { id: string; children?: string; hidden?: boolean }) {
  return <div className="empty admin-empty" hidden={hidden} id={id}>{children}</div>;
}

function Pagination({
  id,
  page,
  total,
  pageSize,
  onPage,
  label,
}: {
  id: string;
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <div className="admin-pagination" id={id} />;
  return (
    <div className="admin-pagination" id={id}>
      <span className="admin-hint">{total} {label || "items"} · page {page} of {pages}</span>
      <Button className="admin-button--small" disabled={page <= 1} onClick={() => onPage(page - 1)} size="sm" type="button" variant="outline">← Previous</Button>
      <Button className="admin-button--small" disabled={page >= pages} onClick={() => onPage(page + 1)} size="sm" type="button" variant="outline">Next →</Button>
    </div>
  );
}

export function AdminPage({ dependencies }: AdminPageProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [email, setEmail] = useState("");
  const [stats, setStats] = useState(blankStats);
  const [activeTab, setActiveTab] = useState<TabKey>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState(50);
  const [userFilters, setUserFilters] = useState({ q: "", status: "all", plan: "all" });
  const filtersRef = useRef(userFilters);
  const [leads, setLeads] = useState<AdminLead[]>([]);
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPageSize, setLeadsPageSize] = useState(50);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsPageSize, setPaymentsPageSize] = useState(50);
  const [support, setSupport] = useState<SupportMessage[]>([]);
  const [supportPage, setSupportPage] = useState(1);
  const [supportTotal, setSupportTotal] = useState(0);
  const [supportPageSize, setSupportPageSize] = useState(50);
  const [supportStatus, setSupportStatus] = useState("all");
  const supportStatusRef = useRef(supportStatus);
  supportStatusRef.current = supportStatus;
  const [features, setFeatures] = useState<FeatureFlag[]>([]);
  const [featureUsers, setFeatureUsers] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPageSize, setAuditPageSize] = useState(50);
  const [identity, setIdentity] = useState<AdminIdentity>({});
  const [identityStatus, setIdentityStatus] = useState<Notice | null>(null);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [reply, setReply] = useState<SupportMessage | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState<Notice | null>(null);
  const [replySending, setReplySending] = useState(false);
  const [busyFeature, setBusyFeature] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const request = useCallback(
    <T extends object>(path: string, options?: RequestInit) =>
      adminApi<T>(path, options, {
        ...dependencies,
        onForbidden: () => setStatus("forbidden"),
      }),
    [dependencies],
  );

  const showNotice = useCallback((message: string, tone: NoticeTone = "info") => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = setTimeout(() => setNotice(null), 4500);
  }, []);

  const loadUsers = useCallback(async (page = 1, filters = filtersRef.current) => {
    const query = new URLSearchParams({ page: String(page), q: filters.q, status: filters.status, plan: filters.plan });
    const data = await request<{ users?: AdminUser[]; total?: number; pageSize?: number }>(`/api/admin/users?${query}`);
    setUsers(Array.isArray(data.users) ? data.users : []);
    setUsersTotal(Number(data.total || 0));
    setUsersPageSize(Number(data.pageSize || 50));
    setUsersPage(page);
  }, [request]);

  const loadLeads = useCallback(async (page = 1) => {
    const data = await request<{ leads?: AdminLead[]; total?: number; pageSize?: number }>(`/api/admin/leads?page=${page}`);
    setLeads(Array.isArray(data.leads) ? data.leads : []);
    setLeadsTotal(Number(data.total || 0));
    setLeadsPageSize(Number(data.pageSize || 50));
    setLeadsPage(page);
  }, [request]);

  const loadPayments = useCallback(async (page = 1) => {
    const data = await request<{ payments?: AdminPayment[]; total?: number; pageSize?: number }>(`/api/admin/payments?page=${page}`);
    setPayments(Array.isArray(data.payments) ? data.payments : []);
    setPaymentsTotal(Number(data.total || 0));
    setPaymentsPageSize(Number(data.pageSize || 50));
    setPaymentsPage(page);
  }, [request]);

  const loadSupport = useCallback(async (page = 1, filter = supportStatusRef.current) => {
    const data = await request<{ messages?: SupportMessage[]; total?: number; pageSize?: number }>(`/api/admin/support?status=${encodeURIComponent(filter)}&page=${page}`);
    setSupport(Array.isArray(data.messages) ? data.messages : []);
    setSupportTotal(Number(data.total || 0));
    setSupportPageSize(Number(data.pageSize || 50));
    setSupportPage(page);
  }, [request]);

  const loadFeatures = useCallback(async () => {
    const data = await request<{ flags?: FeatureFlag[] }>("/api/admin/features");
    setFeatures(Array.isArray(data.flags) ? data.flags : []);
  }, [request]);

  const loadAudit = useCallback(async (page = 1) => {
    const data = await request<{ events?: AuditEvent[]; total?: number; pageSize?: number }>(`/api/admin/audit?page=${page}`);
    setAudit(Array.isArray(data.events) ? data.events : []);
    setAuditTotal(Number(data.total || 0));
    setAuditPageSize(Number(data.pageSize || 50));
    setAuditPage(page);
  }, [request]);

  const loadIdentity = useCallback(async () => {
    try {
      const data = await request<{ ok?: boolean; identity?: AdminIdentity }>("/api/admin/identity");
      if (!data.ok) return;
      const value = data.identity || {};
      setIdentity(value);
      setIdentityStatus(value.complete ? null : { message: "Company name and country are required before launch.", tone: "error" });
    } catch (error) {
      if (isTerminalError(error)) throw error;
      setIdentityStatus({ message: "Could not load company details. Try again.", tone: "error" });
    }
  }, [request]);

  const loadOverview = useCallback(async () => {
    const data = await request<Partial<AdminStats>>("/api/admin/overview");
    setStats({
      users: Number(data.users || 0),
      paid: Number(data.paid || 0),
      leads: Number(data.leads || 0),
      revenue: Number(data.revenue || 0),
    });
  }, [request]);

  const refreshStats = useCallback(async () => {
    const data = await request<Partial<AdminStats>>("/api/admin/overview");
    setStats((current) => ({
      paid: Number(data.paid ?? current.paid),
      revenue: Number(data.revenue ?? current.revenue),
      users: current.users,
      leads: current.leads,
    }));
  }, [request]);

  useEffect(() => {
    const root = document.getElementById("admin-app");
    root?.setAttribute("data-state", status);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const me = await request<{ ok?: boolean; user?: { email?: string } }>("/api/auth/me");
        if (!me.ok) {
          (dependencies?.navigate || ((path: string) => { window.location.href = path; }))("/login");
          return;
        }
        if (!cancelled) setEmail(me.user?.email || "");
        await loadOverview();
        await Promise.all([loadUsers(), loadLeads(), loadPayments(), loadSupport(), loadFeatures(), loadAudit(), loadIdentity()]);
        if (!cancelled) setStatus("ready");
      } catch (error) {
        if (cancelled || isTerminalError(error)) return;
        setStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (replyTimer.current) clearTimeout(replyTimer.current);
    };
  }, [dependencies, loadAudit, loadFeatures, loadIdentity, loadLeads, loadOverview, loadPayments, loadSupport, loadUsers, request]);

  useEffect(() => {
    const card = document.getElementById("supportReplyCard");
    if (reply && typeof card?.scrollIntoView === "function") card.scrollIntoView({ behavior: "smooth" });
  }, [reply]);

  const requestConfirm = useCallback((config: Omit<Extract<DialogState, { kind: "confirm" }>, "kind" | "resolve">) => (
    new Promise<boolean>((resolve) => setDialog({ ...config, kind: "confirm", resolve }))
  ), []);

  const requestPrompt = useCallback((config: Omit<Extract<DialogState, { kind: "prompt" }>, "kind" | "resolve" | "value"> & { value?: string }) => (
    new Promise<string | null>((resolve) => setDialog({ ...config, kind: "prompt", value: config.value || "", resolve }))
  ), []);

  const resolveDialog = useCallback((value: boolean | string | null) => {
    setDialog((current) => {
      if (!current) return null;
      current.resolve(value as never);
      return null;
    });
  }, []);

  const onUserAction = useCallback(async (user: AdminUser, action: RowAction) => {
    let body: Record<string, unknown> = { userId: user.id, action };
    if (action === "suspend") {
      if (user.status === "suspended") {
        body = { userId: user.id, action: "unsuspend" };
      } else {
        const confirmed = await requestConfirm({
          title: "Suspend account",
          description: "Their page goes offline and they can't sign in. Existing viewers can still spend credits, but new earnings stop.",
          confirmLabel: "Suspend",
          danger: true,
        });
        if (!confirmed) return;
        const reason = await requestPrompt({
          title: "Suspension reason",
          description: "Why is this account being suspended?",
          confirmLabel: "Confirm suspend",
          placeholder: "e.g. ToS violation / chargeback",
        });
        if (!reason) return;
        body = { userId: user.id, action: "suspend", reason };
      }
    } else if (action === "free") {
      if (!await requestConfirm({
        title: "Downgrade to Free",
        description: "Their paid features stop immediately. Existing data stays, but rewards, broadcasts and shop items may exceed Free limits.",
        confirmLabel: "Downgrade",
        danger: true,
      })) return;
      body = { userId: user.id, action: "free" };
    } else if (action === "starter" || action === "pro") {
      const amount = await requestPrompt({
        title: `Activate ${action === "starter" ? "Starter" : "Pro"} plan`,
        description: "Amount they paid you in USD (for the revenue ledger — 0 if comped):",
        confirmLabel: "Activate",
        inputType: "number",
        value: action === "starter" ? "12" : "29",
        placeholder: action === "starter" ? "12" : "29",
      });
      if (amount === null) return;
      body = { userId: user.id, action, amountUsd: Number(amount) || 0 };
    } else if (action === "reset-link") {
      body = { userId: user.id, action };
    }

    setBusyAction(`${user.id}:${action}`);
    try {
      const data = await request<{ ok?: boolean; error?: string; message?: string }>("/api/admin/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!data.ok) {
        showNotice(data.error || "Failed", "error");
        return;
      }
      if (action === "reset-link") {
        showNotice(data.message || "Reset link generated. Deliver it via email.", "success");
        return;
      }
      await loadUsers(1);
      await refreshStats();
    } catch (error) {
      if (!isTerminalError(error)) showNotice(error instanceof Error ? error.message : "Could not complete that action. Try again.", "error");
    } finally {
      setBusyAction(null);
    }
  }, [loadUsers, refreshStats, request, requestConfirm, requestPrompt, showNotice]);

  const saveIdentity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIdentitySaving(true);
    setIdentityStatus({ message: "Saving...", tone: "info" });
    try {
      const data = await request<{ ok?: boolean; error?: string; identity?: AdminIdentity }>("/api/admin/identity", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company_name: String(identity.company_name || "").trim(),
          company_country: String(identity.company_country || "").trim(),
          company_number: String(identity.company_number || "").trim(),
          support_email: String(identity.support_email || "").trim(),
          affiliate_disclosure: String(identity.affiliate_disclosure || "").trim(),
        }),
      });
      if (!data.ok) {
        setIdentityStatus({ message: data.error || "Failed to save.", tone: "error" });
        return;
      }
      const incomplete = !data.identity?.complete;
      setIdentityStatus({
        message: `Saved. Legal pages and footers now use these details.${incomplete ? " Company name and country are still required before launch." : ""}`,
        tone: incomplete ? "error" : "success",
      });
    } catch (error) {
      if (!isTerminalError(error)) setIdentityStatus({ message: "Network error. Try again.", tone: "error" });
    } finally {
      setIdentitySaving(false);
    }
  };

  const sendReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reply || !replyText.trim()) return;
    setReplySending(true);
    setReplyStatus({ message: "Sending...", tone: "info" });
    try {
      const data = await request<{ ok?: boolean; error?: string; emailSent?: boolean }>("/api/admin/support/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: reply.id, reply: replyText.trim() }),
      });
      if (!data.ok) {
        setReplyStatus({ message: data.error || "Failed to send reply.", tone: "error" });
        return;
      }
      setReplyStatus({ message: `Reply sent${data.emailSent ? " by email" : " (email not configured)"}.`, tone: "success" });
      await loadSupport(supportPage);
      if (replyTimer.current) clearTimeout(replyTimer.current);
      replyTimer.current = setTimeout(() => {
        setReply(null);
        setReplyText("");
        setReplyStatus(null);
      }, 1500);
    } catch (error) {
      if (!isTerminalError(error)) setReplyStatus({ message: "Network error. Try again.", tone: "error" });
    } finally {
      setReplySending(false);
    }
  };

  const overrideFeature = async (flag: FeatureFlag) => {
    const userId = featureUsers[flag.key]?.trim();
    if (!userId) {
      showNotice("Enter a user ID");
      return;
    }
    const enabled = await requestConfirm({
      title: "Override feature flag",
      description: `Enable "${flag.key}" for user ${userId}? Click Cancel to disable it.`,
      confirmLabel: "Enable",
      danger: false,
    });
    setBusyFeature(flag.key);
    try {
      const data = await request<{ ok?: boolean; error?: string }>("/api/admin/features/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, featureKey: flag.key, enabled }),
      });
      if (!data.ok) {
        showNotice(data.error || "Failed", "error");
        return;
      }
      showNotice(`Override ${enabled ? "enabled" : "disabled"} for ${userId}.`, "success");
    } catch (error) {
      if (!isTerminalError(error)) showNotice(error instanceof Error ? error.message : "Could not save the feature override. Try again.", "error");
    } finally {
      setBusyFeature(null);
    }
  };

  const logout = async () => {
    try {
      const response = await (dependencies?.fetcher || globalThis.fetch)("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": typeof document === "undefined" ? "" : document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "" },
      });
      if (!response.ok) throw new Error("logout");
      (dependencies?.navigate || ((path: string) => { window.location.href = path; }))("/login");
    } catch {
      showNotice("Could not sign out. Try again.", "error");
    }
  };

  const applyUsers = () => {
    const filters = { ...userFilters, q: userFilters.q.trim() };
    filtersRef.current = filters;
    void loadUsers(1, filters).catch((error) => {
      if (!isTerminalError(error)) showNotice("Could not load users. Try again.", "error");
    });
  };

  const setTab = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab === "identity" && !identity.company_name) void loadIdentity();
  };

  const content = status === "loading"
    ? <AdminLoading />
    : status === "forbidden"
      ? <div id="panel" className="admin-load-error">Not an admin account. <a href="/dashboard">Back to dashboard</a></div>
      : status === "error"
        ? <div id="loading" className="admin-load-error">Could not load admin data. Refresh to try again.</div>
        : (
          <div id="panel">
            <div className="admin-head">
              <div>
                <h1>Operator panel</h1>
                <p className="admin-live-link">Everything that happens on YourRank, in one place.</p>
              </div>
            </div>
            <Stats stats={stats} />
            <TabList active={activeTab} onChange={setTab} />
            <section aria-labelledby="tab-btn-users" className="admin-tabpane" hidden={activeTab !== "users"} id="tab-users" role="tabpanel">
              <div className="admin-filter-card">
                <div className="admin-field admin-field--search"><label htmlFor="usersSearch">Search</label><Input className="admin-input" id="usersSearch" onChange={(event) => setUserFilters((current) => ({ ...current, q: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") applyUsers(); }} placeholder="Email or user ID" value={userFilters.q} /></div>
                <div className="admin-field"><label htmlFor="usersStatusFilter">Status</label><select className="admin-select" id="usersStatusFilter" onChange={(event) => setUserFilters((current) => ({ ...current, status: event.target.value }))} value={userFilters.status}><option value="all">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="unverified">Unverified</option></select></div>
                <div className="admin-field"><label htmlFor="usersPlanFilter">Plan</label><select className="admin-select" id="usersPlanFilter" onChange={(event) => setUserFilters((current) => ({ ...current, plan: event.target.value }))} value={userFilters.plan}><option value="all">All</option><option value="free">Free</option><option value="starter">Starter</option><option value="pro">Pro</option><option value="team">Team</option></select></div>
                <Button className="admin-button--small" id="usersFilterApply" onClick={applyUsers} size="sm" type="button" variant="outline">Filter</Button>
              </div>
              <UserTable busyAction={busyAction} onAction={onUserAction} users={users} />
              <Empty hidden={users.length > 0} id="usersEmpty">No users yet.</Empty>
              <Pagination id="usersPagination" label="users" onPage={(page) => { void loadUsers(page).catch((error) => { if (!isTerminalError(error)) showNotice("Could not load users. Try again.", "error"); }); }} page={usersPage} pageSize={usersPageSize} total={usersTotal} />
            </section>
            <section aria-labelledby="tab-btn-leads" className="admin-tabpane" hidden={activeTab !== "leads"} id="tab-leads" role="tabpanel">
              <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Handle</th><th>Brand</th><th>Contact</th><th>Note</th><th>When</th></tr></thead><tbody id="leadsBody">{leads.map((lead) => <tr key={lead.id}><td>{lead.handle || ""}</td><td>{lead.brand || ""}</td><td>{lead.contact || ""}</td><td className="admin-note">{lead.note || ""}</td><td>{formatWhen(lead.created_at)}</td></tr>)}</tbody></table></div>
              <Empty hidden={leads.length > 0} id="leadsEmpty">No leads yet. Share the landing page around.</Empty>
              <Pagination id="leadsPagination" onPage={(page) => { void loadLeads(page).catch((error) => { if (!isTerminalError(error)) showNotice("Could not load this page. Try again.", "error"); }); }} page={leadsPage} pageSize={leadsPageSize} total={leadsTotal} />
            </section>
            <section aria-labelledby="tab-btn-payments" className="admin-tabpane" hidden={activeTab !== "payments"} id="tab-payments" role="tabpanel">
              <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Provider</th><th className="ta-r">Amount</th><th>Status</th><th>When</th></tr></thead><tbody id="payBody">{payments.map((payment) => { const tone = ["finished", "manual"].includes(payment.status) ? "good" : ["failed", "expired", "refunded"].includes(payment.status) ? "bad" : "muted"; return <tr key={payment.id}><td>{payment.email || payment.user_id || ""}</td><td>{payment.provider || ""}</td><td className="ta-r">{`$${Number(payment.amount_usd).toFixed(2)}`}</td><td><span className={`admin-pill admin-pill--${tone}`}>{payment.status}</span></td><td>{formatWhen(payment.created_at)}</td></tr>; })}</tbody></table></div>
              <Empty hidden={payments.length > 0} id="payEmpty">No payments yet.</Empty>
              <Pagination id="payPagination" onPage={(page) => { void loadPayments(page).catch((error) => { if (!isTerminalError(error)) showNotice("Could not load this page. Try again.", "error"); }); }} page={paymentsPage} pageSize={paymentsPageSize} total={paymentsTotal} />
            </section>
            <section aria-labelledby="tab-btn-support" className="admin-tabpane" hidden={activeTab !== "support"} id="tab-support" role="tabpanel">
              <div className="admin-filter-card admin-filter-card--support"><div className="admin-field"><label className="sr-only" htmlFor="supportFilter">Filter support messages</label><select className="admin-select" id="supportFilter" onChange={(event) => { const value = event.target.value; setSupportStatus(value); supportStatusRef.current = value; void loadSupport(1, value).catch((error) => { if (!isTerminalError(error)) showNotice("Could not load support messages. Try again.", "error"); }); }} value={supportStatus}><option value="all">All</option><option value="pending">Pending</option><option value="replied">Replied</option></select></div></div>
              <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>User</th><th>Subject</th><th>Status</th><th /></tr></thead><tbody id="supportBody">{support.map((message) => <tr key={message.id}><td>{formatWhen(message.created_at)}</td><td>{message.name || ""}<br /><small className="muted">{message.email || ""}</small></td><td>{message.subject || ""}</td><td><span className={`admin-pill ${message.replied_at ? "admin-pill--good" : "admin-pill--muted"}`}>{message.replied_at ? "replied" : "pending"}</span></td><td><Button className="admin-button--tiny" onClick={() => { setReply(message); setReplyText(message.reply || ""); setReplyStatus(null); }} size="sm" type="button" variant="outline">{message.replied_at ? "View" : "Reply"}</Button></td></tr>)}</tbody></table></div>
              <Empty hidden={support.length > 0} id="supportEmpty">No support messages yet.</Empty>
              <Pagination id="supportPagination" onPage={(page) => { void loadSupport(page).catch((error) => { if (!isTerminalError(error)) showNotice("Could not load this page. Try again.", "error"); }); }} page={supportPage} pageSize={supportPageSize} total={supportTotal} />
              <div className="admin-card admin-reply-card" hidden={!reply} id="supportReplyCard">
                <h2>Reply</h2>
                <p className="admin-card-sub">To <b id="replyToEmail">{reply?.email || ""}</b> · <span id="replySubject">{reply?.subject || ""}</span></p>
                <p className="admin-reply-message" id="replyMessage">{reply?.message || ""}</p>
                <form id="replyForm" onSubmit={sendReply}>
                  <input id="replyId" type="hidden" value={reply?.id || ""} readOnly />
                  <label className="sr-only" htmlFor="replyText">Reply</label>
                  <Textarea className="admin-textarea" id="replyText" onChange={(event) => setReplyText(event.target.value)} placeholder="Type your reply here…" required value={replyText} />
                  <div className="admin-form-buttons"><Button id="replyCancel" onClick={() => setReply(null)} size="sm" type="button" variant="outline">Cancel</Button><Button disabled={replySending} size="sm" type="submit">Send reply</Button></div>
                  <div aria-live="polite" className={`admin-status ${replyStatus ? `admin-status--${replyStatus.tone === "success" ? "good" : replyStatus.tone === "info" ? "" : "bad"}` : ""}`} id="replyStatus" role="status">{replyStatus?.message || ""}</div>
                </form>
              </div>
            </section>
            <section aria-labelledby="tab-btn-features" className="admin-tabpane" hidden={activeTab !== "features"} id="tab-features" role="tabpanel">
              <div className="admin-card"><h2>Feature flags</h2><p className="admin-card-sub">Toggle features globally or override them for a specific user.</p><div id="featuresStatus" role="status" aria-live="polite" className="admin-status" />
                <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Key</th><th>Name</th><th>Default</th><th>Override for user</th><th /></tr></thead><tbody id="featuresBody">{features.map((flag) => <tr key={flag.key}><td>{flag.key}</td><td><strong>{flag.name || flag.key}</strong><br /><small className="muted">{flag.description || ""}</small></td><td><span className={`admin-pill ${flag.defaultValue ? "admin-pill--good" : "admin-pill--muted"}`}>{flag.defaultValue ? "on" : "off"}</span></td><td><Input className="admin-input" data-feature-override-user={flag.key} onChange={(event) => setFeatureUsers((current) => ({ ...current, [flag.key]: event.target.value }))} placeholder="user ID" value={featureUsers[flag.key] || ""} /></td><td><Button disabled={busyFeature === flag.key} data-feature-override={flag.key} onClick={() => void overrideFeature(flag)} size="sm" type="button" variant="outline">Set override</Button></td></tr>)}</tbody></table></div>
                <Empty hidden={features.length > 0} id="featuresEmpty">No feature flags yet.</Empty>
              </div>
            </section>
            <section aria-labelledby="tab-btn-audit" className="admin-tabpane" hidden={activeTab !== "audit"} id="tab-audit" role="tabpanel">
              <div className="admin-card"><h2>Audit log</h2><p className="admin-card-sub">Recent admin actions and plan changes. Times are in your local timezone.</p><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody id="auditBody">{audit.map((event) => <tr key={event.id}><td>{formatWhen(event.created_at)}</td><td>{event.actor_email || "system"}</td><td>{event.action}</td><td>{event.entity_id || "—"}</td><td><small className="muted">{event.details ? Object.entries(event.details).map(([key, value]) => `${key}: ${String(value)}`).join("; ") : ""}</small></td></tr>)}</tbody></table></div><Empty hidden={audit.length > 0} id="auditEmpty">No audit events yet.</Empty><Pagination id="auditPagination" onPage={(page) => { void loadAudit(page).catch((error) => { if (!isTerminalError(error)) showNotice("Could not load this page. Try again.", "error"); }); }} page={auditPage} pageSize={auditPageSize} total={auditTotal} /></div>
            </section>
            <section aria-labelledby="tab-btn-identity" className="admin-tabpane" hidden={activeTab !== "identity"} id="tab-identity" role="tabpanel">
              <div className="admin-card" id="identityCard"><h2>Platform identity</h2><p className="admin-card-sub">Legal company details used on terms, privacy, refund, and footer pages. Required before launch.</p><form className="admin-form-stack" id="identityForm" onSubmit={saveIdentity}>
                <div className="admin-form-field"><label className="admin-label" htmlFor="i_company_name">Company name</label><Input className="admin-input" id="i_company_name" onChange={(event) => setIdentity((current) => ({ ...current, company_name: event.target.value }))} placeholder="YourRank Ltd" required value={identity.company_name || ""} /></div>
                <div className="admin-form-field"><label className="admin-label" htmlFor="i_company_country">Registered country</label><Input className="admin-input" id="i_company_country" onChange={(event) => setIdentity((current) => ({ ...current, company_country: event.target.value }))} placeholder="United Kingdom" value={identity.company_country || ""} /></div>
                <div className="admin-form-field"><label className="admin-label" htmlFor="i_company_number">Company registration number</label><Input className="admin-input" id="i_company_number" onChange={(event) => setIdentity((current) => ({ ...current, company_number: event.target.value }))} placeholder="12345678" value={identity.company_number || ""} /></div>
                <div className="admin-form-field"><label className="admin-label" htmlFor="i_support_email">Support email</label><Input className="admin-input" id="i_support_email" onChange={(event) => setIdentity((current) => ({ ...current, support_email: event.target.value }))} placeholder="contact@yourrank.site" type="email" value={identity.support_email || ""} /></div>
                <div className="admin-form-field"><label className="admin-label" htmlFor="i_affiliate_disclosure">Affiliate disclosure</label><Textarea className="admin-textarea" id="i_affiliate_disclosure" onChange={(event) => setIdentity((current) => ({ ...current, affiliate_disclosure: event.target.value }))} rows={3} value={identity.affiliate_disclosure || ""} /><p className="admin-hint">Shown in the footer of every public and platform page.</p></div>
                <div className="admin-form-actions"><Button disabled={identitySaving} size="sm" type="submit">Save identity</Button></div>
                <div aria-live="polite" className={`admin-status ${identityStatus ? `admin-status--${identityStatus.tone === "success" ? "good" : identityStatus.tone === "info" ? "" : "bad"}` : ""}`} hidden={!identityStatus} id="identityStatus" role="status">{identityStatus?.message || ""}</div>
              </form></div>
            </section>
            <p className="admin-hint admin-manual-hint">Manual activation: use <strong>+31d Pro</strong> on any user after they pay you directly (PayPal, bank, whatever). Crypto payments through the site activate on their own. Reset links work for 24h — send them over Discord/Telegram if email isn't wired up.</p>
          </div>
        );

  return (
    <>
      <Topbar busy={Boolean(busyAction)} email={email} onLogout={() => void logout()} />
      <div className="admin-root">
        {content}
        <div aria-live="polite" className={`admin-toast admin-toast--${notice?.tone || "info"}`} hidden={!notice} id="status"><div className="admin-toast__body">{notice?.message || ""}</div></div>
      </div>
      <AlertDialog open={dialog?.kind === "confirm"} onOpenChange={(open) => { if (!open) resolveDialog(false); }}>
        <AlertDialogContent className="admin-root">
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog?.kind === "confirm" ? dialog.title : ""}</AlertDialogTitle>
            <AlertDialogDescription>{dialog?.kind === "confirm" ? dialog.description : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="admin-button admin-button--small admin-button--ghost" onClick={(event) => { event.preventDefault(); resolveDialog(false); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction className={`admin-button admin-button--small ${dialog?.kind === "confirm" && dialog.danger ? "admin-button--danger" : "admin-button--primary"}`} onClick={(event) => { event.preventDefault(); resolveDialog(true); }}>{dialog?.kind === "confirm" ? dialog.confirmLabel : "Continue"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={dialog?.kind === "prompt"} onOpenChange={(open) => { if (!open) resolveDialog(null); }}>
        <DialogContent className="admin-root">
          <DialogHeader>
            <DialogTitle>{dialog?.kind === "prompt" ? dialog.title : ""}</DialogTitle>
            <DialogDescription>{dialog?.kind === "prompt" ? dialog.description : ""}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => { event.preventDefault(); if (dialog?.kind === "prompt") resolveDialog(dialog.value); }}>
            <Input
              autoFocus
              className="admin-input"
              onChange={(event) => setDialog((current) => current?.kind === "prompt" ? { ...current, value: event.target.value } : current)}
              placeholder={dialog?.kind === "prompt" ? dialog.placeholder : undefined}
              type={dialog?.kind === "prompt" ? dialog.inputType || "text" : "text"}
              value={dialog?.kind === "prompt" ? dialog.value : ""}
            />
            <DialogFooter className="mt-4">
              <Button onClick={() => resolveDialog(null)} size="sm" type="button" variant="outline">Cancel</Button>
              <Button size="sm" type="submit">{dialog?.kind === "prompt" ? dialog.confirmLabel : "Continue"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
