import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { api } from "../../lib/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { copyToClipboard, flashButton, logError, showConfirmModal, showToast } from "../../../assets/dashboard/utils.js";
import { state } from "../../../assets/dashboard/state.js";
import { registerRouteRenderer, requestDashboardRoute, syncRouteChrome } from "../../../assets/dashboard/shell.js";
import { parseDynamicPath } from "../../../assets/dashboard/routes.js";
import { wireAccount } from "../../../assets/dashboard/account.js";
import { loadHistory, loadPlanUsage, renderPlan } from "../../../assets/dashboard/site.js";
import { trackFunnel, wirePlanLock } from "../../../assets/dashboard/plan-lock.js";
import { getMe, handleAuthError } from "../../../assets/dashboard/session.js";
import { withDashboardTimeout } from "../../../assets/dashboard/request.js";

type RecordValue = Record<string, unknown>;

export type SettingsRequestResult<T = unknown> = {
  ok: boolean;
  status?: number;
  data: T;
};

type SettingsRequester = <T = unknown>(
  method: string,
  path: string,
  body?: RecordValue,
) => Promise<SettingsRequestResult<T>>;

type DeleteAccountResult = {
  ok: boolean;
  status: number;
  data: RecordValue;
};

export type SettingsDependencies = {
  request: SettingsRequester;
  getCurrentUser: () => Promise<User>;
  confirm: (title: string, body: string, confirmText?: string, danger?: boolean) => Promise<boolean>;
  copy: (value: string) => Promise<boolean>;
  route: (page: string, tab: string) => Promise<unknown>;
  deleteAccount: (password?: string) => Promise<DeleteAccountResult>;
  navigate: (path: string) => void;
};

type User = {
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  plan?: { name?: string };
  boards?: Array<{ id: string; name?: string; slug?: string }>;
};

type MutableSettingsState = Omit<typeof state, "ME" | "ACTIVE_SITE_ID"> & {
  ME: User | null;
  ACTIVE_SITE_ID: string | null;
};

type TeamMember = {
  userId: string;
  email: string;
  displayName?: string;
  role: string;
  createdAt?: string;
  siteAccess?: string[];
  accessStatus?: string;
};

type TeamInvite = {
  id: string;
  email: string;
  createdAt?: string;
  inviteUrl?: string;
};

type TeamData = {
  ok?: boolean;
  error?: string;
  siteId?: string;
  siteName?: string;
  members?: TeamMember[];
  invites?: TeamInvite[];
  canManageTeam?: boolean;
  currentRole?: string;
  seats?: { plan?: string; used?: number; limit?: number };
  scheduledChange?: { plan?: string; appliesAt?: string };
};

type Connection = {
  id?: string;
  provider?: string;
  detail?: string;
  connected?: boolean;
  selectedSite?: boolean;
  statusLabel?: string;
  action?: { kind?: string; href?: string; label?: string };
};

type ConnectionData = {
  connections?: Connection[];
  selectedSiteId?: string;
  selectedSiteName?: string;
  capabilities?: { canRoleManageConnections?: boolean };
  integrationHealth?: Record<string, { status?: string; issueHref?: string | null }>;
  error?: string;
};

type Postback = {
  signedEndpoint?: string;
  key?: string;
  legacyUrl?: string;
  lastUsedAt?: string;
  createdAt?: string;
};

type PostbackData = {
  postback?: Postback | null;
  status?: string;
  upgrade?: boolean;
  conversions?: Array<{ at?: string; event?: string; amount?: number; currency?: string; offer?: string }>;
  error?: string;
};

const SETTINGS_TABS = [
  ["account", "Account", "Your profile, password, and signed-in devices."],
  ["team", "Team", "People who can help manage the selected site."],
  ["plan", "Billing", "Your current plan, usage, and payment history."],
  ["connections", "Connections", "Manage your account and selected site's connections."],
  ["data", "Data", "Export your account data or permanently close your account."],
] as const;

const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object";

function errorData(error: unknown): RecordValue {
  if (isRecord(error) && isRecord(error.data)) return error.data;
  return { error: error instanceof Error ? error.message : "Request failed." };
}

async function defaultRequest<T = unknown>(
  method: string,
  path: string,
  body?: RecordValue,
): Promise<SettingsRequestResult<T>> {
  try {
    const data = await api<T>(path, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { ok: isRecord(data) && data.ok === true, data };
  } catch (error) {
    return { ok: false, status: isRecord(error) && typeof error.status === "number" ? error.status : undefined, data: errorData(error) as T };
  }
}

async function defaultDeleteAccount(password = ""): Promise<DeleteAccountResult> {
  const response = await withDashboardTimeout((signal: AbortSignal) => fetch("/api/account/delete", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "",
    },
    body: JSON.stringify(password ? { password } : {}),
    signal,
  }));
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && isRecord(data) && data.ok === true, status: response.status, data: isRecord(data) ? data : {} };
}

const defaults: SettingsDependencies = {
  request: defaultRequest,
  getCurrentUser: async () => await getMe() as User,
  confirm: showConfirmModal,
  copy: copyToClipboard,
  route: requestDashboardRoute,
  deleteAccount: defaultDeleteAccount,
  navigate: (path) => { window.location.href = path; },
};

function initialTab() {
  if (typeof document !== "undefined") {
    const fromRoot = document.getElementById("acc-app")?.dataset.settingsActive;
    if (fromRoot && SETTINGS_TABS.some(([key]) => key === fromRoot)) return fromRoot;
  }
  if (typeof location === "undefined") return "account";
  const match = location.pathname.match(/\/dashboard\/settings\/([^/]+)/)?.[1];
  const key = match === "billing" ? "plan" : match;
  return SETTINGS_TABS.some(([tab]) => tab === key) ? key : "account";
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value ? value : fallback;
}

function fmtDate(value?: string) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return value;
  }
}

function fmtDateTime(value?: string) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function statusMessage(data: unknown, fallback: string) {
  return isRecord(data) && typeof data.error === "string" && data.error ? data.error : fallback;
}

function reportStatus(message: string, isError = false) {
  const target = document.getElementById("status");
  if (!target) {
    showToast(message, isError ? "error" : "success");
    return;
  }
  target.textContent = message;
  target.className = isError ? "toast toast--error" : "toast toast--success";
  target.hidden = false;
  setTimeout(() => { target.hidden = true; }, 4000);
}

function AccountPanel({ user, deps }: { user: User; deps: SettingsDependencies }) {
  const name = text(user.displayName, text(user.email?.split("@")[0], "Account"));
  const email = text(user.email, "—");
  const [profileName, setProfileName] = useState(name);
  const [editingProfileName, setEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(name);
  const [profileNameError, setProfileNameError] = useState("");
  const [profileNameSaving, setProfileNameSaving] = useState(false);
  const [verification, setVerification] = useState(user.emailVerified === false ? "Not verified" : "Checking…");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    (state as MutableSettingsState).ME = user;
    setProfileName(name);
    setProfileNameDraft(name);
    setEditingProfileName(false);
    setProfileNameError("");
    const resend = document.getElementById("accResendVerification") as (HTMLButtonElement & { _wired?: boolean }) | null;
    if (resend) resend._wired = true;
    const cleanup = wireAccount();
    setVerification(user.emailVerified ? "Verified" : "Not verified");
    return cleanup;
  }, [name, user]);

  function editProfileName() {
    setProfileNameDraft(profileName);
    setProfileNameError("");
    setEditingProfileName(true);
  }

  function cancelProfileNameEdit() {
    if (profileNameSaving) return;
    setProfileNameDraft(profileName);
    setProfileNameError("");
    setEditingProfileName(false);
  }

  async function saveProfileName() {
    if (profileNameSaving) return;
    setProfileNameSaving(true);
    setProfileNameError("");
    try {
      const result = await deps.request<{ displayName?: string }>(
        "PATCH",
        "/api/account/profile",
        { displayName: profileNameDraft },
      );
      if (!result.ok || typeof result.data.displayName !== "string") {
        setProfileNameError(statusMessage(result.data, "Couldn't update your name. Try again."));
        return;
      }

      const updatedName = result.data.displayName;
      setProfileName(updatedName);
      setProfileNameDraft(updatedName);
      setEditingProfileName(false);
      (state as MutableSettingsState).ME = { ...user, displayName: updatedName };
      const shellName = document.querySelector(".gm-profile-id-name");
      if (shellName) shellName.textContent = updatedName;
    } catch {
      setProfileNameError("Couldn't update your name. Try again.");
    } finally {
      setProfileNameSaving(false);
    }
  }

  async function resendVerification() {
    setResending(true);
    try {
      const result = await deps.request("POST", "/api/auth/resend-verification", {});
      setVerificationStatus(result.ok
        ? "Verification email requested. Check your inbox."
        : statusMessage(result.data, "Could not send verification email."));
    } catch {
      setVerificationStatus("Could not send verification email. Try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="lb-widget lb-widget--full acc-card-security" id="profile">
      <section className="account-settings-section" aria-labelledby="accountIdentityTitle">
        <h2 id="accountIdentityTitle">Profile</h2>
        <p className="card-sub">The identity used for your YourRank account.</p>
        <dl className="account-detail-list">
          <div>
            <dt>Name</dt>
            <dd id="accSummaryName">
              {editingProfileName ? (
                <form className="d-flex gap-8 items-center flex-wrap" onSubmit={(event) => { event.preventDefault(); void saveProfileName(); }}>
                  <Label className="sr-only" htmlFor="accProfileNameInput">Profile name</Label>
                  <Input
                    id="accProfileNameInput"
                    autoComplete="name"
                    autoFocus
                    className="w-full sm:w-56"
                    maxLength={40}
                    value={profileNameDraft}
                    aria-invalid={Boolean(profileNameError)}
                    aria-describedby={profileNameError ? "accProfileNameError" : undefined}
                    disabled={profileNameSaving}
                    onChange={(event) => setProfileNameDraft(event.currentTarget.value)}
                    onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveProfileName();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelProfileNameEdit();
                      }
                    }}
                  />
                  <button className="btn btn--sm btn--accent" id="accProfileNameSave" type="submit" disabled={profileNameSaving} aria-busy={profileNameSaving}>{profileNameSaving ? "Saving…" : "Save"}</button>
                  <button className="btn btn--sm btn--ghost" id="accProfileNameCancel" type="button" disabled={profileNameSaving} onClick={cancelProfileNameEdit}>Cancel</button>
                  {profileNameError && <p className="w-full text-xs text-destructive" id="accProfileNameError" role="alert">{profileNameError}</p>}
                </form>
              ) : (
                <div className="d-flex gap-8 items-center flex-wrap">
                  <span>{profileName}</span>
                  <button className="btn btn--sm btn--ghost" id="accProfileNameEdit" type="button" onClick={editProfileName}>Edit</button>
                </div>
              )}
            </dd>
          </div>
          <div><dt>Email</dt><dd id="accSummaryEmail">{email}</dd></div>
          <div>
            <dt>Verification</dt>
            <dd>
              <span id="accVerification">{verification}</span>
              <button className="btn btn--sm btn--ghost" id="accResendVerification" type="button" hidden={Boolean(user.emailVerified)} disabled={resending} aria-busy={resending} onClick={() => void resendVerification()}>Resend verification email</button>
              <span className="hint" id="accVerificationStatus" role="status" aria-live="polite">{verificationStatus}</span>
            </dd>
          </div>
        </dl>
      </section>
      <details className="account-settings-disclosure" aria-labelledby="accountPasswordTitle">
        <summary id="accountPasswordTitle">Password &amp; security</summary>
        <div className="account-settings-disclosure-body">
          <p className="card-sub">Use a strong password you do not use elsewhere.</p>
          <div className="acc-form-wrap">
            <div className="field">
              <label htmlFor="accCurrentPassword">Current password</label>
              <input type="password" id="accCurrentPassword" autoComplete="current-password" />
            </div>
            <div className="field">
              <label htmlFor="accNewPassword">New password</label>
              <input type="password" id="accNewPassword" autoComplete="new-password" />
              <div className="pwd-reqs" id="pwdReqs" aria-live="polite">
                <span className="pwd-req" id="pwdReqLength">Minimum 8 characters</span>
                <span className="pwd-req" id="pwdReqCase">Upper &amp; lower case</span>
                <span className="pwd-req" id="pwdReqNumber">A number</span>
                <span className="pwd-req" id="pwdReqSymbol">A symbol</span>
              </div>
            </div>
            <div className="d-flex gap-8 items-center flex-wrap mt-6">
              <button className="btn btn--accent" id="accChangePassword" type="button">Update password</button>
              <span className="hint" id="accPasswordStatus" role="status" aria-live="polite" />
            </div>
          </div>
        </div>
      </details>
      <section className="account-settings-section acc-sessions-section" data-ui-advanced aria-labelledby="accountSessionsTitle">
        <div className="d-flex justify-between items-center mb-12 flex-wrap gap-8">
          <div>
            <h2 className="m-0" id="accountSessionsTitle">Signed-in devices</h2>
            <p className="card-sub m-0 mt-2">Sign out other sessions keeps this device signed in. Browser details and last-active times are not recorded.</p>
          </div>
          <div className="d-flex gap-8 flex-wrap">
            <button className="btn btn--ghost btn--sm" id="accSignOut" type="button">Sign out</button>
            <button className="btn btn--ghost btn--sm" id="accRevokeSessions" type="button">Sign out other sessions</button>
          </div>
        </div>
        <div id="accSessions"><p className="hint">Loading sessions…</p></div>
        <p className="hint" id="accSessionsStatus" role="status" aria-live="polite" />
      </section>
    </div>
  );
}

const PlanPanel = memo(function PlanPanel() {
  useEffect(() => {
    renderPlan();
    void loadPlanUsage();
    void loadHistory();
  }, []);
  return (
    <div className="lb-widget lb-widget--full" id="plan">
      <section className="account-settings-section" aria-labelledby="currentPlanTitle">
        <h2 id="currentPlanTitle">Current plan</h2>
        <p className="card-sub">One plan for all your sites.</p>
        <div className="plan-summary" id="planSummary" />
        <div className="plan-banner" id="planBanner" role="status" aria-live="polite" hidden />
        <div className="billing-actions"><button className="btn" id="billingPortal" type="button" hidden>Manage subscription</button><p className="hint" id="billingStatus" role="status" aria-live="polite">Checking billing availability…</p></div>
      </section>
      <section className="account-settings-section billing-plans" aria-labelledby="comparePlansTitle">
        <div className="billing-section-head"><div><h2 id="comparePlansTitle">A plan for your community</h2><p className="card-sub">Start small. Add capacity as your community grows.</p></div><fieldset className="billing-interval"><legend className="sr-only">Billing interval</legend><label><input type="radio" name="billingInterval" value="monthly" defaultChecked />Monthly</label><label><input type="radio" name="billingInterval" value="annual" />Annual <span>2 months free</span></label></fieldset></div>
        <div className="plan-grid" id="planGrid" />
        <div className="plan-trial" id="planTrial" hidden><p className="hint">Not ready to pay? Try every Pro feature free for 7 days.</p><button className="btn btn--accent" id="trialBtn" type="button">Start free Pro trial</button><p className="status" id="trialStatus" role="status" aria-live="polite" /></div>
        <p className="hint" id="planHint">Prices in USD. Taxes, if applicable, are shown at checkout.</p>
      </section>
      <section className="account-settings-section" aria-labelledby="planUsageTitle">
        <div className="billing-section-head"><div><h2 id="planUsageTitle">Usage</h2><p className="card-sub">Current usage loads automatically.</p></div></div>
        <div className="plan-usage" id="planUsage" aria-live="polite"><p className="hint">Loading usage…</p></div>
      </section>
      <section className="account-settings-section" id="historyCard" hidden aria-labelledby="paymentHistoryTitle">
        <h2 id="paymentHistoryTitle">Payment history</h2>
        <p className="card-sub">Past payments and grants. These records do not change your current plan. Download invoices from Manage subscription.</p>
        <div className="admin-table-wrap"><table className="admin-table" id="historyTable"><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead><tbody id="historyBody" /></table></div>
        <div className="empty" id="historyEmpty" hidden>No payments yet. Completed payments and receipts will appear here after you upgrade.</div>
      </section>
    </div>
  );
});

function TeamPanel({ user, deps }: { user: User; deps: SettingsDependencies }) {
  const boards = user.boards || [];
  const [selectedSiteId, setSelectedSiteId] = useState(() => {
    if (typeof location === "undefined") return state.ACTIVE_SITE_ID || boards[0]?.id || "";
    return new URLSearchParams(location.search).get("siteId") || state.ACTIVE_SITE_ID || boards[0]?.id || "";
  });
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [busyActions, setBusyActions] = useState<string[]>([]);
  const version = useRef(0);
  const inviteLinks = useRef(new Map<string, string>());

  const loadTeam = useCallback(async () => {
    const current = ++version.current;
    setLoading(true);
    const path = selectedSiteId ? `/api/site/team?siteId=${encodeURIComponent(selectedSiteId)}` : "/api/site/team";
    try {
      const result = await deps.request<TeamData>("GET", path);
      if (current !== version.current) return;
      setTeam(result.ok ? { ...result.data, ok: true } : { ok: false, error: statusMessage(result.data, "Failed to load team") });
    } catch {
      if (current === version.current) setTeam({ ok: false, error: "Could not load this site's team. Reload to try again." });
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [deps, selectedSiteId]);

  useEffect(() => {
    void loadTeam();
    return () => { version.current += 1; };
  }, [loadTeam]);

  useEffect(() => {
    if (!team?.ok || typeof location === "undefined") return;
    const params = new URLSearchParams(location.search);
    if (params.get("invite") !== "1") return;
    params.delete("invite");
    history.replaceState({}, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
    setInviteOpen(true);
  }, [team?.ok]);

  const data = team?.ok ? team : null;
  const siteId = data?.siteId || "";
  const displayedSiteId = selectedSiteId || data?.siteId || "";
  const siteName = data?.siteName || siteId;
  const members = data?.members || [];
  const invites = data?.invites || [];
  const canManage = data?.canManageTeam === true;
  const role = data?.currentRole || "";
  const plan = data?.seats?.plan || "free";
  const used = Math.max(1, Number(data?.seats?.used) || 1);
  const limit = Math.max(1, Number(data?.seats?.limit) || 1);
  const atLimit = used >= limit;
  const failed = team !== null && !team.ok;

  async function confirmAction(title: string, body: string, confirmText: string, action: () => Promise<void>) {
    if (!await deps.confirm(title, body, confirmText, true)) return;
    await action();
  }

  async function removeMember(memberId: string) {
    const requestSiteId = siteId;
    const actionKey = `member:${memberId}`;
    await confirmAction("Remove team member", `They will lose access to ${siteName}. You can invite them again later.`, "Remove member", async () => {
      setBusyActions((current) => [...current, actionKey]);
      try {
        const result = await deps.request("POST", "/api/site/team/remove", { targetUserId: memberId, siteId: requestSiteId });
        if (result.ok) { reportStatus("Member removed"); void loadTeam(); }
        else reportStatus(statusMessage(result.data, "Failed to remove member"), true);
      } catch {
        reportStatus("Failed to remove member", true);
      } finally {
        setBusyActions((current) => current.filter((key) => key !== actionKey));
      }
    });
  }

  async function revokeInvite(inviteId: string) {
    const requestSiteId = siteId;
    const actionKey = `invite:${inviteId}`;
    await confirmAction("Revoke invitation", `This invite link for ${siteName} will stop working. You can create a new one later.`, "Revoke invite", async () => {
      setBusyActions((current) => [...current, actionKey]);
      try {
        const result = await deps.request("POST", "/api/site/team/invite/revoke", { inviteId, siteId: requestSiteId });
        if (result.ok) {
          inviteLinks.current.delete(inviteId);
          reportStatus("Invitation revoked");
          void loadTeam();
        } else reportStatus(statusMessage(result.data, "Failed to revoke invite"), true);
      } catch {
        reportStatus("Failed to revoke invite", true);
      } finally {
        setBusyActions((current) => current.filter((key) => key !== actionKey));
      }
    });
  }

  async function resendInvite(invite: TeamInvite) {
    const requestSiteId = siteId;
    if (!await deps.confirm("Resend invitation", `Send a new invitation to ${invite.email}? The old link will stop working.`, "Resend invitation")) return;
    const actionKey = `resend:${invite.id}`;
    setBusyActions((current) => [...current, actionKey]);
    try {
      const result = await deps.request<{ inviteUrl?: string; emailSent?: boolean }>("POST", "/api/site/team/invite", { email: invite.email, role: "moderator", siteId: requestSiteId, sendEmail: true });
      if (result.ok) {
        if (result.data.inviteUrl) inviteLinks.current.set(invite.id, result.data.inviteUrl);
        reportStatus(result.data.emailSent ? "Invitation sent." : "Email could not be delivered. Copy and share the new link.", !result.data.emailSent);
        void loadTeam();
      } else reportStatus(statusMessage(result.data, "Could not resend invitation."), true);
    } catch {
      reportStatus("Could not resend invitation. Try again.", true);
    } finally {
      setBusyActions((current) => current.filter((key) => key !== actionKey));
    }
  }

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) {
      setInviteStatus("Please enter a valid email.");
      document.getElementById("inviteEmail")?.focus();
      return;
    }
    const requestSiteId = siteId;
    setInviteBusy(true);
    try {
      const result = await deps.request<{ inviteUrl?: string }>("POST", "/api/site/team/invite", { email, role: "moderator", siteId: requestSiteId });
      if (result.ok) {
        setInviteStatus("Invitation ready!");
        setInviteLink(result.data.inviteUrl || "");
        void loadTeam();
      } else setInviteStatus(statusMessage(result.data, "Failed to create invitation."));
    } catch {
      setInviteStatus("Failed to create invitation.");
    } finally {
      setInviteBusy(false);
    }
  }

  function closeInvite() {
    setInviteOpen(false);
    void loadTeam();
  }

  return (
    <>
      <div className="lb-widget lb-widget--full" id="team">
        <div className="team-head">
          <div className="team-head-main"><h2 className="m-0">Team</h2><p className="card-sub m-0 mt-2">Members shown for the selected site. Changing the filter does not change access.</p></div>
          <div className="team-head-actions">
            <label htmlFor="teamSiteSelector">Selected site <select className="field-select" id="teamSiteSelector" value={failed ? "" : displayedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)}><option value="">Select a site</option>{boards.map((board) => <option value={board.id} key={board.id}>{board.name || board.slug || "Site"}</option>)}</select></label>
            <button className="btn btn--accent" id="btnOpenInviteModal" type="button" hidden={!canManage || plan !== "team"} disabled={atLimit || loading} onClick={() => { setInviteEmail(""); setInviteStatus(""); setInviteLink(""); setInviteOpen(true); }}>{atLimit ? "Seats full" : "Invite member"}</button>
            <a className="btn btn--accent" id="teamUpgradeLink" href="/help/support?area=billing&amp;return=/dashboard/settings" hidden={!canManage || plan === "team"} onClick={() => trackFunnel("upgrade_clicked", "team_collaboration")}>Contact support about Team</a>
          </div>
        </div>
        <div className="team-seat-strip" aria-live="polite">
          <span className="v3-chip v3-chip--pro" id="teamPlanChip">{loading || failed ? "Plan" : ({ free: "Free", starter: "Starter", pro: "Pro", team: "Team" } as Record<string, string>)[plan] || plan}</span>
          <div className="team-seat-meter" aria-hidden="true"><i id="teamSeatBar" style={{ width: loading || failed ? "0%" : `${Math.min(100, Math.round((used / limit) * 100))}%` }} /></div>
          <div className="team-seat-copy"><strong id="teamSeatUsage">{loading ? "Loading team seats…" : failed ? "Operator seats unavailable" : `${used} used · ${Math.max(0, limit - used)} available`}</strong><span id="teamSeatContext">{loading ? "Account-wide seat usage across the owner's sites." : failed ? "Reload to try again." : plan === "team" ? atLimit ? "All seats in use. Pending invitations reserve a seat across the owner's sites; remove a member or revoke an invite to free one." : "Pending invitations reserve a seat across the owner's sites." : "Free, Starter and Pro include the owner only; saved Moderator access is paused."}</span></div>
        </div>
        <p className="account-team-notice" id="teamPlanNotice" hidden={!canManage || plan === "team" || failed}>Additional operators require Team. Existing Moderator records are preserved and regain access when Team returns.</p>
        <p className="account-team-notice" id="teamScheduledNotice" hidden={!data?.scheduledChange || data.scheduledChange.plan === "team"}>Scheduled change: {({ free: "Free", starter: "Starter", pro: "Pro" } as Record<string, string>)[data?.scheduledChange?.plan || ""] || ""} starting {data?.scheduledChange?.appliesAt ? fmtDate(data.scheduledChange.appliesAt) : "the end of this billing period"}. Team seats and member access stay active until then. After Team ends, moderator access pauses; members are not deleted.</p>
        <p className="account-team-notice" id="teamReadOnlyNotice" hidden={role !== "moderator" || failed}>You can see who operates this site. Only the owner can invite or remove operators.</p>
        <div className="acc-team-section"><h3 className="m-0 mb-8">Members</h3><div id="teamMembersList">{loading ? <p className="hint">Loading team members…</p> : !data ? <p className="hint">{team?.error || "Could not load team members."}</p> : members.length === 0 ? <div className="empty"><strong>No team members yet</strong><p>Invite someone when you are ready to share site management.</p></div> : <div className="account-team-list account-team-table" aria-label={`Members for ${siteName}`}><div className="account-team-columns" aria-hidden="true"><span>Member</span><span>Role</span><span>Site access</span><span>Status</span><span>Actions</span></div>{members.map((member) => <div className="account-team-row" key={member.userId}><div className="account-team-person"><strong>{member.displayName || member.email.split("@")[0]}</strong><a href={`mailto:${member.email}`}>{member.email}</a><span>Joined {member.createdAt ? fmtDate(member.createdAt) : "Unknown"}</span></div><div><span className={`v3-chip team-badge team-badge--${member.role === "owner" ? "owner" : "mod"}`}>{member.role === "owner" ? "Owner" : "Moderator"}</span></div><div className="hint">{member.role === "owner" ? "All sites" : member.siteAccess?.join(", ") || siteName}</div><div><span className={`v3-chip ${member.accessStatus === "paused" ? "v3-chip--pending" : "v3-chip--fulfilled"}`}>{member.accessStatus === "paused" ? "Access paused" : "Active"}</span></div>{canManage && member.role !== "owner" ? <div className="account-team-actions"><button className="btn btn--sm btn--ghost team-remove-btn" type="button" disabled={busyActions.includes(`member:${member.userId}`)} onClick={() => void removeMember(member.userId)}>{busyActions.includes(`member:${member.userId}`) ? "Removing…" : "Remove"}</button></div> : <span className="hint">—</span>}</div>)}</div>}</div></div>
        <div className="acc-team-section" id="teamPendingSection" hidden={!failed && (!canManage || invites.length === 0)}>
          <h3 className="m-0 mb-8">Pending invitations</h3>
          <div id="teamInvitesList">
            {failed ? (
              <p className="hint">Unavailable</p>
            ) : (
              <div className="account-team-list account-team-table" aria-label="Pending invitations">
                <div className="account-team-columns" aria-hidden="true"><span>Email / invited</span><span>Role</span><span>Site access</span><span>Status / seat</span><span>Actions</span></div>
                {invites.map((invite) => (
                  <div className="account-team-row" key={invite.id}>
                    <div className="account-team-person"><strong>{invite.email}</strong><span>Invited {fmtDate(invite.createdAt)}</span></div>
                    <div><span className="v3-chip team-badge team-badge--mod">Moderator</span></div>
                    <div className="hint">{siteName}</div>
                    <div><span className="v3-chip v3-chip--pending">Pending</span><div className="hint">Seat reserved</div></div>
                    <div className="account-team-actions">
                      {inviteLinks.current.get(invite.id) || invite.inviteUrl ? <button className="btn btn--sm btn--ghost" type="button" onClick={(event) => { const button = event.currentTarget; void deps.copy(inviteLinks.current.get(invite.id) || invite.inviteUrl || "").then((ok) => flashButton(button, ok ? "Copied!" : "Copy failed")); }}>Copy link</button> : <span className="hint">Link shown when created</span>}
                      {canManage && <>
                        <button className="btn btn--sm btn--ghost team-resend-invite-btn" type="button" disabled={busyActions.includes(`resend:${invite.id}`)} onClick={() => void resendInvite(invite)}>{busyActions.includes(`resend:${invite.id}`) ? "Resending…" : "Resend"}</button>
                        <button className="btn btn--sm btn--ghost team-revoke-invite-btn" type="button" disabled={busyActions.includes(`invite:${invite.id}`)} onClick={() => void revokeInvite(invite.id)}>{busyActions.includes(`invite:${invite.id}`) ? "Revoking…" : "Revoke"}</button>
                      </>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <details className="account-settings-disclosure acc-team-roles-guide"><summary>Roles &amp; permissions · Compare roles</summary><div className="account-settings-disclosure-body"><table className="team-role-compare"><thead><tr><th scope="col">Capability</th><th scope="col">Owner</th><th scope="col">Moderator</th></tr></thead><tbody><tr><th scope="row">Members, reviews &amp; claims</th><td className="team-role-yes">Yes</td><td className="team-role-yes">Yes</td></tr><tr><th scope="row">Activities, rewards &amp; shop</th><td className="team-role-yes">Yes</td><td className="team-role-yes">Yes</td></tr><tr><th scope="row">Operational insights</th><td className="team-role-yes">Yes</td><td>Read-only</td></tr><tr><th scope="row">Site settings &amp; connections</th><td className="team-role-yes">Yes</td><td className="team-role-no">No</td></tr><tr><th scope="row">Team, billing &amp; security</th><td className="team-role-yes">Yes</td><td className="team-role-no">No</td></tr><tr><th scope="row">Manual credit adjustments</th><td className="team-role-yes">Yes</td><td className="team-role-no">No</td></tr></tbody></table></div></details>
      </div>
      <Dialog open={inviteOpen} onOpenChange={(open) => { if (open) setInviteOpen(true); else closeInvite(); }}>
        <DialogContent id="inviteMemberModal" aria-describedby="inviteModalDescription">
          <DialogHeader><DialogTitle id="inviteModalTitle">Invite team member</DialogTitle><DialogDescription id="inviteModalDescription">Invite this person as a Moderator for {siteName}.</DialogDescription></DialogHeader>
          <div className="field"><Label htmlFor="inviteEmail">Email address</Label><Input id="inviteEmail" type="email" autoComplete="email" placeholder="creator@example.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required autoFocus /></div>
          <div className="field"><span className="field-label" id="inviteRoleLabel">Role</span><p className="account-invite-role" aria-labelledby="inviteRoleLabel"><strong>Moderator</strong><span>Site-scoped community operations without Team, billing, security, settings, connection, or manual-credit control.</span></p></div>
          <div className="field"><span className="field-label">Site access</span><p id="inviteSiteAccess">{siteName || "Selected site"}</p></div>
          <p className="hint">This pending invitation reserves one Team seat across your account until accepted, revoked, or expired.</p>
          <DialogFooter><Button variant="default" id="btnSendInvite" type="button" disabled={inviteBusy} aria-busy={inviteBusy} onClick={() => void sendInvite()}>{inviteBusy ? "Creating…" : "Create invite"}</Button><Button variant="ghost" id="btnCloseInviteModal" type="button" onClick={closeInvite}>Cancel</Button></DialogFooter>
          <p className="status" id="inviteModalStatus" role="status" aria-live="polite">{inviteStatus}</p>
          {inviteLink && <div id="inviteResultWrap"><Label htmlFor="inviteLinkInput">Invite link</Label><div className="d-flex gap-8 items-center flex-wrap"><Input id="inviteLinkInput" type="text" readOnly value={inviteLink} /><Button variant="outline" id="btnCopyInviteLink" type="button" onClick={(event) => { const button = event.currentTarget; void deps.copy(inviteLink).then((ok) => flashButton(button, ok ? "Copied!" : "Copy failed")); }}>Copy link</Button></div><p className="hint">This link is valid for 7 days.</p></div>}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConnectionsPanel({ deps }: { deps: SettingsDependencies }) {
  const [data, setData] = useState<ConnectionData | null>(null);
  const [postbacks, setPostbacks] = useState<PostbackData | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [postbacksLoading, setPostbacksLoading] = useState(true);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [postbackBusy, setPostbackBusy] = useState(false);
  const [postbackTestBusy, setPostbackTestBusy] = useState(false);
  const [postbackTestStatus, setPostbackTestStatus] = useState("");
  const [postbackTestError, setPostbackTestError] = useState(false);
  const board = useMemo(() => {
    if (typeof location === "undefined") return state.ACTIVE_SITE_ID || "";
    return new URLSearchParams(location.search).get("board") || new URLSearchParams(location.search).get("siteId") || state.ACTIVE_SITE_ID || "";
  }, []);
  const loadConnections = useCallback(async () => {
    try {
      let siteId = board;
      if (!siteId) {
        const site = await deps.request<{ siteId?: string }>("GET", "/api/site");
        siteId = site.ok ? text(site.data.siteId) : "";
        if (siteId) (state as MutableSettingsState).ACTIVE_SITE_ID = siteId;
      }
      const result = await deps.request<ConnectionData>("GET", `/api/account/connected-accounts${siteId ? `?board=${encodeURIComponent(siteId)}` : ""}`);
      setData(result.ok ? result.data : { error: statusMessage(result.data, "failed") });
    } catch {
      setData({ error: "failed" });
    } finally {
      setConnectionsLoading(false);
    }
  }, [board, deps]);
  const loadPostbacks = useCallback(async () => {
    try {
      const result = await deps.request<PostbackData>("GET", "/api/account/postbacks");
      setPostbacks(result.ok ? result.data : { error: statusMessage(result.data, "Could not load conversion tracking.") });
    } catch (error) {
      logError("loadPostbacks", error);
      setPostbacks({ error: "Could not load conversion tracking. Try again." });
    } finally {
      setPostbacksLoading(false);
    }
  }, [deps]);
  useEffect(() => { void loadConnections(); void loadPostbacks(); }, [loadConnections, loadPostbacks]);
  useEffect(() => {
    if (!postbacks?.upgrade) return;
    const upgrade = document.getElementById("postbackUpgrade");
    if (upgrade) wirePlanLock(upgrade, "telegram_postbacks");
  }, [postbacks?.upgrade]);

  async function unlinkTelegram() {
    if (!await deps.confirm("Disconnect Telegram", "Telegram login and bot management for this account stop until you connect again.", "Disconnect", true)) return;
    setTelegramBusy(true);
    try {
      const result = await deps.request("POST", "/api/auth/telegram/unlink", {});
      if (result.ok) void loadConnections();
      else showToast(statusMessage(result.data, "Could not disconnect Telegram. Try again."), "error");
    } catch {
      showToast("Could not disconnect Telegram. Try again.", "error");
    } finally {
      setTelegramBusy(false);
    }
  }

  const connections = data?.connections || [];
  const accountConnections = connections.filter((connection) => !connection.id?.includes("-site:"));
  const siteConnections = connections.filter((connection) => connection.selectedSite);
  const canManage = data?.capabilities?.canRoleManageConnections === true;
  const row = (connection: Connection, siteLevel = false) => {
    const muted = connection.statusLabel === "Not connected" || connection.statusLabel === "Not configured";
    const action = connection.action?.kind === "manage_telegram"
      ? <details className="account-connection-manage"><summary className="btn btn--sm btn--ghost">Manage</summary><button className="btn btn--sm btn--ghost" type="button" id="tgDisconnect" disabled={telegramBusy} onClick={() => void unlinkTelegram()}>{telegramBusy ? "Disconnecting…" : "Disconnect account"}</button></details>
      : siteLevel && !canManage
        ? <span className="account-connection-readonly">Managed by site owner</span>
        : connection.action?.href
          ? <a className="btn btn--sm btn--ghost" href={connection.action.href}>{connection.action.label}</a>
          : null;
    return <div className="account-connection-row" key={connection.id || connection.provider}><div><strong>{connection.provider}</strong>{connection.detail && <p>{connection.detail}</p>}</div><span className={`account-connection-status${muted ? " is-muted" : ""}`}>{connection.statusLabel}</span>{action}</div>;
  };
  const health = data?.integrationHealth || {};
  const healthRows: Array<[string, { status?: string; issueHref?: string | null } | undefined]> = [["Kick reward ingest", health.kickIngest], ["Discord delivery health", health.discordDelivery], ["Telegram delivery health", health.telegramDelivery]];

  async function rotatePostback() {
    if (!await deps.confirm("Rotate conversion tracking key", "This will revoke the existing key immediately. Updates sent with the old key will fail.", "Rotate", true)) return;
    setPostbackBusy(true);
    try {
      const result = await deps.request<PostbackData>("POST", "/api/account/postbacks/rotate");
      if (result.ok) {
        setPostbacks((old) => ({ ...(old || {}), ...result.data, status: "pending" }));
        showToast("Conversion tracking key rotated.", "success");
      } else showToast(statusMessage(result.data, "Could not rotate key."), "error");
    } catch {
      showToast("Could not rotate key.", "error");
    } finally {
      setPostbackBusy(false);
    }
  }
  async function revokePostback() {
    if (!await deps.confirm("Revoke conversion tracking key", "Score updates will stop until a new key is created.", "Revoke", true)) return;
    setPostbackBusy(true);
    try {
      const result = await deps.request("DELETE", "/api/account/postbacks");
      if (result.ok) {
        setPostbacks({ postback: null, status: "not_configured", conversions: [] });
        showToast("Conversion tracking key revoked.", "success");
      } else showToast(statusMessage(result.data, "Could not revoke key."), "error");
    } catch {
      showToast("Could not revoke key.", "error");
    } finally {
      setPostbackBusy(false);
    }
  }

  async function testPostback() {
    setPostbackTestBusy(true);
    setPostbackTestStatus("Sending test conversion…");
    setPostbackTestError(false);
    try {
      const result = await deps.request<{ message?: string }>("POST", "/api/account/postbacks/test");
      if (result.ok) {
        setPostbackTestStatus(text(result.data.message));
        await loadPostbacks();
      } else {
        setPostbackTestStatus(statusMessage(result.data, "Test failed."));
        setPostbackTestError(true);
      }
    } catch {
      setPostbackTestStatus("Test failed.");
      setPostbackTestError(true);
    } finally {
      setPostbackTestBusy(false);
    }
  }

  return (
    <div className="account-connections-groups" id="connected">
      <section className="lb-widget lb-widget--full account-connections-group" aria-labelledby="accountConnectionsTitle">
        <h2 id="accountConnectionsTitle">Account connections</h2>
        <p className="card-sub">Accounts linked to you.</p>
        <div id="connectedAccounts" aria-live="polite">
          {data?.error ? <p className="error">Could not load account connections.</p> : connectionsLoading ? <p className="hint">Loading account connections…</p> : <div className="account-connection-list">{accountConnections.map((connection) => row(connection))}</div>}
        </div>
      </section>
      <section className="lb-widget lb-widget--full account-connections-group" aria-labelledby="siteConnectionsTitle">
        <h2 id="siteConnectionsTitle">Site connections — <span id="siteConnectionName">{data?.selectedSiteName || "selected site"}</span></h2>
        <p className="card-sub">Settings for this site.</p>
        <div id="siteConnectionsList" aria-live="polite">
          {data?.error ? <p className="error">Could not load site connections.</p> : connectionsLoading ? <p className="hint">Loading site connections…</p> : siteConnections.length ? <div className="account-connection-list">{siteConnections.map((connection) => row(connection, true))}</div> : <p className="hint">Select a site to manage its connections.</p>}
        </div>
      </section>
      <section className="lb-widget lb-widget--full account-connections-group" id="integrationHealth" aria-labelledby="integrationHealthTitle">
        <h2 id="integrationHealthTitle">Integration health</h2>
        <div id="integrationHealthBody" aria-live="polite">
          {data?.error ? <p className="error">Could not load integration health.</p> : connectionsLoading ? <p className="hint">Loading integration health…</p> : !data?.selectedSiteId ? <p className="hint">Select a site to view integration health.</p> : <div className="account-connection-list">{healthRows.map(([label, item]) => {
            const current = item?.status || "not_tested";
            const statusLabel = ({ healthy: "Healthy", failing: "Failing", not_configured: "Not configured", not_tested: "Not tested" } as Record<string, string>)[current] || "Not tested";
            return <div className="account-connection-row" key={label}><div><strong>{label}</strong></div><span className={`account-connection-status ${current === "failing" ? "is-warning" : current === "healthy" ? "is-healthy" : "is-muted"}`}>{statusLabel}</span>{current === "failing" && item?.issueHref && <a className="btn btn--sm btn--ghost" href={item.issueHref}>View issue</a>}</div>;
          })}</div>}
        </div>
      </section>
      <PostbacksPanel data={postbacks} loading={postbacksLoading} testBusy={postbackTestBusy} testStatus={postbackTestStatus} testError={postbackTestError} actionBusy={postbackBusy} onTest={() => void testPostback()} onRotate={() => void rotatePostback()} onRevoke={() => void revokePostback()} deps={deps} />
    </div>
  );
}

function PostbacksPanel({ data, loading, testBusy, testStatus, testError, actionBusy, onTest, onRotate, onRevoke, deps }: { data: PostbackData | null; loading: boolean; testBusy: boolean; testStatus: string; testError: boolean; actionBusy: boolean; onTest: () => void; onRotate: () => void; onRevoke: () => void; deps: SettingsDependencies }) {
  const postback = data?.postback;
  const copy = async (value: string, button: HTMLButtonElement) => { const ok = await deps.copy(value); flashButton(button, ok ? "Copied!" : "Copy failed"); };
  const conversions = data?.conversions || [];
  const active = data?.status === "active";
  const managerGuide = `Conversion tracking link: ${postback?.signedEndpoint || ""}
Method: POST
Sign the raw query string with HMAC-SHA256 using your conversion tracking key, then send the hex signature in the X-Postback-Signature header.
Also include X-Postback-Key with your key.
Legacy unsigned link: ${postback?.legacyUrl || "deprecated"} (sunset ${postback?.legacyUrl ? "2026-10-01" : ""})`;
  return (
    <details className="lb-widget lb-widget--full account-settings-disclosure" id="postbacks" data-ui-advanced>
      <summary>Sponsor score updates</summary>
      <div className="account-settings-disclosure-body">
        <p className="card-sub">Connect a sponsor so confirmed activity can update player scores automatically.</p>
        {loading ? <p className="hint" aria-live="polite">Loading conversion tracking…</p> : data?.error ? <p className="error" role="alert">{data.error}</p> : data?.upgrade ? (
          <div id="postbackUpgrade">
            <p className="hint">Automatic score updates are a paid feature. Upgrade to Pro to create connection keys and view live score updates.</p>
            <a className="btn btn--accent" href="/dashboard/settings/billing">See billing</a>
          </div>
        ) : (
          <>
            <div id="postbackStatusCard" className="card card--status">
              <div className="d-flex items-center gap-8">
                <span className={`status-dot ${postback ? active ? "status-dot--ok" : "status-dot--pending" : "status-dot--off"}`} id="postbackStatusDot" />
                <b id="postbackStatusText">{postback ? active ? "Active — receiving conversions" : "Pending — no conversion received yet" : "Not configured"}</b>
              </div>
              <p className="hint" id="postbackStatusHint">{postback ? active ? `Last conversion received: ${fmtDateTime(postback.lastUsedAt)}` : `Key created: ${fmtDateTime(postback.createdAt)}. Send the setup block below to your sponsor or integration partner.` : "Create a conversion tracking key to start receiving updates."}</p>
            </div>
            {postback && (
              <>
                <div id="postbackShareCard">
                  <h3>What to send your sponsor or affiliate manager</h3>
                  <p className="hint">Give this secure conversion tracking link to your sponsor or integration partner. It connects to your leaderboard without exposing your private account password.</p>
                  <div className="field">
                    <Label>Conversion tracking link</Label>
                    <div className="d-flex gap-8 items-center flex-wrap">
                      <code id="postbackSigned">{postback.signedEndpoint}</code>
                      <button className="btn btn--sm btn--accent" id="postbackCopySigned" type="button" onClick={(event) => void copy(postback.signedEndpoint || "", event.currentTarget)}>Copy link</button>
                    </div>
                  </div>
                  <div className="field">
                    <Label>Conversion tracking setup guide</Label>
                    <p className="hint">Your sponsor uses this guide to send confirmed activity updates to your leaderboard.</p>
                    <button className="btn btn--sm btn--ghost" id="postbackCopyManager" type="button" onClick={(event) => void copy(managerGuide, event.currentTarget)}>Copy full setup guide for sponsor</button>
                  </div>
                  <div className="field">
                    <Label>Test live updates</Label>
                    <p className="hint">Send a simulated player score update to verify your leaderboard updates in real time.</p>
                    <button className="btn btn--sm" id="postbackTest" type="button" disabled={testBusy} aria-busy={testBusy} onClick={onTest}>{testBusy ? "Sending…" : "Send test score update"}</button>
                    <span className={`hint${testError ? " hint--error" : testStatus && !testBusy ? " hint--success" : ""}`} id="postbackTestStatus" role="status" aria-live="polite">{testStatus}</span>
                  </div>
                </div>
                <div id="postbackKeyCard">
                  <h3>Private sponsor access key</h3>
                  <p className="hint">Keep this key confidential. Only share it with trusted connected apps. Rotating revokes the previous key instantly.</p>
                  <div className="field">
                    <Label>Your private key</Label>
                    <div className="d-flex gap-8 items-center flex-wrap">
                      <code id="postbackKey">{postback.key}</code>
                      <button className="btn btn--sm btn--accent" id="postbackCopyKey" type="button" onClick={(event) => void copy(postback.key || "", event.currentTarget)}>Copy key</button>
                      <button className="btn btn--sm" id="postbackRotate" type="button" disabled={actionBusy} onClick={onRotate}>Generate new key</button>
                      <button className="btn btn--sm btn--danger" id="postbackRevoke" type="button" disabled={actionBusy} onClick={onRevoke}>Deactivate key</button>
                    </div>
                  </div>
                </div>
                <details className="adv" id="postbackAdvanced">
                  <summary>Legacy setup</summary>
                  <div className="field mt-14">
                    <Label>Legacy link (sunset 2026)</Label>
                    <div className="d-flex gap-8 items-center flex-wrap">
                      <code id="postbackLegacy">{postback.legacyUrl}</code>
                      <button className="btn btn--sm" id="postbackCopyLegacy" type="button" onClick={(event) => void copy(postback.legacyUrl || "", event.currentTarget)}>Copy</button>
                    </div>
                    <p className="hint">This older link is kept for compatibility and may stop working after the date shown above.</p>
                  </div>
                </details>
              </>
            )}
          </>
        )}
        <hr className="hr" />
        <h3>Recent sponsor activity</h3>
        <div className="admin-table-wrap">
          <table className="admin-table" id="conversionsTable" hidden={!conversions.length || loading || Boolean(data?.error)}>
            <thead><tr><th>Time</th><th>Event</th><th>Score / Amount</th><th>Currency</th><th>Campaign / Offer</th></tr></thead>
            <tbody id="conversionsBody">{conversions.map((conversion, index) => <tr key={`${conversion.at || "row"}-${index}`}><td>{conversion.at || "—"}</td><td>{conversion.event || "—"}</td><td>{conversion.amount == null ? "—" : Number(conversion.amount).toFixed(2)}</td><td>{conversion.currency || "—"}</td><td>{conversion.offer || "—"}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="empty" id="conversionsEmpty" hidden={Boolean(conversions.length) || Boolean(data?.error)}>{loading ? "Loading sponsor activity…" : "No sponsor activity yet. Connect conversion tracking to see updates here."}</p>
      </div>
    </details>
  );
}

function DataPanel({ deps }: { deps: SettingsDependencies }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => { if (busy) return; setOpen(false); setConfirm(""); setPassword(""); setPasswordRequired(false); setStatus(""); };
  async function submit() {
    if (confirm.trim() !== "DELETE") { setStatus("Type DELETE exactly to confirm."); return; }
    if (passwordRequired && !password.trim()) { setStatus("Enter your password."); return; }
    setBusy(true);
    setStatus("Deleting your complete account…");
    let result: DeleteAccountResult;
    try {
      result = await deps.deleteAccount(passwordRequired ? password.trim() : undefined);
    } catch {
      setStatus("Couldn't delete account. Try again.");
      setBusy(false);
      return;
    }
    if (result.status === 400 && result.data.error && String(result.data.error).includes("Password required")) {
      setPasswordRequired(true);
      setStatus("Enter your password to confirm deletion.");
      setBusy(false);
      return;
    }
    if (result.ok) { setStatus("Account deleted. Redirecting…"); deps.navigate("/"); return; }
    setStatus(result.data.error ? String(result.data.error) : "Deletion failed. Try again.");
    setBusy(false);
  }
  return <div className="lb-widget lb-widget--full" id="data"><section className="account-settings-section account-data-export" aria-labelledby="accountExportTitle"><h2 id="accountExportTitle">Export your data</h2><p className="card-sub">Keep a copy of the community you have built.</p><ul className="data-export-includes"><li>Account &amp; site settings</li><li>Leaderboard players</li><li>Shop items</li><li>Analytics</li></ul><p className="hint">Generate your export, then download it when it is ready. Your sites stay available while it is prepared.</p><div className="d-flex gap-8 items-center flex-wrap"><button className="btn btn--accent" id="accExportData" type="button">Generate export</button><span className="hint" id="accExportStatus" role="status" aria-live="polite" /></div></section><section className="account-settings-section account-danger-zone" aria-labelledby="accountDangerTitle"><div><h2 id="accountDangerTitle">Delete account</h2><p className="card-sub">Permanently delete your creator account and all of its sites. This cannot be undone.</p><p className="hint">Download an export first if you want to keep your records.</p></div><button className="btn btn--danger" id="deleteAccountBtn" type="button" onClick={() => { setOpen(true); setStatus(""); }}>Delete account</button></section><Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}><DialogContent id="deleteAccountModal" aria-describedby="deleteAccountModalDescription"><DialogHeader><DialogTitle id="deleteAccountModalTitle">Delete your account?</DialogTitle><DialogDescription id="deleteAccountModalDescription">This will remove all your data — leaderboards, players, archives, subscriptions, and connected bots. This cannot be undone.</DialogDescription></DialogHeader><div className="field"><Label htmlFor="deleteAccountConfirm">Type <b>DELETE</b> to confirm</Label><Input id="deleteAccountConfirm" autoComplete="off" placeholder="DELETE" value={confirm} onChange={(event) => setConfirm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} autoFocus /></div>{passwordRequired && <div className="field" id="deleteAccountPasswordWrap"><Label htmlFor="deleteAccountPassword">Enter your password</Label><Input id="deleteAccountPassword" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} autoFocus /></div>}<DialogFooter><Button variant="destructive" id="deleteAccountConfirmBtn" type="button" disabled={busy} aria-busy={busy} onClick={() => void submit()}>{busy ? "Deleting…" : "Delete my account"}</Button><Button variant="ghost" id="deleteAccountCancelBtn" type="button" disabled={busy} onClick={close}>Cancel</Button></DialogFooter><p id="deleteAccountModalStatus" role="status" aria-live="polite">{status}</p></DialogContent></Dialog></div>;
}

function SettingsPage({ deps }: { deps?: Partial<SettingsDependencies> }) {
  const resolved = useMemo(() => ({ ...defaults, ...deps }), [deps]);
  const [active, setActive] = useState(initialTab);
  const [routeRevision, setRouteRevision] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState("");
  const select = useCallback((key: string) => setActive(SETTINGS_TABS.some(([tab]) => tab === key) ? key : "account"), []);
  const refreshRoute = useCallback((key: string) => {
    select(key);
    setRouteRevision((revision) => revision + 1);
  }, [select]);

  useEffect(() => {
    const unregister = registerRouteRenderer("settings", ({ tab }: { tab?: string }) => refreshRoute(tab || "account"));
    const onPopState = () => {
      const parsed = parseDynamicPath(location.pathname);
      const tab = parsed?.tab || initialTab();
      refreshRoute(tab);
      syncRouteChrome("settings", tab);
    };
    const inShell = (window as Window & { __yrSpaShell?: boolean }).__yrSpaShell;
    if (!inShell) addEventListener("popstate", onPopState);
    return () => { unregister(); if (!inShell) removeEventListener("popstate", onPopState); };
  }, [refreshRoute]);

  useEffect(() => {
    let mounted = true;
    void resolved.getCurrentUser().then((next) => {
      if (!mounted) return;
      if (isRecord(next)) {
        const currentUser = next as User;
        (state as MutableSettingsState).ME = currentUser;
        setUser(currentUser);
      } else setAuthError("Could not load your account.");
    }).catch((error: unknown) => {
      if (!mounted || handleAuthError(error)) return;
      logError("auth/me", error);
      setAuthError(error instanceof Error && error.message ? error.message : "Could not load your account.");
    });
    return () => { mounted = false; };
  }, [resolved]);

  useEffect(() => {
    const root = document.getElementById("acc-app");
    if (root) root.dataset.settingsActive = active;
  }, [active]);

  const activeInfo = SETTINGS_TABS.find(([key]) => key === active) || SETTINGS_TABS[0];
  const navigateTab = (key: string, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void resolved.route("settings", key);
  };
  const navigateTabByKeyboard = (index: number, event: ReactKeyboardEvent<HTMLAnchorElement>) => {
    let nextIndex = -1;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % SETTINGS_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = SETTINGS_TABS.length - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const [nextTab] = SETTINGS_TABS[nextIndex];
    event.currentTarget.parentElement?.querySelector<HTMLAnchorElement>(`[data-settings-tab="${nextTab}"]`)?.focus();
    void resolved.route("settings", nextTab);
  };
  return (
    <div className="yr-react account-body account-settings" data-settings-root="true">
      <div className="v3-head"><h1 data-chrome-h1="true">{activeInfo[1]}</h1><p className="v3-head-sub" data-settings-page-description>{activeInfo[2]}</p></div>
      <nav className="v3-tabs" aria-label="Settings sections" role="tablist">{SETTINGS_TABS.map(([key, label, description], index) => <a className={`v3-tab${active === key ? " is-on" : ""}`} href={`/dashboard/settings/${key === "plan" ? "billing" : key}`} id={`settings-tab-${key}`} role="tab" aria-controls={`settings-panel-${key}`} aria-selected={active === key} aria-current={active === key ? "page" : undefined} data-settings-tab={key} data-settings-description={description} tabIndex={active === key ? 0 : -1} key={key} onClick={(event) => navigateTab(key, event)} onKeyDown={(event) => navigateTabByKeyboard(index, event)}>{label}</a>)}</nav>
      <div className="account-settings-layout"><div className="account-settings-main"><section id="settings-panel-account" role="tabpanel" aria-labelledby="settings-tab-account" data-settings-panel="account" hidden={active !== "account"}>{user ? <AccountPanel user={user} deps={resolved} /> : <p className="hint">Loading account…</p>}</section><section id="settings-panel-team" role="tabpanel" aria-labelledby="settings-tab-team" data-settings-panel="team" hidden={active !== "team"}>{user ? <TeamPanel key={routeRevision} user={user} deps={resolved} /> : <p className="hint">Loading team…</p>}</section><section id="settings-panel-plan" role="tabpanel" aria-labelledby="settings-tab-plan" data-settings-panel="plan" hidden={active !== "plan"}>{user ? <PlanPanel /> : <p className="hint">Loading billing…</p>}</section><section id="settings-panel-connections" role="tabpanel" aria-labelledby="settings-tab-connections" data-settings-panel="connections" hidden={active !== "connections"}>{user ? <ConnectionsPanel key={routeRevision} deps={resolved} /> : <p className="hint">Loading connections…</p>}</section><section id="settings-panel-data" role="tabpanel" aria-labelledby="settings-tab-data" data-settings-panel="data" hidden={active !== "data"}>{user ? <><DataPanel deps={resolved} /><div className="account-related-setting"><div><strong>Looking for one site's data?</strong><p>Resetting, archiving, or deleting a site affects only the selected site.</p></div><a className="btn btn--ghost" href="/dashboard/site?tab=danger">Manage site data</a></div></> : <p className="hint">Loading account…</p>}</section></div><div className="account-settings-help"><span>Account settings apply to you. To change your website, use Site settings.</span><a href="/dashboard/site">Open Site settings</a><span aria-hidden="true">·</span><a href="/help/support?area=account">Open Help &amp; feedback</a></div></div>
      {authError && <p className="error" role="alert">{authError}</p>}
    </div>
  );
}

export { SettingsPage };
