import { createPortal } from "react-dom";
import { useCallback, useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { TwoFactorData, TwoFactorDependencies, TwoFactorPageProps } from "./types";

declare global {
  interface Window {
    QRCode: {
      toDataURL: (text: string, size?: number, ecLevel?: string) => string;
    };
  }
}

function csrfToken() {
  if (typeof document === "undefined") return "";
  return document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)?.[1] || "";
}

function headersRecord(headers: HeadersInit | undefined) {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

export async function twoFactorApi(
  path: string,
  options: RequestInit = {},
  dependencies: TwoFactorDependencies = {},
): Promise<{ res: Response; data: TwoFactorData }> {
  const headers = headersRecord(options.headers);
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  if (["POST", "PUT", "PATCH", "DELETE"].includes((options.method || "GET").toUpperCase())) headers["x-csrf-token"] = csrfToken();
  const res = await (dependencies.fetcher || globalThis.fetch)(path, { ...options, credentials: "include", headers });
  const data = await res.json().catch(() => ({})) as TwoFactorData;
  if (res.status === 401) {
    (dependencies.navigate || ((pathName: string) => { window.location.href = pathName; }))("/login");
    throw new Error("auth");
  }
  return { res, data };
}

function navigate(dependencies: TwoFactorDependencies | undefined, path: string) {
  (dependencies?.navigate || ((pathName: string) => { window.location.href = pathName; }))(path);
}

function Topbar({ onLogout }: { onLogout: () => void }) {
  const target = typeof document === "undefined" ? null : document.getElementById("admin-2fa-topbar-controls");
  if (!target) return null;
  return createPortal(
    <>
      <a className="btn btn--sm btn--ghost" href="/dashboard">Dashboard</a>
      <a className="btn btn--sm btn--ghost" href="/login" id="logout" onClick={(event) => { event.preventDefault(); onLogout(); }}>Sign out</a>
    </>,
    target,
  );
}

function TfaIcon() {
  return <span className="tfa-icon"><svg aria-hidden="true" fill="none" height="24" viewBox="0 0 24 24" width="24"><rect height="11" rx="2" ry="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" width="18" x="3" y="11" /><path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg></span>;
}

function numericCode(event: ChangeEvent<HTMLInputElement>) {
  return event.target.value.replace(/\D/g, "").slice(0, 6);
}

export function AdminTwoFactorPage({ dependencies }: TwoFactorPageProps) {
  const [view, setView] = useState<"loading" | "verify" | "setup" | "recovery" | "success">("loading");
  const [code, setCode] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [setupError, setSetupError] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(false);

  const startSetup = useCallback(async () => {
    setSetupError("");
    setSubmitting(true);
    try {
      const { res, data } = await twoFactorApi("/api/admin/2fa/enable", { method: "POST" }, dependencies);
      if (!res.ok || !data.ok || !data.uri) {
        setSetupError(data.error || "Failed to start 2FA setup.");
        setView("setup");
        return;
      }
      setQr(window.QRCode.toDataURL(data.uri, 200));
      setSecret(data.secret || "");
      setSetupCode("");
      setView("setup");
    } catch {
      setSetupError("Failed to start 2FA setup.");
      setView("setup");
    } finally {
      setSubmitting(false);
    }
  }, [dependencies]);

  useEffect(() => {
    const root = document.getElementById("admin-2fa-app");
    root?.setAttribute("data-state", view);
  }, [view]);

  useEffect(() => {
    const focusTarget = view === "verify" ? "tfaCode" : view === "setup" ? "tfaSetupCode" : view === "recovery" ? "tfaRecoveryCode" : null;
    if (focusTarget) document.getElementById(focusTarget)?.focus();
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const { res, data } = await twoFactorApi("/api/admin/2fa/status", {}, dependencies);
        if (!res.ok || !data.ok) {
          navigate(dependencies, "/login");
          return;
        }
        if (data.locked) {
          if (!cancelled) {
            setLocked(true);
            setError("2FA is temporarily locked due to too many failed attempts. Try again later.");
            setView("verify");
          }
          return;
        }
        if (!data.enabled) {
          await startSetup();
        } else if (!data.verified) {
          if (!cancelled) setView("verify");
        } else {
          navigate(dependencies, "/admin");
        }
      } catch {
        if (!cancelled) {
          setError("Could not verify your session.");
          setView("verify");
        }
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [dependencies, startSetup]);

  const submitVerify = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter a 6-digit code.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const { res, data } = await twoFactorApi("/api/admin/2fa/verify", { method: "POST", body: JSON.stringify({ code }) }, dependencies);
      if (res.ok && data.ok && data.verified) {
        navigate(dependencies, "/admin");
        return;
      }
      setError(data.error || "Invalid code.");
    } catch {
      setError("Invalid code.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitSetup = async () => {
    if (!/^\d{6}$/.test(setupCode)) {
      setSetupError("Enter a 6-digit code.");
      return;
    }
    setSetupError("");
    setSubmitting(true);
    try {
      const { res, data } = await twoFactorApi("/api/admin/2fa/verify", { method: "POST", body: JSON.stringify({ code: setupCode }) }, dependencies);
      if (res.ok && data.ok && data.verified) {
        if (data.recoveryCodes?.length) {
          setRecoveryCodes(data.recoveryCodes);
          setView("success");
        } else {
          navigate(dependencies, "/admin");
        }
        return;
      }
      setSetupError(data.error || "Verification failed. Try the code from your authenticator.");
    } catch {
      setSetupError("Verification failed. Try the code from your authenticator.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitRecovery = async () => {
    const raw = recoveryCode.trim();
    const normalized = raw.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    if (normalized.length !== 16) {
      setRecoveryError("Enter a 16-character recovery code.");
      return;
    }
    setRecoveryError("");
    setSubmitting(true);
    try {
      const { res, data } = await twoFactorApi("/api/admin/2fa/recovery", { method: "POST", body: JSON.stringify({ code: raw }) }, dependencies);
      if (res.ok && data.ok && data.verified) {
        navigate(dependencies, "/admin");
        return;
      }
      setRecoveryError(data.error || "Invalid or already used recovery code.");
    } catch {
      setRecoveryError("Invalid or already used recovery code.");
    } finally {
      setSubmitting(false);
    }
  };

  const showRecovery = (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    setRecoveryCode("");
    setRecoveryError("");
    setView("recovery");
  };

  const showVerify = (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    setCode("");
    setError("");
    setView("verify");
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>, submit: () => void) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  const logout = async () => {
    await (dependencies?.fetcher || globalThis.fetch)("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": csrfToken() },
    });
    navigate(dependencies, "/login");
  };

  return (
    <>
      <Topbar onLogout={() => void logout()} />
      <div className="tfa-page">
        <div className="tfa-loading" hidden={view !== "loading"} id="tfaLoading" aria-busy="true">Loading…</div>
        <div className="tfa-wrap" hidden={view !== "verify"} id="tfaVerify">
          <h1><TfaIcon />Two-Factor Authentication</h1>
          <p>Enter the 6-digit code from your authenticator app.</p>
          <label className="sr-only" htmlFor="tfaCode">6-digit verification code</label>
          <Input aria-label="Verification code" autoFocus className="tfa-code-input" autoComplete="one-time-code" disabled={locked || submitting} id="tfaCode" inputMode="numeric" maxLength={6} onChange={(event) => setCode(numericCode(event))} onKeyDown={(event) => onEnter(event, () => void submitVerify())} pattern="[0-9]{6}" placeholder="000000" type="text" value={code} />
          <div aria-atomic="true" aria-live="assertive" className="tfa-err" id="tfaErr" role="alert">{view === "verify" ? error : ""}</div>
          <Button className="tfa-button" disabled={locked || submitting} id="tfaSubmit" onClick={() => void submitVerify()} type="button">Verify</Button>
          <p className="tfa-hint"><a href="#" id="tfaUseRecovery" onClick={showRecovery}>Use a recovery code</a></p>
        </div>

        <div className="tfa-wrap tfa-setup" hidden={view !== "setup"} id="tfaSetup">
          <h2>Set Up Two-Factor Authentication</h2>
          <p>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
          <div className="tfa-qr-wrap"><img alt="QR Code for 2FA setup with Google Authenticator" height="200" id="tfaQr" src={qr || undefined} width="200" /></div>
          <p>Or enter this secret manually:</p>
          <code className="tfa-secret-box" id="tfaSecret">{secret}</code>
          <p>After scanning, enter the 6-digit code to verify setup:</p>
          <label className="sr-only" htmlFor="tfaSetupCode">6-digit verification code</label>
          <Input aria-label="Verification code" className="tfa-code-input" autoComplete="one-time-code" disabled={submitting} id="tfaSetupCode" inputMode="numeric" maxLength={6} onChange={(event) => setSetupCode(numericCode(event))} onKeyDown={(event) => onEnter(event, () => void submitSetup())} pattern="[0-9]{6}" placeholder="000000" type="text" value={setupCode} />
          <div aria-atomic="true" aria-live="assertive" className="tfa-err" id="tfaSetupErr" role="alert">{view === "setup" ? setupError : ""}</div>
          <Button className="tfa-button" disabled={submitting} id="tfaSetupSubmit" onClick={() => void submitSetup()} type="button">Enable 2FA</Button>
        </div>

        <div className="tfa-wrap" hidden={view !== "recovery"} id="tfaRecovery">
          <h2>Recovery Code</h2>
          <p>Enter one of the recovery codes you saved when you enabled 2FA.</p>
          <label className="sr-only" htmlFor="tfaRecoveryCode">Recovery code</label>
          <Input aria-label="Recovery code" autoFocus className="tfa-code-input" autoComplete="off" id="tfaRecoveryCode" onChange={(event) => setRecoveryCode(event.target.value)} onKeyDown={(event) => onEnter(event, () => void submitRecovery())} placeholder="xxxx-xxxx-xxxx-xxxx" type="text" value={recoveryCode} />
          <div aria-atomic="true" aria-live="assertive" className="tfa-err" id="tfaRecoveryErr" role="alert">{view === "recovery" ? recoveryError : ""}</div>
          <Button className="tfa-button" disabled={submitting} id="tfaRecoverySubmit" onClick={() => void submitRecovery()} type="button">Verify</Button>
          <p className="tfa-hint"><a href="#" id="tfaBackToCode" onClick={showVerify}>Back to 6-digit code</a></p>
        </div>

        <div className="tfa-wrap" hidden={view !== "success"} id="tfaSuccess">
          <h2>2FA Enabled</h2>
          <p>Save these recovery codes somewhere safe. Each one can only be used once.</p>
          <ul className="tfa-recovery-list" id="tfaRecoveryList">{recoveryCodes.map((recovery) => <li key={recovery}><code>{recovery}</code></li>)}</ul>
          <Button className="tfa-button" id="tfaDone" onClick={() => navigate(dependencies, "/admin")} type="button">Go to admin panel</Button>
        </div>
      </div>
    </>
  );
}
