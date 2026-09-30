import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  navigateToViewerCommunity,
  readViewerAuthState,
  setViewerTopAvatarImage,
  setViewerTopInitial,
  syncLoggedOutViewerChrome,
  syncSignedInViewerChrome,
  wireViewerRailLogout,
} from "./chrome";
import type {
  AccountViewId,
  ConnectedAccount,
  LoginProvider,
  ViewerAccount,
  ViewerAuthState,
  ViewerCommunity,
  ViewerMeResponse,
} from "./types";

const DEFAULT_SUBTITLE = "Manage the communities connected to your account. Your rewards and claims stay with each community.";
const GUEST_TITLE = "Your Viewer Account";
const GUEST_SUBTITLE = "Sign in to access your communities, rewards and balances.";
const LOGIN_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  rate_limited: "Too many sign-in attempts. Try again shortly.",
  missing_oauth_params: "The provider did not return the information needed. Try again.",
  oauth_state_expired: "That sign-in took too long. Try again.",
  access_denied: "Sign-in was cancelled.",
  kick_auth_failed: "We couldn't complete Kick sign-in. Try again.",
  discord_auth_failed: "We couldn't complete Discord sign-in. Try again.",
  kick_signin_unavailable: "Kick sign-in isn't available right now. Try again later.",
  discord_signin_unavailable: "Discord sign-in isn't available right now. Try again later.",
  kick_oauth_callback_mismatch: "Kick returned to an unexpected callback. Try again.",
  discord_oauth_callback_mismatch: "Discord returned to an unexpected callback. Try again.",
  kick_oauth_browser_mismatch: "Kick sign-in must finish in the browser where it started.",
  discord_oauth_browser_mismatch: "Discord sign-in must finish in the browser where it started.",
});
const LINK_RESULT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  link_requires_signin: "Sign in first, then connect another provider from Connected Accounts.",
  link_session_mismatch: "Connecting a provider must finish in the same signed-in browser session where it started. Try again.",
  link_identity_in_use: "That provider account is already connected to a different YourRank account. Both accounts were left unchanged.",
  link_provider_already_connected: "Your account already has a different account connected for that provider.",
});
const ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  unauthorized: "Your session expired. Sign in again.",
  "invalid csrf": "Your session expired. Reload the page and try again.",
});
const ACCOUNT_VIEWS: Record<AccountViewId, { title: string; subtitle: string }> = {
  "vd-profile": { title: "Profile", subtitle: "Manage your basic YourRank identity." },
  "vd-connections": { title: "Connected Accounts", subtitle: "View the accounts connected to your YourRank identity." },
  "vd-notifications": { title: "Notifications", subtitle: "Notification settings for your viewer account." },
  "vd-security": { title: "Privacy & Security", subtitle: "Review your sign-in and privacy information." },
  "vd-data": { title: "Data & Account", subtitle: "Manage your account information and control your data." },
};
const PROVIDER_LABELS: Record<string, string> = { kick: "Kick", discord: "Discord" };
const PROVIDER_LOGO_PATHS = {
  kick: "M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z",
  discord: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
};

type StatusValue = {
  message: string;
  error: boolean;
  retry?: boolean;
};

type QueryResults = {
  loginError: string | null;
  loginStatus: StatusValue;
  accountStatus: StatusValue;
};

export type ViewerAccountPageProps = {
  signal: AbortSignal;
  onFirstLoadCommitted: () => void;
};

function readQueryResults(): QueryResults {
  const url = new URL(window.location.href);
  const loginError = url.searchParams.get("error");
  const connectedProvider = url.searchParams.get("connected");
  let loginStatus: StatusValue = { message: "", error: false };
  let accountStatus: StatusValue = { message: "", error: false };

  if (loginError && Object.hasOwn(LINK_RESULT_MESSAGES, loginError)) {
    accountStatus = { message: LINK_RESULT_MESSAGES[loginError], error: true };
    url.searchParams.delete("error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } else if (loginError) {
    loginStatus = {
      message: LOGIN_ERROR_MESSAGES[loginError] || "We couldn't complete sign-in. Try again.",
      error: true,
    };
    url.searchParams.delete("error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  if (connectedProvider) {
    accountStatus = { message: "Provider connected to your account.", error: false };
    url.searchParams.delete("connected");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return { loginError, loginStatus, accountStatus };
}

function readLoginProviders(): LoginProvider[] {
  return (["kick", "discord"] as const).flatMap((provider) => {
    const link = document.getElementById(`vd-login-${provider}`) as HTMLAnchorElement | null;
    if (!link) return [];
    return [{
      provider,
      href: link.getAttribute("href") || link.href,
      className: link.className,
    }];
  });
}

function readAccountHref() {
  return document.getElementById("viewer-communities-link")?.getAttribute("href")
    || `${window.location.pathname}${window.location.search}`;
}

function readSupportHref() {
  return document.querySelector<HTMLAnchorElement>("#vd-data .vd-danger-card a.btn--danger")?.getAttribute("href")
    || "/help/support?audience=viewer&return=%2Fme";
}

function accountView(value: string): AccountViewId | "" {
  return Object.hasOwn(ACCOUNT_VIEWS, value) ? value as AccountViewId : "";
}

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtNum(value?: number | string | null) {
  return Number(value || 0).toLocaleString("en-US");
}

function initial(value?: string | null) {
  return Array.from(String(value || "").trim())[0]?.toUpperCase() || "Y";
}

function errorText(message: unknown, fallback: string) {
  const value = String(message || "");
  if (ERROR_MESSAGES[value]) return ERROR_MESSAGES[value];
  const sentence = /^[A-Z].*[.!?]$/.test(value) && !/^HTTP /.test(value);
  return sentence ? value : fallback;
}

async function api<T>(method: string, path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    signal,
    headers: { "x-csrf-token": document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "" },
  });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data
      ? (data as { error?: unknown }).error
      : undefined;
    throw new Error(String(error || `HTTP ${response.status}`));
  }
  return data as T;
}

function Icon({ name }: { name: "search" | "shield" | "info" | "arrow" | "external" }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.3-4.3" /></>,
    shield: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    external: <path d="M14 3h7v7m0-7-11 11m0-11H3v18h18v-7" />,
  };
  return (
    <svg
      className="viewer-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function ProviderLogo({ provider, label }: { provider: string; label: string }) {
  if (provider === "kick" || provider === "discord") {
    return (
      <svg className="vd-provider-logo" data-provider={provider} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d={PROVIDER_LOGO_PATHS[provider]} />
      </svg>
    );
  }

  return (
    <span className="vd-provider-logo vd-provider-logo--fallback" aria-hidden="true">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

function ProviderRow({ account }: { account: ConnectedAccount }) {
  const provider = String(account.provider || "");
  const label = account.label || PROVIDER_LABELS[provider] || provider;
  const state = account.state || "connected";
  const detail = state === "connected"
    ? `${account.username ? `@${account.username}` : "Connected account"}${account.linkedAt ? ` · Connected ${fmtDate(account.linkedAt)}` : ""}`
    : state === "available" ? "Not connected" : "Not available on this deployment";

  return (
    <div className="vd-provider" data-state={state}>
      <ProviderLogo provider={provider} label={label} />
      <div className="vd-provider-copy">
        <h3>{label}</h3>
        <p>{detail}</p>
      </div>
      {state === "connected"
        ? <span className="vd-connection-status">Connected</span>
        : account.connectUrl
          ? <a className="btn" href={account.connectUrl}>Connect {label}</a>
          : <span className="vd-connection-status vd-connection-status--muted">Unavailable</span>}
    </div>
  );
}

function StatusLine({
  id,
  status,
  tabIndex,
  onRetry,
}: {
  id: string;
  status: StatusValue;
  tabIndex?: number;
  onRetry?: () => void;
}) {
  return (
    <p
      id={id}
      className={status.message && status.error ? "status error" : "status"}
      role="status"
      aria-live="polite"
      tabIndex={tabIndex}
    >
      {status.message}
      {status.message && status.retry && onRetry ? (
        <> <button type="button" className="btn btn--sm vd-retry" onClick={onRetry}>Try again</button></>
      ) : null}
    </p>
  );
}

function membershipSummary(community: ViewerCommunity) {
  const parts = [`${fmtNum(community.balance)} Credits`];
  if ((community.pendingClaims || 0) > 0) {
    parts.push(`${fmtNum(community.pendingClaims)} ${community.pendingClaims === 1 ? "Claim needs" : "Claims need"} creator action`);
  }
  if (!community.claimingAvailable) parts.push("Claiming unavailable");
  return parts;
}

function CommunityRow({ community }: { community: ViewerCommunity }) {
  const name = community.name || community.slug;
  const href = `/${encodeURIComponent(community.slug)}`;
  const parts = membershipSummary(community);

  return (
    <article className="vd-card-row vd-community-row">
      <span className="vd-site-mark" aria-hidden="true">{initial(name)}</span>
      <div className="vd-card-main">
        <h3 className="vd-card-title"><a href={href}>{name}</a></h3>
        <p className="vd-membership-summary">
          {parts.map((part, index) => (
            <Fragment key={`${index}-${part}`}>
              {index > 0 ? <span className="vd-membership-dot" aria-hidden="true">·</span> : null}
              <span className={index === 0 ? "vd-membership-balance" : "vd-membership-state"}>{part}</span>
            </Fragment>
          ))}
        </p>
      </div>
      <div className="vd-card-side">
        <a className="btn btn--accent btn--sm" href={href} aria-label={`Open ${name}`}>Open</a>
      </div>
    </article>
  );
}

function focusElement(id: string, preventScroll = false) {
  const element = document.getElementById(id);
  if (!element) return;
  if (preventScroll) element.focus({ preventScroll: true });
  else element.focus();
}

export function ViewerAccountPage({ signal, onFirstLoadCommitted }: ViewerAccountPageProps) {
  const [queryResults] = useState(readQueryResults);
  const [loginProviders] = useState(readLoginProviders);
  const [accountHref] = useState(readAccountHref);
  const [supportHref] = useState(readSupportHref);
  const [authState, setAuthState] = useState<ViewerAuthState>(readViewerAuthState);
  const [hash, setHash] = useState(() => window.location.hash.slice(1));
  const [viewer, setViewer] = useState<ViewerAccount | null>(null);
  const [lastViewer, setLastViewer] = useState<ViewerAccount | null>(null);
  const [communities, setCommunities] = useState<ViewerCommunity[]>([]);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [loggedOut, setLoggedOut] = useState(false);
  const [guestGateActive, setGuestGateActive] = useState(false);
  const [hasResolvedAccount, setHasResolvedAccount] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completedLoads, setCompletedLoads] = useState(0);
  const [loginStatus, setLoginStatus] = useState<StatusValue>(queryResults.loginStatus);
  const [accountStatus, setAccountStatus] = useState<StatusValue>(queryResults.accountStatus);
  const [communityStatus, setCommunityStatus] = useState<StatusValue>({ message: "", error: false });
  const [entryStatus, setEntryStatus] = useState<StatusValue>({ message: "", error: false });
  const [communityName, setCommunityName] = useState("");
  const [communityInvalid, setCommunityInvalid] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [exportId, setExportId] = useState("");
  const [exportCheckVisible, setExportCheckVisible] = useState(false);
  const [exportDownloadVisible, setExportDownloadVisible] = useState(false);
  const [exportDownloadHref, setExportDownloadHref] = useState("");
  const [exportProgress, setExportProgress] = useState(false);
  const [exportStatus, setExportStatus] = useState<StatusValue>({ message: "", error: false });
  const [exportPending, setExportPending] = useState(false);
  const [exportCheckPending, setExportCheckPending] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [switchPending, setSwitchPending] = useState(false);
  const [hasAccountResponse, setHasAccountResponse] = useState(false);
  const loginCard = useRef<HTMLElement>(null);
  const communityInput = useRef<HTMLInputElement>(null);
  const firstLoadCommitted = useRef(false);
  const lastFocusedLoad = useRef(0);
  const viewerRef = useRef(viewer);
  const authStateRef = useRef(authState);
  const logoutRef = useRef<() => void>(() => {});

  viewerRef.current = viewer;
  authStateRef.current = authState;

  const requestedView = accountView(hash);
  const signedIn = !!viewer;
  const currentView = signedIn ? requestedView : "";
  const currentLabel = currentView ? ACCOUNT_VIEWS[currentView].title : "My communities";
  const guestGateView = !signedIn && authState === "unauthenticated" && guestGateActive ? requestedView : "";
  const title = guestGateView
    ? `Sign in to open ${ACCOUNT_VIEWS[guestGateView].title}`
    : !signedIn && authState === "unauthenticated" ? GUEST_TITLE : currentLabel;
  const subtitle = guestGateView
    ? `${ACCOUNT_VIEWS[guestGateView].title} is part of your Viewer Account. Sign in and you'll come straight back to it.`
    : !signedIn && authState === "unauthenticated"
      ? GUEST_SUBTITLE
      : currentView ? ACCOUNT_VIEWS[currentView].subtitle : DEFAULT_SUBTITLE;
  const loginVisible = authState === "unauthenticated";
  const loginTarget = `${window.location.pathname}${window.location.search}`;
  const profileRows = (lastViewer?.connections || []).map((connection) => ({ ...connection, state: "connected" }));
  const connectedRows = connectedAccounts.length ? connectedAccounts : profileRows;
  const profileProviderRows = lastViewer
    ? profileRows.length
      ? profileRows.map((account, index) => <ProviderRow key={`${account.provider}-${index}`} account={account} />)
      : <p>No connected providers were returned.</p>
    : null;
  const connectionProviderRows = lastViewer
    ? connectedRows.length
      ? connectedRows.map((account, index) => <ProviderRow key={`${account.provider}-${index}`} account={account} />)
      : <p>No connected providers were returned.</p>
    : null;
  const lastViewerName = lastViewer?.displayName || "Member";
  const lastViewerConnections = lastViewer?.connections || [];
  const identityText = lastViewer
    ? lastViewerConnections.length
      ? `Connected to ${lastViewerConnections.map((connection) => {
        const provider = connection.provider === "kick" ? "Kick" : connection.provider === "discord" ? "Discord" : "Provider";
        return `${provider}${connection.username ? ` as @${connection.username}` : ""}`;
      }).join(" and ")}`
      : "Signed in to YourRank"
    : "Loading connected account…";
  const membershipsVisible = signedIn && !currentView;
  const loginHref = (provider: LoginProvider) => {
    const target = new URL(provider.href, window.location.href);
    if (guestGateView) target.searchParams.set("returnTo", `${loginTarget}#${guestGateView}`);
    return `${target.pathname}${target.search}`;
  };

  const setLoggedOutState = useCallback(() => {
    setAuthState("unauthenticated");
    setViewer(null);
    setCommunities([]);
    setLoggedOut(true);
    setGuestGateActive(true);
    setHasResolvedAccount(true);
    setHasAccountResponse(true);
    setExportId("");
    setExportCheckVisible(false);
    setExportDownloadVisible(false);
    setExportProgress(false);
    setExportStatus({ message: "", error: false });
  }, []);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    if (!queryResults.loginError) setLoginStatus({ message: "", error: false });
    setCommunityStatus({ message: "", error: false });

    try {
      const data = await api<ViewerMeResponse>("GET", "/api/viewer/me", signal);
      if (signal.aborted) return;

      if (!data.viewer) {
        flushSync(() => setLoggedOutState());
      } else {
        flushSync(() => {
          setAuthState("authenticated");
          setViewer(data.viewer || null);
          setLastViewer(data.viewer || null);
          setCommunities(data.communities || []);
          setConnectedAccounts(Array.isArray(data.connectedAccounts) && data.connectedAccounts.length ? data.connectedAccounts : []);
          setLoggedOut(false);
          setGuestGateActive(false);
          setHasResolvedAccount(true);
          setHasAccountResponse(true);
          setAvatarLoaded(false);
        });
      }
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "unauthorized") {
        flushSync(() => setLoggedOutState());
      } else {
        const isGuest = readViewerAuthState() === "unauthenticated";
        const status = {
          message: errorText(message, "We couldn't load your Viewer Account."),
          error: true,
          retry: true,
        };
        flushSync(() => {
          if (isGuest) setLoginStatus(status);
          else setAccountStatus(status);
        });
      }
    } finally {
      if (!signal.aborted) {
        flushSync(() => {
          setLoading(false);
          setCompletedLoads((version) => version + 1);
        });
      }
    }
  }, [queryResults.loginError, setLoggedOutState, signal]);

  const retryAccountLoad = (target: "login" | "account") => {
    if (target === "login") setLoginStatus({ message: "", error: false });
    else setAccountStatus({ message: "", error: false });
    void loadAccount();
  };

  const handleHashChange = useCallback(() => {
    const nextHash = window.location.hash.slice(1);
    const nextView = accountView(nextHash);
    flushSync(() => {
      setHash(nextHash);
      if (authStateRef.current === "unauthenticated") setGuestGateActive(true);
    });
    if (viewerRef.current) focusElement("vd-title");
    else if (authStateRef.current === "unauthenticated" && nextView) focusElement("vd-login-card");
  }, []);

  useEffect(() => {
    window.addEventListener("hashchange", handleHashChange);
    void loadAccount();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [handleHashChange, loadAccount]);

  useEffect(() => wireViewerRailLogout(() => logoutRef.current()), []);

  useLayoutEffect(() => {
    if (!hasResolvedAccount) return;
    const state = {
      accountPath: `${window.location.pathname}${window.location.search}`,
      currentView,
      requestedView,
      title,
    };
    if (viewer) {
      syncSignedInViewerChrome(viewer.displayName || "Member", state);
      if (!avatarLoaded) setViewerTopInitial(initial(viewer.displayName || "Member"));
    } else if (authState === "unauthenticated" && hasAccountResponse) {
      syncLoggedOutViewerChrome(state);
    }
  }, [authState, avatarLoaded, currentView, hasAccountResponse, hasResolvedAccount, requestedView, title, viewer]);

  useLayoutEffect(() => {
    if (!completedLoads || lastFocusedLoad.current === completedLoads) return;
    lastFocusedLoad.current = completedLoads;
    const currentHash = window.location.hash.slice(1);
    if (currentHash === "vd-login-card" || (!viewer && accountView(currentHash))) {
      focusElement("vd-login-card", true);
    } else if (currentHash === "vd-profile") {
      focusElement("vd-profile", true);
    } else if (viewer && accountView(currentHash)) {
      focusElement("vd-title", true);
    }

    if (!firstLoadCommitted.current) {
      firstLoadCommitted.current = true;
      onFirstLoadCommitted();
    }
  }, [completedLoads, onFirstLoadCommitted, viewer]);

  const handleExport = async () => {
    setExportPending(true);
    setExportDownloadVisible(false);
    setExportProgress(true);
    try {
      const data = await api<{ exportId?: string }>("POST", "/api/viewer/export", signal);
      if (signal.aborted) return;
      const nextExportId = data.exportId || "";
      if (!nextExportId) throw new Error("Could not start data export. Please try again.");
      setExportId(nextExportId);
      setExportCheckVisible(true);
      setExportStatus({ message: "Your export is being prepared. Check its status here.", error: false });
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setExportStatus({
        message: errorText(message, "Could not start data export. Please try again."),
        error: true,
      });
    } finally {
      if (!signal.aborted) setExportPending(false);
    }
  };

  const handleExportCheck = async () => {
    if (!exportId) return;
    setExportCheckPending(true);
    try {
      const data = await api<{ status?: string; expiresAt?: string }>(
        "GET",
        `/api/viewer/export/${encodeURIComponent(exportId)}/status`,
        signal,
      );
      if (signal.aborted) return;
      const complete = data.status === "completed";
      setExportDownloadVisible(complete);
      if (complete) {
        setExportDownloadHref(`/api/viewer/export/${encodeURIComponent(exportId)}/download`);
      }
      const unavailable = data.status === "failed" || data.status === "expired";
      setExportStatus({
        message: complete
          ? `Your export is ready.${data.expiresAt ? ` Available until ${fmtDate(data.expiresAt)}.` : ""}`
          : unavailable
            ? "This export is unavailable. Request a new export."
            : "Your export is still being prepared.",
        error: unavailable,
      });
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setExportStatus({
        message: errorText(message, "Could not check export status. Try again."),
        error: true,
      });
    } finally {
      if (!signal.aborted) setExportCheckPending(false);
    }
  };

  const handleLogout = async (switchLogin = false) => {
    if (switchLogin) setSwitchPending(true);
    else setLogoutPending(true);
    try {
      await api("POST", "/api/viewer/logout", signal);
      if (signal.aborted) return;
      flushSync(() => {
        if (!switchLogin) setAccountStatus({ message: "", error: false });
        setLoggedOutState();
      });
      if (switchLogin) {
        (document.getElementById("vd-login-kick") || document.getElementById("vd-login-discord"))?.focus();
      } else {
        focusElement("vd-login-card");
      }
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setAccountStatus({
        message: errorText(message, switchLogin ? "We couldn't switch your login. Try again." : "We couldn't sign you out. Try again."),
        error: true,
      });
    } finally {
      if (!signal.aborted) {
        if (switchLogin) setSwitchPending(false);
        else setLogoutPending(false);
      }
    }
  };

  logoutRef.current = () => { void handleLogout(false); };

  const handleCommunitySubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = communityName.trim();
    const match = communities.find((community) => String(community.name || "").toLowerCase() === value.toLowerCase());
    let slug = match?.slug || value.toLowerCase();

    if (/^(?:https?:\/\/|yourrank\.site\/)/i.test(value)) {
      try {
        const communityUrl = new URL(/^https?:/i.test(value) ? value : `https://${value}`);
        if (
          communityUrl.hostname !== "yourrank.site"
          || communityUrl.username
          || communityUrl.password
          || communityUrl.port
          || !/^\/[a-z0-9][a-z0-9-]{0,62}(?:\/(?:me|shop|leaderboard))?\/?$/.test(communityUrl.pathname)
        ) {
          throw new Error("Invalid community link");
        }
        slug = communityUrl.pathname.split("/")[1];
      } catch {
        slug = "";
      }
    }

    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
      flushSync(() => {
        setCommunityInvalid(true);
        setEntryStatus({
          message: "Enter a community handle or paste its YourRank community link.",
          error: true,
        });
      });
      communityInput.current?.focus();
      return;
    }

    flushSync(() => {
      setCommunityInvalid(false);
      setEntryStatus({ message: "", error: false });
    });
    const destination = new URL(`/${encodeURIComponent(slug)}`, window.location.origin).href;
    navigateToViewerCommunity(destination);
  };

  const loadingText = authState === "authenticated" ? "Loading your communities…" : "Checking your sign-in…";

  return (
    <>
      <div
        id="vd-loading"
        className="vd-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
        hidden={!loading || authState === "unauthenticated"}
      >
        <span className="sr-only">{loadingText}</span>
        <div className="vd-skeleton" aria-hidden="true"><span /><span /><span /></div>
      </div>
      <div className="vd-head">
        <p className="vd-breadcrumb" id="vd-breadcrumb" hidden={!signedIn}>
          Settings <span aria-hidden="true">›</span> <span id="vd-breadcrumb-current">{currentLabel}</span>
        </p>
        <h1 className="vd-h1" id="vd-title" tabIndex={-1}>{title}</h1>
        <p className="vd-sub" id="vd-subtitle">{subtitle}</p>
      </div>

      <section id="vd-login-card" tabIndex={-1} hidden={!loginVisible} ref={loginCard}>
        <div className="vd-login-actions">
          {loginProviders.map((provider) => (
            <a
              key={provider.provider}
              className={provider.className}
              id={`vd-login-${provider.provider}`}
              data-login-base={provider.href}
              href={loginHref(provider)}
            >
              Sign in with {provider.provider === "kick" ? "Kick" : "Discord"}
            </a>
          ))}
          {!loginProviders.length ? (
            <p className="status" role="status">Viewer sign-in is not available on this site right now. Please try again later.</p>
          ) : null}
        </div>
        <StatusLine
          id="vd-login-status"
          status={loginStatus}
          onRetry={loginStatus.retry ? () => retryAccountLoad("login") : undefined}
        />
      </section>

      <div className="vd-layout">
        <section className="vd-sec" id="vd-communities-card" hidden={!membershipsVisible}>
          <form id="vd-open-community" className="vd-community-entry" role="search" onSubmit={handleCommunitySubmit}>
            <label htmlFor="vd-community-name" className="vd-visually-hidden">Community name or link</label>
            <p id="vd-community-name-hint" className="vd-visually-hidden">
              Find a joined community by name, or enter a creator's handle or YourRank community link.
            </p>
            <div className="vd-community-entry-controls">
              <Icon name="search" />
              <input
                id="vd-community-name"
                ref={communityInput}
                type="text"
                required
                maxLength={256}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Search communities by name or link…"
                aria-describedby="vd-community-name-hint vd-community-entry-status"
                aria-invalid={communityInvalid ? "true" : undefined}
                value={communityName}
                onChange={(event) => setCommunityName(event.currentTarget.value)}
              />
              <button className="btn btn--ghost btn--sm" type="submit">Open community</button>
            </div>
            <StatusLine id="vd-community-entry-status" status={entryStatus} />
          </form>
          <div className="vd-directory-head">
            <h2 id="vd-communities-heading" tabIndex={-1}>Your memberships</h2>
            <span id="vd-membership-count" className="vd-count">{signedIn ? `${communities.length} ${communities.length === 1 ? "community" : "communities"}` : ""}</span>
          </div>
          <StatusLine
            id="vd-communities-status"
            status={communityStatus}
            tabIndex={-1}
            onRetry={communityStatus.retry ? () => retryAccountLoad("account") : undefined}
          />
          <div id="vd-communities" className="vd-community-list">
            {communities.map((community) => <CommunityRow key={community.slug} community={community} />)}
          </div>
          <div className="vd-community-empty" id="vd-communities-empty" hidden={!signedIn || communities.length > 0}>
            <h3>You haven't joined any communities yet.</h3>
            <p>Visit a creator's YourRank site and choose Join community. Your membership will be waiting here when you come back.</p>
          </div>
        </section>

        <section className="vd-profile" id="vd-profile" tabIndex={-1} hidden={!signedIn || currentView !== "vd-profile"}>
          <div className="vd-settings-card vd-identity-card">
            <div className="vd-profile-head">
              <img
                id="vd-avatar"
                className="vd-avatar"
                alt={lastViewer?.avatarUrl ? `${lastViewerName}'s profile picture` : ""}
                src={lastViewer?.avatarUrl || undefined}
                hidden={!avatarLoaded}
                onLoad={() => {
                  if (signal.aborted || !viewer || !lastViewer?.avatarUrl) return;
                  setAvatarLoaded(true);
                  setViewerTopAvatarImage(lastViewer.avatarUrl);
                }}
                onError={() => {
                  if (signal.aborted || !viewer) return;
                  setAvatarLoaded(false);
                  setViewerTopInitial(initial(lastViewer?.displayName || "Member"));
                }}
              />
              <span id="vd-avatar-fallback" className="vd-avatar-fallback" aria-hidden="true" hidden={avatarLoaded}>
                {initial(lastViewer?.displayName || "M")}
              </span>
            </div>
            <div className="vd-identity-copy">
              <h2 id="vd-username">{loggedOut ? "" : lastViewerName}</h2>
              <p className="vd-identity-line" id="vd-identity">{loggedOut ? "" : identityText}</p>
              <p className="vd-note"><Icon name="shield" />Your picture and name come from your connected provider. Photo uploads and profile editing aren't available yet.</p>
            </div>
          </div>
          <div className="vd-profile-grid">
            <div className="vd-settings-card">
              <h2>Connected account</h2>
              <p>The provider you sign in with.</p>
              <div id="vd-profile-providers">{profileProviderRows}</div>
            </div>
            <div className="vd-settings-card">
              <h2>Account information</h2>
              <p>Your YourRank viewer account.</p>
              <dl className="vd-facts">
                <div><dt>Display name</dt><dd id="vd-profile-name">{lastViewer ? lastViewerName : ""}</dd></div>
                <div><dt>Member since</dt><dd id="vd-created">{fmtDate(lastViewer?.createdAt) || (lastViewer ? "Not available" : "")}</dd></div>
              </dl>
            </div>
          </div>
          <details className="vd-settings-card vd-account-actions" id="vd-wrong-account" hidden={!signedIn}>
            <summary>Manage your login</summary>
            <p>Sign out of this account or continue with a different login.</p>
            <div className="vd-profile-actions">
              <button className="btn btn--ghost btn--sm" id="vd-switch" type="button" disabled={switchPending} aria-busy={switchPending || undefined} onClick={() => void handleLogout(true)}>
                {switchPending ? "Signing out…" : "Use a different login"}
              </button>
              <button className="btn btn--sm" id="vd-logout" type="button" disabled={logoutPending} aria-busy={logoutPending || undefined} onClick={() => void handleLogout(false)}>
                {logoutPending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </details>
        </section>

        <section id="vd-connections" tabIndex={-1} hidden={!signedIn || currentView !== "vd-connections"}>
          <div className="vd-settings-card vd-providers-card">
            <div id="vd-provider-list" className="vd-provider-list">{connectionProviderRows}</div>
            <p className="vd-note"><Icon name="info" />Connect providers here to use the same YourRank account across platforms.</p>
          </div>
        </section>

        <section id="vd-notifications" tabIndex={-1} hidden={!signedIn || currentView !== "vd-notifications"}>
          <div className="vd-settings-card">
            <h2>Notification Preferences</h2>
            <p>Notification channels, frequency, and preference controls aren't available for viewer accounts yet.</p>
            <p>Your credit activity and reward claim updates are available inside each community.</p>
            <a className="btn" href={accountHref}>My Communities <Icon name="arrow" /></a>
          </div>
        </section>

        <section id="vd-security" tabIndex={-1} hidden={!signedIn || currentView !== "vd-security"}>
          <div className="vd-settings-card vd-providers-card">
            <h2>Authentication</h2>
            <div id="vd-security-providers" className="vd-provider-list">{profileProviderRows}</div>
            <p className="vd-note"><Icon name="info" />Sign-in security is managed by your connected provider.</p>
          </div>
          <div className="vd-settings-card vd-privacy-card">
            <h2>Privacy</h2>
            <p>Your YourRank account identifies you across communities. Credits, claims and activity stay scoped to each community.</p>
            <a className="btn" href="/privacy">Privacy policy <Icon name="external" /></a>
          </div>
        </section>

        <section id="vd-data" tabIndex={-1} hidden={!signedIn || currentView !== "vd-data"}>
          <div className="vd-settings-card">
            <h2>Account Information</h2>
            <p>Your basic YourRank account information.</p>
            <dl className="vd-facts">
              <div><dt>Display name</dt><dd id="vd-data-name">{lastViewer ? lastViewerName : ""}</dd></div>
              <div><dt>Member since</dt><dd id="vd-data-created">{fmtDate(lastViewer?.createdAt) || (lastViewer ? "Not available" : "")}</dd></div>
            </dl>
          </div>
          <div className="vd-settings-card">
            <h2>Export Your Data</h2>
            <p>Download a copy of your YourRank viewer data.</p>
            <div className="vd-export-row">
              <p>Your viewer identity, provider connections, community memberships, credits, claims, and supported participation records.</p>
              <div className="vd-export-actions">
                <button className="btn btn--accent" id="vd-export" type="button" disabled={exportPending} aria-busy={exportPending || undefined} onClick={() => void handleExport()}>
                  {exportPending ? "Requesting export…" : "Request Data Export"}
                </button>
                <button className="btn" id="vd-export-check" type="button" hidden={!exportCheckVisible} disabled={exportCheckPending} aria-busy={exportCheckPending || undefined} onClick={() => void handleExportCheck()}>
                  {exportCheckPending ? "Checking…" : "Check export status"}
                </button>
                <a className="btn" id="vd-export-download" href={exportDownloadHref || undefined} hidden={!exportDownloadVisible}>Download data</a>
              </div>
            </div>
            <div className="vd-export-progress" id="vd-export-progress" hidden={!exportProgress}>
              <p>Keep this page open to check the export and download it when ready.</p>
              <StatusLine id="vd-export-status" status={exportStatus} />
            </div>
          </div>
          <div className="vd-settings-card vd-danger-card">
            <h2>Delete Account</h2>
            <p>Permanently delete your YourRank account and associated account data.</p>
            <p>Contact support to request account deletion.</p>
            <a className="btn btn--danger" href={supportHref}>Contact support <Icon name="arrow" /></a>
          </div>
        </section>

        <StatusLine
          id="vd-account-status"
          status={accountStatus}
          tabIndex={-1}
          onRetry={accountStatus.retry ? () => retryAccountLoad("account") : undefined}
        />
      </div>
    </>
  );
}
