import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, normalizePageSize, pageWindow, rangeLabel } from "../../../assets/pagination.js";
import { ServerPages } from "./server-pages";
import type {
  Activity,
  ActivityAutomation,
  ActivityRecurrence,
  ActivitySchedule,
  ActivityScheduleResponse,
  ActivityTemplate,
  ActivitiesResponse,
  BoardShell,
  CancelActivityScheduleRequest,
  CloseActivityRequest,
  CloseActivityResponse,
  CreateActivityScheduleRequest,
  CreateCodeDropRequest,
  CreateCodeDropResponse,
  ResumeActivityScheduleRequest,
  ActivityTemplateDeleteRequest,
  ActivityTemplateDeleteResponse,
  ActivityTemplateResponse,
  ActivityTemplateWriteRequest,
} from "./types";

declare global {
  interface Window {
    __yrBoot?: { signal?: () => void; fail?: () => void };
  }
}

type PageDependencies = {
  api: typeof api;
  loadBoardShell: () => Promise<BoardShell>;
  preserveSiteContextLinks: (siteId: string) => void | Promise<void>;
  showToast: (message: string, type?: string) => void;
  wirePlanLock: (element: HTMLElement, feature: string) => void;
  loginRedirectPath: (locationLike: Location) => string;
};

type FormStatus = { message: string; error: boolean };
type DrawerKind = "create" | "template" | "schedule" | null;
type ConfirmState = {
  title: string;
  body: string;
  confirmText: string;
  action: () => void | Promise<void>;
};
type RequestError = Error & { data?: unknown; status?: number; code?: string };
type ActivityListState = "loading" | "rows" | "empty" | "error";
type TabName = "drops" | "automation";
type AutomationView = Pick<ActivityAutomation, "templates" | "schedules"> & {
  entitlement: Partial<ActivityAutomation["entitlement"]>;
};

const BOARD_SHELL_MODULE = "/assets/dashboard/board-shell.js";
const DASHBOARD_UTILS_MODULE = "/assets/dashboard/utils.js";
const PLAN_LOCK_MODULE = "/assets/dashboard/plan-lock.js";
const LIVE_LIMIT = 100;
const EMPTY_AUTOMATION: AutomationView = { templates: [], schedules: [], entitlement: {} };
const activityPaging = {
  pages: new ServerPages<Activity>(DEFAULT_PAGE_SIZE),
  page: 1,
  pageLoading: false,
};
let activitiesTestDependencies: Partial<PageDependencies> | undefined;

const DEFAULT_DEPENDENCIES: PageDependencies = {
  api,
  loadBoardShell: async () => {
    const module = await import(BOARD_SHELL_MODULE) as { loadBoardShell: () => Promise<BoardShell> };
    return module.loadBoardShell();
  },
  preserveSiteContextLinks: (siteId) => import(BOARD_SHELL_MODULE).then((module) => module.preserveSiteContextLinks(siteId)),
  showToast: (message, type) => {
    void import(DASHBOARD_UTILS_MODULE).then((module) => module.showToast(message, type));
  },
  wirePlanLock: (element, feature) => {
    void import(PLAN_LOCK_MODULE).then((module) => module.wirePlanLock(element, feature));
  },
  loginRedirectPath: (locationLike) => {
    const next = `${locationLike.pathname || "/dashboard"}${locationLike.search || ""}`;
    return `/login?next=${encodeURIComponent(next)}`;
  },
};

export function setActivitiesPageDependenciesForTests(deps: Partial<PageDependencies> | null) {
  activitiesTestDependencies = deps ?? undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function errorStatus(error: unknown) {
  return error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 0;
}

function activitiesQuery(state: "open" | "completed", limit: number, cursor: string | null, siteId: string) {
  const query = new URLSearchParams();
  const contextSiteId = siteId || new URLSearchParams(window.location.search).get("siteId") || "";
  if (contextSiteId) query.set("siteId", contextSiteId);
  query.set("state", state);
  query.set("limit", String(limit));
  if (cursor) query.set("cursor", cursor);
  return `/api/activities?${query}`;
}

function dateLabel(value: string | number | null | undefined) {
  if (!value) return "No time limit";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function expiryLabel(value: string | number | null | undefined, now = Date.now()) {
  if (!value) return "No time limit";
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return "—";
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) return "Ending now";
  if (minutes < 60) return `Ends in ${minutes} min`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `Ends in ${hours}h${rest ? ` ${rest}m` : ""}`;
  }
  return `Ends ${dateLabel(value)}`;
}

function scheduleDateLabel(value: string | number | null) {
  return dateLabel(value);
}

function recurrenceLabel(value: string) {
  return value === "daily" ? "Every 24 hours (UTC)" : value === "weekly" ? "Every 7 days (UTC)" : "One time";
}

function dropTone(activity: Activity) {
  if (activity.state === "open") return "success";
  const label = String(activity.stateLabel || "").toLowerCase();
  if (label.includes("claimed out")) return "accent";
  if (label.includes("expired")) return "warning";
  return "neutral";
}

function scheduleTone(status: string) {
  if (status === "scheduled") return "info";
  if (status === "paused" || status === "failed") return "warning";
  return "neutral";
}

function StatusBadge({ label, tone, status }: { label: string; tone: string; status?: string }) {
  const color = tone === "success" || tone === "info"
    ? "border-green-700/20 bg-green-700/10 text-green-800"
    : tone === "accent"
      ? "border-primary/30 bg-primary/10 text-primary"
      : tone === "warning"
        ? "border-amber-700/20 bg-amber-700/10 text-amber-800"
        : "border-border bg-muted text-muted-foreground";
  return (
    <Badge className={cn("v3-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold", color)} data-tone={tone} data-status={status}>
      <span className="v3-badge-dot size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </Badge>
  );
}

function Field({
  id,
  label,
  children,
  hint,
  hidden = false,
}: {
  id?: string;
  label: string;
  children: ReactNode;
  hint?: string;
  hidden?: boolean;
}) {
  return (
    <label className="act-field grid min-w-0 gap-[7px] text-xs" id={id} hidden={hidden}>
      <span className="font-bold">{label}</span>
      {children}
      {hint && <small className="text-[11px] font-normal leading-[1.35] text-muted-foreground">{hint}</small>}
    </label>
  );
}

function formControlClass() {
  return "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
}

function FormStatus({ status, id }: { status: FormStatus; id: string }) {
  return (
    <p className={cn("act-form-status mt-4 text-[13px] text-muted-foreground", status.error && "is-error text-destructive")} id={id} role="status" aria-live="polite" hidden={!status.message}>
      {status.message}
    </p>
  );
}

function ActivityRow({
  activity,
  history = false,
  onEnd,
  isEnding = false,
}: {
  activity: Activity;
  history?: boolean;
  onEnd?: (id: string) => void;
  isEnding?: boolean;
}) {
  const claimed = Number(activity.progress?.claimed) || 0;
  const capacity = Number(activity.progress?.capacity) || 0;
  const credits = Number(activity.reward?.creditsPerClaim) || 0;
  const percent = capacity ? Math.min(100, Math.round((claimed / capacity) * 100)) : 0;
  return (
    <li className={cn("act-drop group grid grid-cols-3 gap-4 border-b border-border px-2 py-4 max-[960px]:[grid-template-areas:'code_code_state'_'credits_claims_expiry'_'actions_actions_actions'] min-[961px]:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto_auto] min-[961px]:items-center", history && "act-drop--past min-[961px]:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto]")} data-activity-id={activity.id}>
      <div className="act-drop__code grid min-w-0 gap-[2px] max-[960px]:[grid-area:code]">
        <code className={cn("wrap-anywhere font-mono text-[15px] font-bold leading-[1.3] tracking-[.02em]", history ? "text-muted-foreground" : "text-foreground")}>{activity.title}</code>
        <span className="act-drop__since text-xs text-muted-foreground">{history ? dateLabel(activity.createdAt) : `Since ${dateLabel(activity.createdAt)}`}</span>
      </div>
      <div className="act-drop__fact grid min-w-0 gap-0.5 text-xs text-muted-foreground max-[960px]:[grid-area:credits]"><span className="text-[11px] uppercase tracking-[.04em]">Per claim</span><strong className="text-[13px] font-semibold tabular-nums text-foreground">{credits.toLocaleString()} cr</strong></div>
      <div className="act-drop__fact act-drop__claims grid min-w-0 gap-1 text-xs text-muted-foreground max-[960px]:[grid-area:expiry]">
        <span className="text-[11px] uppercase tracking-[.04em]">Claimed</span><strong className="text-[13px] font-semibold tabular-nums text-foreground">{claimed.toLocaleString()} / {capacity.toLocaleString()}</strong>
        {!history && <span className="act-meter mt-[3px] block h-[3px] overflow-hidden rounded-[2px] bg-muted" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>}
      </div>
      <div className="act-drop__fact grid min-w-0 gap-0.5 text-xs text-muted-foreground max-[960px]:[grid-area:claims]"><span className="text-[11px] uppercase tracking-[.04em]">{history ? "Ended" : "Expiry"}</span><strong className="text-[13px] font-semibold tabular-nums text-foreground">{history ? (activity.endsAt ? dateLabel(activity.endsAt) : "—") : expiryLabel(activity.endsAt)}</strong></div>
      <div className="act-drop__state justify-self-start max-[960px]:[grid-area:state] max-[960px]:justify-self-end"><StatusBadge label={activity.stateLabel} tone={dropTone(activity)} status={activity.state} /></div>
      {!history && <div className="act-drop__actions justify-self-end max-[960px]:[grid-area:actions] max-[960px]:justify-self-start">{activity.actions?.canEnd && <Button type="button" variant="outline" size="sm" className="v3-btn v3-btn--xs h-8 px-2.5 opacity-55 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-[960px]:opacity-100 [@media(hover:none)]:opacity-100" data-activity-end={activity.id} aria-label={`End ${activity.title} now`} disabled={isEnding} onClick={() => onEnd?.(activity.id)}>End now</Button>}</div>}
    </li>
  );
}

function ActivitySection({
  title,
  rows,
  state,
  emptyTitle,
  emptyBody,
  emptyAction,
  listId,
  sectionId,
  onRetry,
  onEnd,
  endingActivityId = "",
  errorMessage: errorCopy,
  footer,
}: {
  title: string;
  rows: Activity[];
  state: ActivityListState;
  emptyTitle: string;
  emptyBody: string;
  emptyAction?: ReactNode;
  listId: string;
  sectionId: string;
  onRetry: () => void;
  onEnd?: (id: string) => void;
  endingActivityId?: string;
  errorMessage: string;
  footer?: ReactNode;
}) {
  const history = listId === "act-history-list";
  const stem = history ? "history" : "live";
  return (
    <section className={cn("act-list-shell v3-list-shell act-drops flex min-w-0 flex-col", history ? "act-drops--history" : "act-drops--live")} id={sectionId} aria-label={title} data-drop-list={history ? "history" : "live"}>
      <header className="v3-list-shell-head flex items-start justify-between gap-4 pb-3.5">
        <div className="v3-list-shell-copy">
          <h2 className="text-base font-semibold">{title}{!history && rows.length > 0 ? ` · ${rows.length}` : ""}</h2>
        </div>
      </header>
      <div className="v3-list-shell-body min-w-0">
        <div className="v3-loading" id={`act-${stem}-loading`} data-state="loading" hidden={state !== "loading"} role="status" aria-live="polite" aria-busy="true">
          <span className="v3-skeleton-line" aria-hidden="true" />
          <span className="v3-skeleton-line" aria-hidden="true" />
          <span className="sr-only">{history ? "Loading history…" : "Loading live now…"}</span>
        </div>
        <div id={`act-${stem}-error`} className="v3-empty v3-empty--error act-error" data-state="error" hidden={state !== "error"} role="alert">
          <h2>{history ? "History could not load" : "Live now could not load"}</h2>
          <p>{errorCopy || "Try again."}</p>
          <Button type="button" variant="outline" size="sm" data-retry={stem} onClick={onRetry}>Retry</Button>
        </div>
        <div id={`act-${stem}-empty`} className="v3-empty" data-state="empty" hidden={state !== "empty"}>
          <h2>{emptyTitle}</h2>
          <p>{emptyBody}</p>
          {emptyAction && <div className="v3-empty-actions justify-center">{emptyAction}</div>}
        </div>
        <ol className="act-rows m-0 grid list-none border-t border-border p-0" id={listId} hidden={state !== "rows"}>
          {rows.map((activity) => <ActivityRow key={activity.id} activity={activity} history={history} onEnd={onEnd} isEnding={endingActivityId === activity.id} />)}
        </ol>
      </div>
      {footer}
    </section>
  );
}

function TemplateRow({
  template,
  onEdit,
  onDelete,
}: {
  template: ActivityTemplate;
  onEdit: (template: ActivityTemplate, opener: HTMLElement) => void;
  onDelete: (id: string) => void;
}) {
  const config = template.config || {};
  const summary = `${Number(config.pointsReward || 0).toLocaleString()} cr · ${Number(config.maxClaims || 0).toLocaleString()} claims · ${config.expireMinutes ? `${Number(config.expireMinutes).toLocaleString()} min` : "No time limit"}`;
  return (
    <li className="act-item group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-b border-border px-2 py-3 max-[640px]:grid-cols-1" data-template-id={template.id}>
      <div className="act-item__copy grid min-w-0 gap-1"><strong className="wrap-anywhere text-sm">{template.name}</strong><span className="text-xs text-muted-foreground">{summary}</span></div>
      <div className="act-item__actions flex justify-self-end gap-2 max-[640px]:justify-self-start">
        <Button type="button" variant="outline" size="sm" className="v3-btn v3-btn--xs h-8 px-2.5 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" data-template-edit={template.id} onClick={(event) => onEdit(template, event.currentTarget)}>Edit</Button>
        <Button type="button" variant="outline" size="sm" className="v3-btn v3-btn--xs h-8 px-2.5 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" data-template-delete={template.id} aria-label={`Delete ${template.name}`} onClick={() => onDelete(template.id)}>Delete</Button>
      </div>
    </li>
  );
}

function ScheduleRow({
  schedule,
  canAutomate,
  onResume,
  onCancel,
}: {
  schedule: ActivitySchedule;
  canAutomate: boolean;
  onResume: (id: string, opener: HTMLElement) => void;
  onCancel: (id: string) => void;
}) {
  const cancellable = ["scheduled", "paused", "failed"].includes(schedule.status);
  const resumable = ["paused", "failed"].includes(schedule.status) && canAutomate;
  const attention = ["paused", "failed"].includes(schedule.status);
  return (
    <li className={cn("act-item act-item--schedule group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-3 border-b border-border px-2 py-3 max-[640px]:grid-cols-1", attention && "is-attention bg-amber-50/60 dark:bg-amber-950/20")} data-schedule-id={schedule.id}>
      <div className="act-item__copy grid min-w-0 gap-1">
        <strong className="wrap-anywhere text-sm">{schedule.templateName}</strong>
        <span className="text-xs text-muted-foreground">{recurrenceLabel(schedule.recurrence)} · {scheduleDateLabel(schedule.nextRunAt)}</span>
        {schedule.attentionMessage && <small className="text-xs text-amber-800">{schedule.attentionMessage}</small>}
      </div>
      <div className="act-item__state"><StatusBadge label={schedule.status} tone={scheduleTone(schedule.status)} status={schedule.status} /></div>
      <div className="act-item__actions flex justify-self-end gap-2 max-[640px]:justify-self-start">
        {resumable && <Button type="button" size="sm" className="v3-btn v3-btn--accent v3-btn--xs h-8 px-2.5 opacity-100" data-schedule-resume={schedule.id} onClick={(event) => onResume(schedule.id, event.currentTarget)}>Reschedule</Button>}
        {cancellable && <Button type="button" variant="outline" size="sm" className="v3-btn v3-btn--xs h-8 px-2.5 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" data-schedule-cancel={schedule.id} aria-label={`Cancel schedule ${schedule.templateName}`} onClick={() => onCancel(schedule.id)}>Cancel</Button>}
      </div>
    </li>
  );
}

function toLocalInputValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function ActivitiesPage({ deps: injectedDeps = activitiesTestDependencies }: { deps?: Partial<PageDependencies> } = {}) {
  const deps = useMemo(() => ({ ...DEFAULT_DEPENDENCIES, ...injectedDeps }), [injectedDeps]);
  const lifecycleRef = useRef({ active: false, token: 0, controller: null as AbortController | null });
  const activeSiteRef = useRef("");
  const automationLoadedRef = useRef(false);
  const [boardName, setBoardName] = useState("");
  const [tab, setTab] = useState<TabName>(() => window.location.hash.slice(1) === "automation" ? "automation" : "drops");
  const [liveRows, setLiveRows] = useState<Activity[]>([]);
  const [liveState, setLiveState] = useState<ActivityListState>("loading");
  const [liveError, setLiveError] = useState("");
  const [historyState, setHistoryState] = useState<ActivityListState>("loading");
  const [historyError, setHistoryError] = useState("");
  const [page, setPage] = useState(1);
  const [pageIsLoading, setPageIsLoading] = useState(false);
  const [automation, setAutomation] = useState<AutomationView>(EMPTY_AUTOMATION);
  const [automationLoaded, setAutomationLoaded] = useState(false);
  const [automationError, setAutomationError] = useState(false);
  const [feedback, setFeedback] = useState<FormStatus>({ message: "", error: false });
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [drawerTitle, setDrawerTitle] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templatePoints, setTemplatePoints] = useState("100");
  const [templateMax, setTemplateMax] = useState("50");
  const [templateExpire, setTemplateExpire] = useState("0");
  const [dropCode, setDropCode] = useState("");
  const [dropPoints, setDropPoints] = useState("100");
  const [dropMax, setDropMax] = useState("50");
  const [dropExpire, setDropExpire] = useState("0");
  const [scheduleResumeId, setScheduleResumeId] = useState("");
  const [scheduleTemplate, setScheduleTemplate] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");
  const [scheduleRecurrence, setScheduleRecurrence] = useState<ActivityRecurrence>("once");
  const [createStatus, setCreateStatus] = useState<FormStatus>({ message: "", error: false });
  const [templateStatus, setTemplateStatus] = useState<FormStatus>({ message: "", error: false });
  const [scheduleStatus, setScheduleStatus] = useState<FormStatus>({ message: "", error: false });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [endingActivityId, setEndingActivityId] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const focusFieldRef = useRef<string | null>(null);
  const focusRestoreRef = useRef<HTMLElement | null>(null);
  const scrollHistoryRef = useRef(false);

  const current = useCallback((token: number) => lifecycleRef.current.active && lifecycleRef.current.token === token, []);

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}, requestSiteId = activeSiteRef.current, token = lifecycleRef.current.token): Promise<T> => {
    const timeout = AbortSignal.timeout(10_000);
    try {
      const url = new URL(path, window.location.href);
      const siteId = requestSiteId || new URLSearchParams(window.location.search).get("siteId") || "";
      return await deps.api<T>(path, { ...options, signal: timeout }, url.searchParams.has("siteId") ? "" : siteId);
    } catch (caught) {
      const error = caught as RequestError;
      if (timeout.aborted) throw new Error("The request timed out.");
      if (!current(token)) throw error;
      const body = record(error?.data);
      const code = [body?.code, body?.error].find((value) => typeof value === "string") as string | undefined;
      if (error?.status === 401 || code?.trim().toLowerCase() === "unauthorized") {
        window.location.href = deps.loginRedirectPath(window.location);
        throw error;
      }
      if (error?.status === 403 && !body?.error) {
        throw Object.assign(new Error("You don't have access to do that."), { status: 403, data: error.data });
      }
      if (error?.status && !body?.error) {
        throw Object.assign(new Error(`The server returned HTTP ${error.status}.`), { status: error.status, data: error.data });
      }
      throw error;
    }
  }, [current, deps]);

  const toastFeedback = useCallback((message: string, error = false) => {
    setFeedback({ message, error });
    if (message) deps.showToast(message, error ? "error" : "success");
  }, [deps]);

  const loadLive = useCallback(async (token = lifecycleRef.current.token, requestSiteId = activeSiteRef.current) => {
    setLiveState("loading");
    setLiveError("");
    try {
      const result = await request<ActivitiesResponse>(activitiesQuery("open", LIVE_LIMIT, null, requestSiteId), {}, requestSiteId, token);
      if (!current(token)) return;
      const rows = Array.isArray(result.activities) ? result.activities : [];
      setLiveRows(rows);
      setLiveState(rows.length ? "rows" : "empty");
      if (result.automation) {
        setAutomation(result.automation);
        setAutomationLoaded(true);
        setAutomationError(false);
        automationLoadedRef.current = true;
      }
    } catch (error) {
      if (!current(token)) return;
      setLiveState("error");
      const message = errorMessage(error, "Try again.");
      setLiveError(message);
      if (!automationLoadedRef.current) {
        setAutomation(EMPTY_AUTOMATION);
        setAutomationLoaded(true);
        setAutomationError(true);
        automationLoadedRef.current = true;
        toastFeedback(errorMessage(error, "Automation could not load."), true);
      }
    }
  }, [current, request, toastFeedback]);

  const loadHistory = useCallback(async (token = lifecycleRef.current.token, requestSiteId = activeSiteRef.current) => {
    setHistoryState("loading");
    setHistoryError("");
    activityPaging.pageLoading = false;
    setPageIsLoading(false);
    try {
      const result = await request<ActivitiesResponse>(activitiesQuery("completed", activityPaging.pages.pageSize, null, requestSiteId), {}, requestSiteId, token);
      if (!current(token)) return;
      const rows = Array.isArray(result.activities) ? result.activities : [];
      activityPaging.pages.reset(activityPaging.pages.pageSize);
      activityPaging.pages.store(1, rows, result.page, result.total ?? rows.length);
      activityPaging.page = 1;
      setPage(1);
      setHistoryState(rows.length ? "rows" : "empty");
    } catch (error) {
      if (!current(token)) return;
      setHistoryState("error");
      const message = errorMessage(error, "Try again.");
      setHistoryError(message);
    }
  }, [current, request]);

  const loadAll = useCallback((token = lifecycleRef.current.token, requestSiteId = activeSiteRef.current) => (
    Promise.all([loadLive(token, requestSiteId), loadHistory(token, requestSiteId)])
  ), [loadHistory, loadLive]);

  const onEndActivity = useCallback((id: string) => {
    const activity = liveRows.find((item) => item.id === id);
    if (!activity) return;
    setConfirm({
      title: `End "${activity.title}" now?`,
      body: "Members can no longer claim it. Existing claims are kept.",
      confirmText: "End now",
      action: async () => {
        const token = lifecycleRef.current.token;
        setEndingActivityId(id);
        try {
          const body: CloseActivityRequest = { siteId: activeSiteRef.current, activityId: id };
          const result = await request<CloseActivityResponse>("/api/activities/close", {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (!current(token)) return;
          toastFeedback(result.changed ? `Ended ${activity.title}.` : "That drop had already ended.");
          await loadAll(token);
        } catch (error) {
          if (!current(token)) return;
          if ([409, 404].includes(errorStatus(error))) await loadAll(token);
          toastFeedback(errorMessage(error, "The drop could not be ended."), true);
        } finally {
          if (current(token)) setEndingActivityId("");
        }
      },
    });
  }, [current, liveRows, loadAll, request, toastFeedback]);

  const openCreateDrawer = useCallback((opener?: HTMLElement) => {
    focusRestoreRef.current = opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setCreateStatus({ message: "", error: false });
    focusFieldRef.current = "act-drop-code";
    setDrawerTitle("Launch a code drop");
    setDrawer("create");
  }, []);

  const openTemplateForm = useCallback((template: ActivityTemplate | null = null, opener?: HTMLElement) => {
    if (!automation.entitlement?.canAutomate) return;
    focusRestoreRef.current = opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setTemplateId(template?.id || "");
    setTemplateName(template?.name || "");
    setTemplatePoints(String(template?.config?.pointsReward ?? 100));
    setTemplateMax(String(template?.config?.maxClaims ?? 50));
    setTemplateExpire(String(template?.config?.expireMinutes ?? 0));
    setTemplateStatus({ message: "", error: false });
    setDrawerTitle(template ? "Edit template" : "New template");
    focusFieldRef.current = "act-template-name";
    setDrawer("template");
  }, [automation.entitlement?.canAutomate]);

  const openScheduleForm = useCallback((resumeId = "", opener?: HTMLElement) => {
    if (!automation.entitlement?.canAutomate) return;
    if (!resumeId && !automation.templates?.length) {
      toastFeedback("Create a template before scheduling.", true);
      return;
    }
    focusRestoreRef.current = opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setScheduleResumeId(resumeId);
    setScheduleAt(toLocalInputValue(new Date(Date.now() + 10 * 60_000)));
    setScheduleTemplate((current) => automation.templates?.some((template) => template.id === current) ? current : automation.templates?.[0]?.id || "");
    setScheduleStatus({ message: "", error: false });
    setDrawerTitle(resumeId ? "Reschedule" : "Schedule an Activity");
    focusFieldRef.current = "act-schedule-at";
    setDrawer("schedule");
  }, [automation.entitlement?.canAutomate, automation.templates, toastFeedback]);

  const submitDrop = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = lifecycleRef.current.token;
    setIsSubmitting(true);
    setCreateStatus({ message: "Launching drop…", error: false });
    const code = dropCode;
    try {
      const body: CreateCodeDropRequest = {
        siteId: activeSiteRef.current,
        code,
        pointsReward: Number(dropPoints || 0),
        maxClaims: Number(dropMax || 0),
        expireMinutes: Number(dropExpire || 0),
      };
      await request<CreateCodeDropResponse>("/api/events/drops", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!current(token)) return;
      setDropCode("");
      setDropPoints("100");
      setDropMax("50");
      setDropExpire("0");
      setCreateStatus({ message: "", error: false });
      setDrawer(null);
      toastFeedback(`Drop ${code.trim().toUpperCase()} is live.`);
      await loadAll(token);
    } catch (error) {
      if (current(token)) setCreateStatus({ message: errorMessage(error, "The drop could not be launched."), error: true });
    } finally {
      if (current(token)) setIsSubmitting(false);
    }
  }, [current, dropCode, dropExpire, dropMax, dropPoints, loadAll, request, toastFeedback]);

  const submitTemplate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = lifecycleRef.current.token;
    setIsSubmitting(true);
    setTemplateStatus({ message: templateId ? "Saving changes…" : "Saving template…", error: false });
    try {
      const body: ActivityTemplateWriteRequest = {
        siteId: activeSiteRef.current,
        templateId: templateId || undefined,
        kind: "safe_code_drop",
        name: templateName,
        config: {
          pointsReward: Number(templatePoints),
          maxClaims: Number(templateMax),
          expireMinutes: Number(templateExpire),
        },
      };
      await request<ActivityTemplateResponse>("/api/activities/templates", {
        method: templateId ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      if (!current(token)) return;
      setDrawer(null);
      toastFeedback(templateId ? "Template updated." : "Template saved.");
      await loadLive(token);
    } catch (error) {
      if (current(token)) setTemplateStatus({ message: errorMessage(error, "The template could not be saved."), error: true });
    } finally {
      if (current(token)) setIsSubmitting(false);
    }
  }, [current, loadLive, request, templateExpire, templateId, templateMax, templateName, templatePoints, toastFeedback]);

  const deleteTemplate = useCallback((id: string) => {
    const template = automation.templates?.find((item) => item.id === id);
    if (!template) return;
    setConfirm({
      title: `Delete "${template.name}"?`,
      body: "Existing schedules keep their saved snapshot.",
      confirmText: "Delete",
      action: async () => {
        const token = lifecycleRef.current.token;
        const snapshot = automation;
        const next = { ...automation, templates: (automation.templates || []).filter((item) => item.id !== id) };
        setAutomation(next);
        try {
          const body: ActivityTemplateDeleteRequest = { siteId: activeSiteRef.current, templateId: id };
          await request<ActivityTemplateDeleteResponse>("/api/activities/templates/delete", {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (!current(token)) return;
          toastFeedback(`Deleted ${template.name}.`);
          await loadLive(token);
        } catch (error) {
          if (!current(token)) return;
          setAutomation(snapshot);
          toastFeedback(errorMessage(error, "The template could not be deleted."), true);
        }
      },
    });
  }, [automation, current, loadLive, request, toastFeedback]);

  const submitSchedule = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = lifecycleRef.current.token;
    const local = new Date(scheduleAt);
    if (Number.isNaN(local.getTime())) {
      setScheduleStatus({ message: "Choose a valid future date and time.", error: true });
      return;
    }
    setIsSubmitting(true);
    setScheduleStatus({ message: scheduleResumeId ? "Rescheduling…" : "Scheduling…", error: false });
    try {
      const body: CreateActivityScheduleRequest | ResumeActivityScheduleRequest = scheduleResumeId
        ? { siteId: activeSiteRef.current, scheduleId: scheduleResumeId, runAt: local.toISOString() }
        : { siteId: activeSiteRef.current, templateId: scheduleTemplate, recurrence: scheduleRecurrence, runAt: local.toISOString() };
      await request<ActivityScheduleResponse>(scheduleResumeId ? "/api/activities/schedules/resume" : "/api/activities/schedules", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!current(token)) return;
      setDrawer(null);
      toastFeedback(scheduleResumeId ? "Schedule updated." : "Activity scheduled.");
      await loadLive(token);
    } catch (error) {
      if (current(token)) setScheduleStatus({ message: errorMessage(error, "The Activity could not be scheduled."), error: true });
    } finally {
      if (current(token)) setIsSubmitting(false);
    }
  }, [current, loadLive, request, scheduleAt, scheduleRecurrence, scheduleResumeId, scheduleTemplate, toastFeedback]);

  const cancelSchedule = useCallback((id: string) => {
    const schedule = automation.schedules?.find((item) => item.id === id);
    if (!schedule) return;
    setConfirm({
      title: `Cancel "${schedule.templateName}"?`,
      body: "No future Activity will be created from this schedule.",
      confirmText: "Cancel Schedule",
      action: async () => {
        const token = lifecycleRef.current.token;
        const snapshot = automation;
        setAutomation({ ...automation, schedules: (automation.schedules || []).filter((item) => item.id !== id) });
        try {
          const body: CancelActivityScheduleRequest = { siteId: activeSiteRef.current, scheduleId: id };
          await request<ActivityScheduleResponse>("/api/activities/schedules/cancel", {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (!current(token)) return;
          toastFeedback("Schedule cancelled.");
          await loadLive(token);
        } catch (error) {
          if (!current(token)) return;
          setAutomation(snapshot);
          toastFeedback(errorMessage(error, "The schedule could not be cancelled."), true);
        }
      },
    });
  }, [automation, current, loadLive, request, toastFeedback]);

  const goToPage = useCallback(async (target: number) => {
    const pages = activityPaging.pages;
    const next = pages.clamp(target);
    if (next === activityPaging.page || activityPaging.pageLoading) return;
    if (pages.isLoaded(next)) {
      activityPaging.page = next;
      scrollHistoryRef.current = true;
      setPage(next);
      return;
    }
    const cursor = pages.cursorFor(next);
    if (cursor === undefined) return;
    const token = lifecycleRef.current.token;
    activityPaging.pageLoading = true;
    setPageIsLoading(true);
    try {
      const result = await request<ActivitiesResponse>(activitiesQuery("completed", pages.pageSize, cursor, activeSiteRef.current), {}, activeSiteRef.current, token);
      if (!current(token)) return;
      const rows = Array.isArray(result.activities) ? result.activities : [];
      pages.store(next, rows, result.page, result.total ?? pages.total);
      activityPaging.page = next;
      scrollHistoryRef.current = true;
      setPage(next);
    } catch (error) {
      if (!current(token)) return;
      if (errorStatus(error) === 410) {
        await loadHistory(token);
        return;
      }
      toastFeedback(errorMessage(error, "Older drops could not be loaded."), true);
    } finally {
      if (current(token)) {
        activityPaging.pageLoading = false;
        setPageIsLoading(false);
      }
    }
  }, [current, loadHistory, request, toastFeedback]);

  const selectTab = useCallback((next: TabName, updateHash = true) => {
    setTab(next);
    const root = document.getElementById("act-app");
    if (root) root.dataset.tab = next;
    if (updateHash && window.location.hash !== `#${next}`) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${next}`);
    }
  }, []);

  useEffect(() => {
    if (!scrollHistoryRef.current) return;
    scrollHistoryRef.current = false;
    const panel = document.getElementById("act-history");
    if (panel && typeof panel.scrollIntoView === "function" && document.documentElement?.scrollHeight > window.innerHeight) {
      panel.scrollIntoView({ block: "nearest" });
    }
  }, [page]);

  useEffect(() => {
    const controller = new AbortController();
    const token = lifecycleRef.current.token + 1;
    lifecycleRef.current = { active: true, token, controller };
    automationLoadedRef.current = false;
    const selectedTab = window.location.hash.slice(1) === "automation" ? "automation" : "drops";
    setAutomationError(false);
    setTab(selectedTab);
    const root = document.getElementById("act-app");
    if (root) root.dataset.tab = selectedTab;
    (async () => {
      try {
        const shell = await deps.loadBoardShell();
        if (!current(token)) return;
        const activeSiteId = shell.activeSiteId || "";
        activeSiteRef.current = activeSiteId;
        setBoardName(shell.board?.name || shell.board?.slug || "");
        await deps.preserveSiteContextLinks(activeSiteId);
        if (!current(token)) return;
        await loadAll(token, activeSiteId);
        if (current(token)) window.__yrBoot?.signal?.();
      } catch (error) {
        if (!current(token)) return;
        setLiveState("error");
        setHistoryState("error");
        setLiveError(errorMessage(error, "Try again."));
        setHistoryError(errorMessage(error, "Try again."));
        setAutomationLoaded(true);
        setAutomationError(true);
        automationLoadedRef.current = true;
        toastFeedback(errorMessage(error, "Automation could not load."), true);
        window.__yrBoot?.signal?.();
      }
    })();
    return () => {
      lifecycleRef.current.active = false;
      lifecycleRef.current.token += 1;
      controller.abort();
      activeSiteRef.current = "";
      activityPaging.pages.reset(activityPaging.pages.pageSize);
      activityPaging.page = 1;
      activityPaging.pageLoading = false;
    };
  }, [current, deps, loadAll, toastFeedback]);

  useEffect(() => {
    if (!automationLoaded || automationError || automation.entitlement?.canAutomate !== false || !gateRef.current) return;
    deps.wirePlanLock(gateRef.current, "activity_automation");
  }, [automation.entitlement?.canAutomate, automationError, automationLoaded, deps]);

  const historyRows = activityPaging.pages.rows(page);
  const totalPages = activityPaging.pages.reachableCount();
  const pagerHidden = historyState !== "rows" || activityPaging.pages.total === 0 || (totalPages <= 1 && activityPaging.pages.total <= activityPaging.pages.pageSize);
  const scheduleGroups = useMemo(() => {
    const schedules = Array.isArray(automation.schedules) ? automation.schedules : [];
    return [
      ["attention", "Needs attention", schedules.filter((item) => item.status === "paused" || item.status === "failed")],
      ["upcoming", "Upcoming", schedules.filter((item) => item.status === "scheduled")],
      ["past", "Past", schedules.filter((item) => !["paused", "failed", "scheduled"].includes(item.status))],
    ] as const;
  }, [automation.schedules]);
  const templates = automation.templates || [];
  const canAutomate = automation.entitlement?.canAutomate === true;

  const onPagerSizeChange = (value: string) => {
    const size = normalizePageSize(value);
    activityPaging.pages.reset(size);
    activityPaging.page = 1;
    setPage(1);
    void loadHistory();
  };

  const preventSheetAutoFocus = (event: Event) => event.preventDefault();

  const previousDrawerRef = useRef<DrawerKind>(null);
  useEffect(() => {
    const focusFieldId = drawer ? focusFieldRef.current : null;
    const focusTimer = focusFieldId
      ? window.setTimeout(() => document.getElementById(focusFieldId)?.focus(), 0)
      : null;
    if (!drawer && previousDrawerRef.current) {
      focusRestoreRef.current?.focus();
    }
    previousDrawerRef.current = drawer;
    if (!drawer) {
      return () => {
        if (focusTimer !== null) window.clearTimeout(focusTimer);
      };
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [drawer]);

  return (
    <div className="yr-react grid min-w-0 w-full max-w-[1440px] gap-6" id="act-app" data-tab={tab}>
      <header className="v3-head v3-head--row flex items-start justify-between gap-5 !mb-0">
        <div className="v3-head-col min-w-0 flex-1">
          <h1>Activities</h1>
          <div className="v3-head-meta">
            <span className="v3-scope" data-scope="site" id="act-scope">
              <span className="v3-scope-dot" aria-hidden="true" />
              <span className="v3-scope-label">Current site</span>
              {boardName && <span className="v3-scope-name">{boardName}</span>}
            </span>
          </div>
          <p className="v3-head-sub">Free code drops that hand out credits to your community.</p>
        </div>
        <div className="v3-head-actions">
          <Button type="button" id="act-create-toggle" size="sm" data-drawer-open="act-create-drawer" onClick={(event) => openCreateDrawer(event.currentTarget)}>Create drop</Button>
        </div>
      </header>

      <nav className="v3-tabs act-tabs sticky z-[19]" style={{ top: "calc(var(--ws-topbar-h) + var(--sticky-head-offset, 0px))", background: "var(--ws-canvas)" }} role="tablist" aria-label="Activities" data-subnav-strip>
        {(["drops", "automation"] as const).map((key) => (
          <a
            key={key}
            href={`#${key}`}
            className={cn("v3-tab", tab === key && "is-on")}
            id={`act-tab-${key}`}
            role="tab"
            aria-controls={`act-panel-${key}`}
            aria-selected={tab === key}
            aria-current={tab === key ? "page" : undefined}
            tabIndex={tab === key ? 0 : -1}
            data-subnav={key}
            onClick={(event) => { event.preventDefault(); selectTab(key); }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              const next = event.key === "Home" ? "drops" : event.key === "End" ? "automation" : key === "drops" ? "automation" : "drops";
              selectTab(next);
              document.getElementById(`act-tab-${next}`)?.focus();
            }}
          >
            {key === "drops" ? "Drops" : "Automation"}
          </a>
        ))}
      </nav>

      <p className={cn("act-feedback m-0 text-xs leading-normal", feedback.error ? "is-error text-destructive" : "text-emerald-700 dark:text-emerald-300")} id="act-feedback" role="status" aria-live="polite" hidden={!feedback.message}>{feedback.message}</p>

      <section className="grid gap-7" id="act-panel-drops" role="tabpanel" aria-labelledby="act-tab-drops" data-tab-panel="drops" hidden={tab !== "drops"}>
        <ActivitySection
          title="Live now"
          rows={liveRows}
          state={liveState}
          emptyTitle="No live drops"
          emptyBody="Launch a code and claims will show up here as they happen."
          emptyAction={<Button type="button" size="sm" data-drawer-open="act-create-drawer" onClick={(event) => openCreateDrawer(event.currentTarget)}>Create drop</Button>}
          listId="act-live-list"
          sectionId="act-live"
          onRetry={() => void loadLive()}
          onEnd={onEndActivity}
          endingActivityId={endingActivityId}
          errorMessage={liveError}
        />
        <ActivitySection
          title="History"
          rows={historyRows}
          state={historyState}
          emptyTitle="No past drops yet"
          emptyBody="Ended, expired, and claimed-out drops are kept here."
          listId="act-history-list"
          sectionId="act-history"
          onRetry={() => void loadHistory()}
          errorMessage={historyError}
          footer={
            <div className="v3-list-shell-foot flex items-center justify-between gap-4 pt-3 text-[13px] text-muted-foreground">
              <nav className="act-pager flex flex-1 flex-wrap items-center justify-between gap-x-5 gap-y-3" id="act-pager" aria-label="History pages" hidden={pagerHidden}>
                <p className="act-pager__range m-0 text-xs leading-[1.4] text-muted-foreground" id="act-pager-range" aria-live="polite">{rangeLabel(activityPaging.pages.total, page, activityPaging.pages.pageSize)}</p>
                <div className="act-pager__controls flex items-center gap-1">
                  <Button type="button" size="sm" variant="outline" className="v3-btn v3-btn--sm" id="act-pager-prev" data-pager-step="-1" disabled={pageIsLoading || page <= 1} onClick={() => void goToPage(page - 1)}>Previous</Button>
                  <ol className="act-pager__pages m-0 flex list-none items-center gap-1 p-0" id="act-pager-pages">
                    {pageWindow(page, totalPages).map((entry, index) => entry === "gap"
                      ? <li className="act-pager__gap px-1 text-sm text-muted-foreground" key={`gap-${index}`} aria-hidden="true">…</li>
                      : <li key={entry}><Button type="button" variant="ghost" size="sm" className={cn("act-pager__page h-8 min-w-8 rounded-sm border border-transparent px-2 font-mono text-xs font-semibold leading-none text-muted-foreground hover:border-border hover:text-foreground", entry === page && "is-current border-primary bg-primary text-primary-foreground")} data-pager-page={entry} aria-current={entry === page ? "page" : undefined} aria-label={`Page ${entry}`} onClick={() => void goToPage(entry)}>{entry}</Button></li>)}
                  </ol>
                  <Button type="button" size="sm" variant="outline" className="v3-btn v3-btn--sm" id="act-pager-next" data-pager-step="1" disabled={pageIsLoading || page >= totalPages} onClick={() => void goToPage(page + 1)}>Next</Button>
                </div>
                <label className="act-pager__size flex items-center gap-2 text-xs text-muted-foreground" htmlFor="act-pager-size"><span>Per page</span><select className="h-8 rounded-sm border border-border bg-background px-2 text-[13px] text-foreground" id="act-pager-size" aria-label="History rows per page" value={activityPaging.pages.pageSize} onChange={(event) => onPagerSizeChange(event.target.value)}>{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
              </nav>
            </div>
          }
        />
      </section>

      <section className="grid gap-7" id="act-panel-automation" role="tabpanel" aria-labelledby="act-tab-automation" data-tab-panel="automation" hidden={tab !== "automation"}>
        <div className="rounded-xl border border-border bg-card p-5" id="act-automation-loading" hidden={automationLoaded}>
          <div className="grid gap-3" aria-hidden="true"><span className="h-4 w-2/5 animate-pulse rounded bg-muted" /><span className="h-4 w-3/4 animate-pulse rounded bg-muted" /></div>
          <span className="sr-only">Checking automation…</span>
        </div>
        <div className="act-lock grid max-w-[720px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl border border-dashed border-border bg-transparent px-5 py-4 text-left max-[640px]:grid-cols-1" id="act-automation-gate" data-plan-lock="activity_automation" role="status" ref={gateRef} hidden={!automationLoaded || automationError || canAutomate}>
          <h2 className="col-start-1 m-0 text-base font-semibold">Templates and schedules need Pro or Team</h2>
          <p className="col-start-1 m-0 text-[13px] text-muted-foreground" id="act-automation-gate-copy">{automation.entitlement?.message || "Manual code drops remain available."}</p>
          <Button asChild variant="outline" size="sm" className="col-start-2 row-span-2 row-start-1 max-[640px]:col-start-1 max-[640px]:row-span-1 max-[640px]:row-start-auto">
            <a href="/dashboard/settings/billing?from=activities" data-plan-lock-upgrade>View plans</a>
          </Button>
        </div>
        <div className="act-automation grid gap-7" id="act-automation" hidden={!automationLoaded || automationError || !canAutomate}>
          <section className="act-automation-list" id="act-templates" aria-label="Templates">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="m-0 text-lg font-semibold">Templates</h2><p className="mt-1 text-[13px] text-muted-foreground">Reusable drop settings.</p></div>
              <Button type="button" size="sm" id="act-template-new" data-drawer-open="act-template-drawer" onClick={(event) => openTemplateForm(null, event.currentTarget)}>New template</Button>
            </header>
            <ol className="act-rows act-rows--compact m-0 mt-4 grid list-none border-t border-border p-0" id="act-template-list" hidden={!templates.length}>
              {templates.map((template) => <TemplateRow key={template.id} template={template} onEdit={openTemplateForm} onDelete={deleteTemplate} />)}
            </ol>
            <div className="v3-empty mt-4" id="act-template-empty" data-state="empty" hidden={templates.length > 0}><h2>No templates yet</h2><p>Save the settings you repeat most often.</p></div>
          </section>

          <section className="act-automation-list" id="act-schedules" aria-label="Schedules">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="m-0 text-lg font-semibold">Schedules</h2><p className="mt-1 text-[13px] text-muted-foreground">Shown in your local time.</p></div>
              <Button type="button" variant="outline" size="sm" id="act-schedule-new" data-drawer-open="act-schedule-drawer" disabled={!templates.length} onClick={(event) => openScheduleForm("", event.currentTarget)}>Schedule</Button>
            </header>
            <div className="act-schedule-groups mt-4 grid gap-5" id="act-schedule-list" hidden={!automation.schedules?.length}>
              {scheduleGroups.filter(([, , schedules]) => schedules.length > 0).map(([key, label, schedules]) => (
                <section className="act-schedule-group" data-group={key} key={key}>
                  <h3 className={cn("mb-2 flex items-baseline gap-2 text-[15px] font-bold uppercase tracking-[.04em]", key === "attention" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{label} <span className="text-xs font-medium tabular-nums text-muted-foreground">{schedules.length}</span></h3>
                  <ol className="act-rows act-rows--compact m-0 grid list-none border-t border-border p-0">{schedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} canAutomate={canAutomate} onResume={openScheduleForm} onCancel={cancelSchedule} />)}</ol>
                </section>
              ))}
            </div>
            <div className="v3-empty mt-4" id="act-schedule-empty" data-state="empty" hidden={(automation.schedules || []).length > 0}><h2>Nothing scheduled</h2><p>Create a template, then choose when it should run.</p></div>
          </section>
        </div>
      </section>

      <Sheet open={drawer === "create"} onOpenChange={(open) => { if (!open) setDrawer(null); }}>
        <SheetContent id="act-create-drawer" side="right" className="min-[561px]:max-w-[560px]" onOpenAutoFocus={preventSheetAutoFocus} onCloseAutoFocus={preventSheetAutoFocus}>
          <SheetHeader>
            <SheetTitle>Launch a code drop</SheetTitle>
            <SheetDescription>Members claim the code once each while supplies last. No purchase or stake is required.</SheetDescription>
          </SheetHeader>
          <form className="flex min-h-0 flex-1 flex-col" id="act-drop-form" onSubmit={submitDrop}>
            <div className="grid gap-5 overflow-y-auto px-6 py-5">
              <Field label="Code" hint="Letters, numbers, dashes, and underscores.">
                <input className={formControlClass()} id="act-drop-code" name="code" type="text" minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="COMMUNITY100" autoComplete="off" spellCheck={false} required value={dropCode} onChange={(event) => setDropCode(event.target.value)} />
              </Field>
              <div className="grid gap-4 min-[641px]:grid-cols-2">
                <Field label="Credits per claim"><input className={formControlClass()} id="act-drop-points" name="pointsReward" type="number" min={1} max={100000} inputMode="numeric" required value={dropPoints} onChange={(event) => setDropPoints(event.target.value)} /></Field>
                <Field label="Available claims"><input className={formControlClass()} id="act-drop-max" name="maxClaims" type="number" min={1} max={10000} inputMode="numeric" required value={dropMax} onChange={(event) => setDropMax(event.target.value)} /></Field>
              </div>
              <Field label="Time limit"><select className={formControlClass()} id="act-drop-expire" name="expireMinutes" value={dropExpire} onChange={(event) => setDropExpire(event.target.value)}><option value="0">No time limit</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option></select></Field>
              <FormStatus id="act-form-status" status={createStatus} />
            </div>
            <SheetFooter>
              <Button type="button" variant="outline" id="act-drop-cancel" data-drawer-close onClick={() => setDrawer(null)}>Cancel</Button>
              <Button type="submit" id="act-drop-submit" disabled={isSubmitting}>Launch drop</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={drawer === "template"} onOpenChange={(open) => { if (!open) setDrawer(null); }}>
        <SheetContent id="act-template-drawer" side="right" className="min-[561px]:max-w-[560px]" onOpenAutoFocus={preventSheetAutoFocus} onCloseAutoFocus={preventSheetAutoFocus}>
          <SheetHeader>
            <SheetTitle id="act-template-drawer-title">{drawerTitle}</SheetTitle>
            <SheetDescription>Saved settings for a code drop. A template never launches anything by itself.</SheetDescription>
          </SheetHeader>
          <form className="flex min-h-0 flex-1 flex-col" id="act-template-form" onSubmit={submitTemplate}>
            <div className="grid gap-5 overflow-y-auto px-6 py-5">
              <input id="act-template-id" type="hidden" value={templateId} readOnly />
              <Field label="Template name"><input className={formControlClass()} id="act-template-name" maxLength={80} placeholder="Stream break drop" autoComplete="off" required value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></Field>
              <div className="grid gap-4 min-[641px]:grid-cols-2">
                <Field label="Credits per claim"><input className={formControlClass()} id="act-template-points" type="number" min={1} max={100000} inputMode="numeric" required value={templatePoints} onChange={(event) => setTemplatePoints(event.target.value)} /></Field>
                <Field label="Available claims"><input className={formControlClass()} id="act-template-max" type="number" min={1} max={10000} inputMode="numeric" required value={templateMax} onChange={(event) => setTemplateMax(event.target.value)} /></Field>
              </div>
              <Field label="Time limit"><select className={formControlClass()} id="act-template-expire" value={templateExpire} onChange={(event) => setTemplateExpire(event.target.value)}><option value="0">No time limit</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">24 hours</option></select></Field>
              <FormStatus id="act-template-status" status={templateStatus} />
            </div>
            <SheetFooter>
              <Button type="button" variant="outline" id="act-template-form-cancel" data-drawer-close onClick={() => setDrawer(null)}>Cancel</Button>
              <Button type="submit" id="act-template-save" disabled={isSubmitting}>{templateId ? "Save changes" : "Save template"}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={drawer === "schedule"} onOpenChange={(open) => { if (!open) setDrawer(null); }}>
        <SheetContent id="act-schedule-drawer" side="right" className="min-[561px]:max-w-[420px]" onOpenAutoFocus={preventSheetAutoFocus} onCloseAutoFocus={preventSheetAutoFocus}>
          <SheetHeader>
            <SheetTitle id="act-schedule-drawer-title">{drawerTitle}</SheetTitle>
            <SheetDescription>The template's settings are copied when the schedule runs.</SheetDescription>
          </SheetHeader>
          <form className="flex min-h-0 flex-1 flex-col" id="act-schedule-form" onSubmit={submitSchedule}>
            <div className="grid gap-5 overflow-y-auto px-6 py-5">
              <input id="act-resume-id" type="hidden" value={scheduleResumeId} readOnly />
              <Field label="Template" id="act-schedule-template-field" hidden={Boolean(scheduleResumeId)}>
                <select className={formControlClass()} id="act-schedule-template" required value={scheduleTemplate} onChange={(event) => setScheduleTemplate(event.target.value)}>
                  {templates.length ? templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>) : <option value="">Create a template first</option>}
                </select>
              </Field>
              <Field label="First run" hint="Uses your browser’s local time.">
                <input className={formControlClass()} id="act-schedule-at" type="datetime-local" required value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
              </Field>
              <Field label="Repeat" id="act-schedule-recurrence-field" hidden={Boolean(scheduleResumeId)}>
                <select className={formControlClass()} id="act-schedule-recurrence" value={scheduleRecurrence} onChange={(event) => setScheduleRecurrence(event.target.value as ActivityRecurrence)}>
                  <option value="once">One time</option><option value="daily">Every 24 hours (UTC)</option><option value="weekly">Every 7 days (UTC)</option>
                </select>
              </Field>
              <FormStatus id="act-schedule-status" status={scheduleStatus} />
            </div>
            <SheetFooter>
              <Button type="button" variant="outline" id="act-schedule-form-cancel" data-drawer-close onClick={() => setDrawer(null)}>Cancel</Button>
              <Button type="submit" id="act-schedule-save" disabled={isSubmitting}>{scheduleResumeId ? "Set new future time" : "Schedule Activity"}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogPortal>
          <AlertDialogOverlay className="z-[1200]" />
          <AlertDialogPrimitive.Content className="yr-react fixed left-1/2 top-1/2 z-[1201] grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border bg-popover p-6 text-popover-foreground shadow-lg focus:outline-none">
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="border border-destructive/30 bg-background text-destructive hover:bg-destructive/5 focus-visible:ring-destructive" onClick={() => { const action = confirm?.action; setConfirm(null); if (action) void action(); }}>{confirm?.confirmText || "Confirm"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogPrimitive.Content>
        </AlertDialogPortal>
      </AlertDialog>
    </div>
  );
}
