import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { bulkAwardSummary, remainingSelection, runBulkAward } from "../../../assets/bulk-award.js";
import { exportRows, MemberSelection } from "../../../assets/member-selection.js";
import { showConfirmModal, showPromptModal } from "../../../assets/dashboard/utils.js";
import type {
  ActivityEvent,
  ActivityResponse,
  AudienceTab,
  BoardShellContext,
  LinkedAccountsResponse,
  LinkedGroup,
  Member,
  MemberCreditEvent,
  MemberDetailResponse,
  MemberPageResponse,
  ReviewsResponse,
  Review,
  ViewerHistoryResponse,
} from "./types";
import "./styles.css";

const BULK_AWARD_MAX = 25;
const BOARD_SHELL_MODULE = "/assets/dashboard/board-shell.js";
const LEDGER_EVENT_LABELS: Record<string, string> = {
  earn: "Earned",
  spend: "Spent",
  redeem: "Claimed",
  revoke: "Refunded spend",
  refund: "Reversed earn",
};
const LINKED_ACTION_COPY = {
  watch: ["Watch this link?", "The pair stays flagged for review. No restriction is applied.", "Watch", false],
  restrict: ["Restrict this link?", "Linked accounts won't be able to enter giveaways together until you remove the restriction.", "Restrict", true],
  unrestrict: ["Remove this restriction?", "Linked accounts can enter giveaways together again.", "Remove restriction", false],
  dismiss: ["Dismiss this link?", "The pair stops appearing here and won't be flagged again.", "Dismiss", true],
} as const;

type LinkedAction = keyof typeof LINKED_ACTION_COPY;
type MemberPage = { hasMore: boolean; nextCursor: string | null };
type PageDependencies = {
  api: typeof api;
  loadBoardShell: () => Promise<BoardShellContext>;
  preserveSiteContextLinks: (siteId: string) => Promise<void>;
  confirm: (title: string, body: string, confirmText: string, danger?: boolean) => Promise<boolean>;
  prompt: (title: string, body: string, options: { confirmText: string; placeholder: string }) => Promise<string | false | null>;
  getSessionStorage: () => Storage;
  randomUUID: () => string;
  downloadCsv: (content: string, filename: string) => void;
};

const EMPTY_DEPENDENCIES: Partial<PageDependencies> = {};
const defaultDependencies: PageDependencies = {
  api,
  async loadBoardShell() {
    const shell = await import(BOARD_SHELL_MODULE) as {
      loadBoardShell: () => Promise<BoardShellContext>;
    };
    return shell.loadBoardShell();
  },
  async preserveSiteContextLinks(siteId) {
    const shell = await import(BOARD_SHELL_MODULE) as {
      preserveSiteContextLinks: (activeSiteId: string) => void;
    };
    shell.preserveSiteContextLinks(siteId);
  },
  confirm: showConfirmModal,
  prompt: showPromptModal,
  getSessionStorage: () => window.sessionStorage,
  randomUUID: () => globalThis.crypto.randomUUID(),
  downloadCsv(content, filename) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function withRateLimitCode(error: unknown): unknown {
  const record = asRecord(error);
  const body = asRecord(record?.data);
  if (body?.error === "Too many requests." && record) {
    record.code = "RATE_LIMITED";
    record.status = 429;
  }
  return error;
}

async function request<T>(
  deps: PageDependencies,
  path: string,
  siteId = "",
  options: RequestInit = {},
): Promise<T> {
  try {
    return await deps.api<T>(path, options, siteId);
  } catch (error) {
    throw withRateLimitCode(error);
  }
}

async function callApi<T>(
  client: typeof api,
  path: string,
  siteId: string,
  options: RequestInit,
): Promise<T> {
  try {
    return await client<T>(path, options, siteId);
  } catch (error) {
    throw withRateLimitCode(error);
  }
}

export async function adjustMemberCredits(
  deps: Pick<PageDependencies, "api" | "getSessionStorage" | "randomUUID">,
  activeSiteId: string,
  id: string,
  delta: number,
  reason: string,
) {
  const storageKey = "yr:credit-adjustment:" + JSON.stringify([activeSiteId, id, delta, reason]);
  const storage = deps.getSessionStorage();
  let operationId = storage.getItem(storageKey);
  if (!operationId) {
    operationId = deps.randomUUID();
    storage.setItem(storageKey, operationId);
  }
  const result = await callApi(deps.api, `/api/credits/viewers/${encodeURIComponent(id)}/balance`, activeSiteId, {
    method: "POST",
    body: JSON.stringify({ delta, reason, operationId }),
  });
  storage.removeItem(storageKey);
  return result;
}

function memberIdentity(member: Member) {
  return member.displayName || "Unnamed member";
}

function memberActivityHref(member: Member, siteId: string) {
  const name = (member.kick_username || member.discord_username || member.displayName || "").trim();
  return name && name !== "Unnamed member"
    ? `/dashboard/audience/activity?${new URLSearchParams({ siteId, viewer: name })}`
    : "";
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function relative(value?: string | null) {
  if (!value) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function getErrorMessage(error: unknown, fallback: string) {
  const record = asRecord(error);
  return typeof record?.message === "string" && record.message ? record.message : fallback;
}

function requestIsCurrent(
  siteId: string,
  ticket: number,
  activeSiteId: string,
  currentTicket: number,
) {
  const querySiteId = new URLSearchParams(window.location.search).get("siteId");
  return ticket === currentTicket && siteId === activeSiteId && (!querySiteId || querySiteId === siteId);
}

function memberCsv(rows: Member[], siteId: string, date = new Date()) {
  const header = ["name", "credits", "total_earned", "total_spent", "blocked", "last_active_at"];
  const lines = rows.map((member) => [
    memberIdentity(member),
    String(Number(member.balance) || 0),
    String(Number(member.totalEarned) || 0),
    String(Number(member.totalSpent) || 0),
    member.blocked ? "yes" : "no",
    member.lastSeenAt || member.lastCreditAt || "",
  ].map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(","));
  return {
    content: "\uFEFF" + header.join(",") + "\n" + lines.join("\n"),
    filename: `members-${siteId || "export"}-${date.toISOString().slice(0, 10)}.csv`,
  };
}

function ErrorState({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  return (
    <div className="v3-empty audience-empty" role="alert">
      <h2>{title}</h2>
      <p>{body}</p>
      <Button type="button" variant="outline" onClick={onRetry}>Try again</Button>
    </div>
  );
}

function LoadingRows({ cols, rows = 3 }: { cols: number; rows?: number }) {
  return (
    <div className="audience-loading" role="status" aria-live="polite" aria-busy="true">
      {Array.from({ length: rows }, (_, row) => (
        <div className="audience-loading-row" key={row} aria-hidden="true">
          {Array.from({ length: cols }, (_, col) => <span className="skeleton v3-skel-line" key={col} />)}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function StatusMessage({ children, error = false }: { children: string; error?: boolean }) {
  return children ? <p className={`status audience-status${error ? " error" : ""}`} role={error ? "alert" : "status"}>{children}</p> : null;
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="cr-react-head audience-page-head">
      <div><h1>{title}</h1><p className="hint">{description}</p></div>
    </header>
  );
}

export function AudiencePage({
  tab,
  dependencies = EMPTY_DEPENDENCIES,
}: {
  tab: AudienceTab;
  dependencies?: Partial<PageDependencies>;
}) {
  const deps = useMemo(() => ({ ...defaultDependencies, ...dependencies }), [dependencies]);
  const [siteId, setSiteId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [shellError, setShellError] = useState(false);
  const siteIdRef = useRef("");
  const memberSelectionRef = useRef(new MemberSelection());
  const memberRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const activityRequestRef = useRef(0);
  const reviewsRequestRef = useRef(0);
  const reviewDetailRequestRef = useRef(0);
  const linkedRequestRef = useRef(0);
  const memberQueryOpenedRef = useRef("");
  const tipCloseTimerRef = useRef<number | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [memberPage, setMemberPage] = useState<MemberPage>({ hasMore: false, nextCursor: null });
  const [memberTotal, setMemberTotal] = useState<number | null>(null);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersMoreLoading, setMembersMoreLoading] = useState(false);
  const [membersError, setMembersError] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState("");
  const [memberSort, setMemberSort] = useState("activity");
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [memberStatus, setMemberStatus] = useState("");
  const [memberStatusError, setMemberStatusError] = useState(false);

  const [memberDetail, setMemberDetail] = useState<Member | null>(null);
  const [memberDetailSiteName, setMemberDetailSiteName] = useState("");
  const [memberDetailId, setMemberDetailId] = useState("");
  const [memberDetailOpen, setMemberDetailOpen] = useState(false);
  const [memberDetailLoading, setMemberDetailLoading] = useState(false);
  const [memberDetailError, setMemberDetailError] = useState(false);
  const [memberDetailStatus, setMemberDetailStatus] = useState("");
  const [memberDetailStatusError, setMemberDetailStatusError] = useState(false);
  const [memberBlockPending, setMemberBlockPending] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipMember, setTipMember] = useState<Member | null>(null);
  const [tipAmount, setTipAmount] = useState("100");
  const [tipReason, setTipReason] = useState("");
  const [tipStatus, setTipStatus] = useState("");
  const [tipStatusError, setTipStatusError] = useState(false);
  const [tipPending, setTipPending] = useState(false);

  const [activityUsername, setActivityUsername] = useState(() => new URLSearchParams(window.location.search).get("viewer") || "");
  const [activityType, setActivityType] = useState("");
  const [appliedActivityUsername, setAppliedActivityUsername] = useState(() => new URLSearchParams(window.location.search).get("viewer") || "");
  const [appliedActivityType, setAppliedActivityType] = useState("");
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const activityEventsRef = useRef<ActivityEvent[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const activityCursorRef = useRef<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityMoreLoading, setActivityMoreLoading] = useState(false);
  const [activityError, setActivityError] = useState(false);
  const [activityStatus, setActivityStatus] = useState("");
  const [activityStatusError, setActivityStatusError] = useState(false);
  const activityStatusErrorRef = useRef(false);
  const [viewerHistory, setViewerHistory] = useState<ViewerHistoryResponse["boards"]>([]);
  const [viewerHistoryVisible, setViewerHistoryVisible] = useState(false);

  const [reviewFilter, setReviewFilter] = useState<"pending" | "resolved">("pending");
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewCounts, setReviewCounts] = useState({ pending: 0, resolved: 0 });
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState(false);
  const [reviewsStatus, setReviewsStatus] = useState("");
  const [reviewsStatusError, setReviewsStatusError] = useState(false);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewDetailLoading, setReviewDetailLoading] = useState(false);
  const [reviewDetailError, setReviewDetailError] = useState("");
  const [decisionStatus, setDecisionStatus] = useState("");
  const [decisionPending, setDecisionPending] = useState(false);

  const [linkedFilter, setLinkedFilter] = useState<"active" | "dismissed">("active");
  const [linkedGroups, setLinkedGroups] = useState<LinkedGroup[]>([]);
  const [linkedCounts, setLinkedCounts] = useState({ pending: 0, watching: 0, restricted: 0, dismissed: 0 });
  const [linkedLoading, setLinkedLoading] = useState(true);
  const [linkedError, setLinkedError] = useState(false);
  const [linkedStatus, setLinkedStatus] = useState("");
  const [linkedStatusError, setLinkedStatusError] = useState(false);
  const [linkedPending, setLinkedPending] = useState(false);

  const loadMembers = useCallback(async ({
    append = false,
    cursor = "",
  }: {
    append?: boolean;
    cursor?: string;
  } = {}) => {
    const requestedSiteId = siteIdRef.current;
    if (!requestedSiteId) {
      setMembers([]);
      setMembersLoading(false);
      return;
    }
    const ticket = ++memberRequestRef.current;
    setMembersError(false);
    if (append) setMembersMoreLoading(true);
    else setMembersLoading(true);
    const params = new URLSearchParams({ sort: memberSort });
    if (debouncedMemberSearch) params.set("q", debouncedMemberSearch);
    if (cursor) params.set("cursor", cursor);
    try {
      const data = await request<MemberPageResponse>(deps, `/api/people/members?${params}`, requestedSiteId);
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, memberRequestRef.current)) return;
      const nextMembers = data.members || [];
      memberSelectionRef.current.refresh(nextMembers);
      setMembers((current) => append ? [...current, ...nextMembers] : nextMembers);
      setMemberPage({
        hasMore: Boolean(data.page?.hasMore),
        nextCursor: data.page?.nextCursor || null,
      });
      setMemberTotal(data.total ?? null);
      setSelectionVersion((value) => value + 1);
    } catch {
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, memberRequestRef.current)) return;
      setMembersError(true);
      if (!append) setMembers([]);
    } finally {
      if (requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, memberRequestRef.current)) {
        setMembersLoading(false);
        setMembersMoreLoading(false);
      }
    }
  }, [debouncedMemberSearch, deps, memberSort]);

  const loadMemberDetail = useCallback(async (id: string) => {
    const requestedSiteId = siteIdRef.current;
    if (!requestedSiteId || !id) return;
    const ticket = ++detailRequestRef.current;
    setMemberDetailId(id);
    setMemberDetailOpen(true);
    setMemberDetailLoading(true);
    setMemberDetailError(false);
    setMemberDetailStatus("");
    try {
      const data = await request<MemberDetailResponse>(deps, `/api/people/members/${encodeURIComponent(id)}`, requestedSiteId);
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, detailRequestRef.current)) return;
      setMemberDetail(data.member);
      setMemberDetailSiteName(data.site?.name || siteName || "the selected site");
    } catch {
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, detailRequestRef.current)) return;
      setMemberDetailError(true);
    } finally {
      if (requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, detailRequestRef.current)) {
        setMemberDetailLoading(false);
      }
    }
  }, [deps, siteName]);

  const loadActivity = useCallback(async (reset: boolean) => {
    const requestedSiteId = siteIdRef.current;
    if (!requestedSiteId) {
      setActivityEvents([]);
      setActivityError(false);
      setActivityLoading(false);
      return;
    }
    const ticket = ++activityRequestRef.current;
    setActivityError(false);
    setActivityStatus("");
    if (reset) {
      setActivityLoading(true);
      setActivityEvents([]);
      activityEventsRef.current = [];
      setActivityCursor(null);
      activityCursorRef.current = null;
      setActivityStatusError(false);
      const username = appliedActivityUsername.trim();
      setViewerHistoryVisible(Boolean(username));
      setViewerHistory([]);
      activityStatusErrorRef.current = false;
      setActivityStatusError(false);
      if (username) {
        try {
          const summary = await request<ViewerHistoryResponse>(
            deps,
            `/api/credits/viewer/history?kickUsername=${encodeURIComponent(username)}`,
            requestedSiteId,
          );
          if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, activityRequestRef.current)) return;
          setViewerHistory(summary.boards || []);
        } catch {
          if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, activityRequestRef.current)) return;
          setActivityStatus("Member history could not be loaded.");
          setActivityStatusError(true);
          activityStatusErrorRef.current = true;
        }
      }
    } else {
      if (!activityCursorRef.current) return;
      setActivityMoreLoading(true);
    }
    const params = new URLSearchParams();
    const username = appliedActivityUsername.trim();
    if (username) params.set("kickUsername", username);
    if (appliedActivityType) params.set("type", appliedActivityType);
    if (!reset && activityCursorRef.current) params.set("cursor", activityCursorRef.current);
    const query = params.toString();
    const activityPath = query ? `/api/credits/activity?${query}` : "/api/credits/activity";
    try {
      const data = await request<ActivityResponse>(
        deps,
        activityPath,
        requestedSiteId,
      );
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, activityRequestRef.current)) return;
      const loadedEvents = reset
        ? data.events || []
        : [...activityEventsRef.current, ...(data.events || [])];
      activityEventsRef.current = loadedEvents;
      setActivityEvents(loadedEvents);
      activityCursorRef.current = data.nextCursor || null;
      setActivityCursor(activityCursorRef.current);
      if (!activityStatusErrorRef.current) setActivityStatus(`${loadedEvents.length} entries loaded.`);
    } catch (error) {
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, activityRequestRef.current)) return;
      setActivityError(true);
      setActivityStatus(getErrorMessage(error, "Activity for the selected site could not be loaded."));
      setActivityStatusError(true);
      activityStatusErrorRef.current = true;
    } finally {
      if (requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, activityRequestRef.current)) {
        setActivityLoading(false);
        setActivityMoreLoading(false);
      }
    }
  }, [appliedActivityType, appliedActivityUsername, deps]);

  const loadReviews = useCallback(async (filter = reviewFilter) => {
    const requestedSiteId = siteIdRef.current;
    if (!requestedSiteId) {
      setReviews([]);
      setReviewsLoading(false);
      return;
    }
    const ticket = ++reviewsRequestRef.current;
    setReviewsLoading(true);
    setReviewsError(false);
    setReviewsStatus("");
    try {
      const data = await request<ReviewsResponse>(
        deps,
        `/api/people/reviews?status=${encodeURIComponent(filter)}`,
        requestedSiteId,
      );
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, reviewsRequestRef.current)) return;
      setReviews(data.reviews || []);
      setReviewCounts({
        pending: data.counts?.pending ?? 0,
        resolved: data.counts?.resolved ?? 0,
      });
    } catch (error) {
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, reviewsRequestRef.current)) return;
      setReviewsError(true);
      setReviewsStatus(getErrorMessage(error, "Reviews could not be loaded. Try again."));
      setReviewsStatusError(true);
    } finally {
      if (requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, reviewsRequestRef.current)) {
        setReviewsLoading(false);
      }
    }
  }, [deps, reviewFilter]);

  const loadReviewDetail = useCallback(async (reviewId: string) => {
    const requestedSiteId = siteIdRef.current;
    if (!requestedSiteId) return;
    const ticket = ++reviewDetailRequestRef.current;
    setSelectedReview(null);
    setReviewDetailError("");
    setReviewDetailLoading(true);
    setReviewDialogOpen(true);
    setDecisionStatus("");
    try {
      const data = await request<{ review?: Review }>(
        deps,
        `/api/people/reviews/${encodeURIComponent(reviewId)}`,
        requestedSiteId,
      );
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, reviewDetailRequestRef.current)) return;
      setSelectedReview(data.review || null);
      if (!data.review) setReviewDetailError("Try again.");
    } catch (error) {
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, reviewDetailRequestRef.current)) return;
      setReviewDetailError(getErrorMessage(error, "Try again."));
    } finally {
      if (requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, reviewDetailRequestRef.current)) {
        setReviewDetailLoading(false);
      }
    }
  }, [deps]);

  const loadLinked = useCallback(async (filter = linkedFilter) => {
    const requestedSiteId = siteIdRef.current;
    if (!requestedSiteId) {
      setLinkedGroups([]);
      setLinkedLoading(false);
      return;
    }
    const ticket = ++linkedRequestRef.current;
    setLinkedLoading(true);
    setLinkedError(false);
    setLinkedStatus("");
    try {
      const data = await request<LinkedAccountsResponse>(
        deps,
        `/api/people/linked-accounts?status=${encodeURIComponent(filter)}`,
        requestedSiteId,
      );
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, linkedRequestRef.current)) return;
      setLinkedGroups(data.groups || []);
      setLinkedCounts({
        pending: data.counts?.pending ?? 0,
        watching: data.counts?.watching ?? 0,
        restricted: data.counts?.restricted ?? 0,
        dismissed: data.counts?.dismissed ?? 0,
      });
    } catch (error) {
      if (!requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, linkedRequestRef.current)) return;
      setLinkedError(true);
      setLinkedStatus(getErrorMessage(error, "Linked accounts could not be loaded. Try again."));
      setLinkedStatusError(true);
    } finally {
      if (requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, linkedRequestRef.current)) {
        setLinkedLoading(false);
      }
    }
  }, [deps, linkedFilter]);

  useEffect(() => {
    let current = true;
    setShellError(false);
    void deps.loadBoardShell().then(async (shell) => {
      if (!current) return;
      const requestedSiteId = new URLSearchParams(window.location.search).get("siteId") || shell.activeSiteId || "";
      if (siteIdRef.current && siteIdRef.current !== requestedSiteId) {
        memberSelectionRef.current.clear();
        setMembers([]);
        setSelectionVersion((value) => value + 1);
      }
      siteIdRef.current = requestedSiteId;
      setSiteId(requestedSiteId);
      setSiteName(shell.board?.name || "");
      await deps.preserveSiteContextLinks(requestedSiteId);
    }).catch(() => {
      if (current) setShellError(true);
    });
    return () => {
      current = false;
      memberRequestRef.current += 1;
      detailRequestRef.current += 1;
      activityRequestRef.current += 1;
      reviewsRequestRef.current += 1;
      reviewDetailRequestRef.current += 1;
      linkedRequestRef.current += 1;
      if (tipCloseTimerRef.current !== null) window.clearTimeout(tipCloseTimerRef.current);
    };
  }, [deps]);

  useEffect(() => {
    if (!siteId) return;
    if (tab === "viewers") void loadMembers();
    if (tab === "history") void loadActivity(true);
    if (tab === "reviews") void loadReviews();
    if (tab === "linked") void loadLinked();
  }, [siteId, tab, loadMembers, loadActivity, loadReviews, loadLinked]);

  useEffect(() => {
    if (tab !== "history") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("viewer")) return;
    url.searchParams.delete("viewer");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [tab]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedMemberSearch(memberSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [memberSearch]);

  useEffect(() => {
    if (tab !== "viewers" || !siteId) return;
    const memberId = new URLSearchParams(window.location.search).get("member") || "";
    if (!memberId || memberQueryOpenedRef.current === `${siteId}:${memberId}`) return;
    memberQueryOpenedRef.current = `${siteId}:${memberId}`;
    void loadMemberDetail(memberId);
  }, [siteId, tab, loadMemberDetail]);

  useEffect(() => () => {
    memberRequestRef.current += 1;
    detailRequestRef.current += 1;
    activityRequestRef.current += 1;
    reviewsRequestRef.current += 1;
    reviewDetailRequestRef.current += 1;
    linkedRequestRef.current += 1;
  }, []);

  const handleMemberSelection = useCallback((id: string, checked: boolean) => {
    const selection = memberSelectionRef.current;
    const row = members.find((member) => String(member.id) === id);
    if (checked && row) selection.add(row);
    else if (!checked) selection.delete(id);
    setSelectionVersion((value) => value + 1);
  }, [members]);

  const clearMemberSelection = useCallback(() => {
    memberSelectionRef.current.clear();
    setSelectionVersion((value) => value + 1);
  }, []);

  const exportMembers = useCallback(() => {
    const rows = exportRows(memberSelectionRef.current, members);
    if (!rows.length) {
      setMemberStatus("Nothing to export yet.");
      setMemberStatusError(true);
      return;
    }
    const output = memberCsv(rows, siteId);
    deps.downloadCsv(output.content, output.filename);
  }, [deps, members, siteId]);

  const awardMembers = useCallback(async () => {
    const amount = Math.floor(Number((document.getElementById("cr-bulk-amount") as HTMLInputElement | null)?.value));
    const reason = (document.getElementById("cr-bulk-reason") as HTMLInputElement | null)?.value.trim() || "";
    const selection = memberSelectionRef.current;
    const ids = selection.ids();
    if (!Number.isFinite(amount) || amount <= 0) {
      setMemberStatus("Enter a positive credit amount.");
      setMemberStatusError(true);
      return;
    }
    if (!reason) {
      setMemberStatus("An audit note is required for bulk credit awards.");
      setMemberStatusError(true);
      return;
    }
    if (!ids.length) return;
    if (ids.length > BULK_AWARD_MAX) {
      setMemberStatus(`Bulk award is capped at ${BULK_AWARD_MAX} members per apply.`);
      setMemberStatusError(true);
      return;
    }
    setMemberStatus(`Awarding ${amount} credits to ${ids.length} member${ids.length === 1 ? "" : "s"}…`);
    setMemberStatusError(false);
    const outcome = await runBulkAward(ids, (id: string) => adjustMemberCredits(
      deps,
      siteId,
      id,
      amount,
      reason,
    ));
    selection.retain(remainingSelection(outcome));
    setSelectionVersion((value) => value + 1);
    const complete = !outcome.failed.length && !outcome.unattempted.length;
    setMemberStatus(bulkAwardSummary(outcome, amount));
    setMemberStatusError(!complete);
    if (complete) selection.clear();
    setSelectionVersion((value) => value + 1);
    await loadMembers();
  }, [deps, loadMembers, siteId]);

  const openTip = useCallback((member: Member) => {
    setMemberDetailOpen(false);
    setTipMember(member);
    setTipAmount("100");
    setTipReason("");
    setTipStatus("");
    setTipStatusError(false);
    setTipOpen(true);
  }, []);

  const submitTip = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(tipAmount);
    const reason = tipReason.trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      setTipStatus("Please enter a positive amount of credits.");
      setTipStatusError(true);
      return;
    }
    if (!reason) {
      setTipStatus("Please provide a reason for the tip.");
      setTipStatusError(true);
      return;
    }
    if (!tipMember?.id) {
      setTipStatus("Choose an existing member before sending credits.");
      setTipStatusError(true);
      return;
    }
    setTipPending(true);
    setTipStatus("");
    const previousBalance = Number(tipMember.balance) || 0;
    setTipMember({ ...tipMember, balance: previousBalance + amount, totalEarned: (Number(tipMember.totalEarned) || 0) + amount });
    setMemberDetail((current) => current?.id === tipMember.id
      ? { ...current, balance: previousBalance + amount, totalEarned: (Number(current.totalEarned) || 0) + amount }
      : current);
    setMembers((current) => current.map((member) => member.id === tipMember.id
      ? { ...member, balance: previousBalance + amount, totalEarned: (Number(member.totalEarned) || 0) + amount }
      : member));
    try {
      await adjustMemberCredits(deps, siteId, tipMember.id, amount, reason);
      const username = memberIdentity(tipMember);
      setTipStatus(`Sent +${amount} credits to ${username || "this member"}.`);
      setTipStatusError(false);
      tipCloseTimerRef.current = window.setTimeout(() => {
        setTipOpen(false);
        setTipMember(null);
        void loadMembers();
      }, 900);
    } catch (error) {
      setTipMember((current) => current ? {
        ...current,
        balance: previousBalance,
        totalEarned: (Number(current.totalEarned) || 0) - amount,
      } : current);
      setMemberDetail((current) => current?.id === tipMember.id ? {
        ...current,
        balance: previousBalance,
        totalEarned: (Number(current.totalEarned) || 0) - amount,
      } : current);
      setMembers((current) => current.map((member) => member.id === tipMember.id ? {
        ...member,
        balance: previousBalance,
        totalEarned: (Number(member.totalEarned) || 0) - amount,
      } : member));
      setTipStatus(`${getErrorMessage(error, "Something went wrong. Try again.")} — the balance was restored.`);
      setTipStatusError(true);
    } finally {
      setTipPending(false);
    }
  }, [deps, loadMembers, siteId, tipAmount, tipMember, tipReason]);

  const toggleMemberBlock = useCallback(async (member: Member) => {
    const blocked = member.moderation?.status === "blocked" || member.blocked === true;
    const next = !blocked;
    let reason = "";
    if (next) {
      reason = await deps.prompt("Block member", "Why are you blocking this member?", {
        confirmText: "Block",
        placeholder: "e.g. chargeback / abuse",
      }) || "";
      if (!reason) return;
    }
    setMemberBlockPending(true);
    try {
      await request(deps, "/api/credits/viewers/" + encodeURIComponent(member.id) + "/block", siteId, {
        method: "POST",
        body: JSON.stringify({ blocked: next, reason }),
      });
      setMemberStatus("");
      await loadMembers();
      if (memberDetailId === member.id) await loadMemberDetail(member.id);
    } catch (error) {
      setMemberDetailStatus(getErrorMessage(error, "Could not update this member."));
      setMemberDetailStatusError(true);
    } finally {
      setMemberBlockPending(false);
    }
  }, [deps, loadMemberDetail, loadMembers, memberDetailId, siteId]);

  const decideReview = useCallback(async (decision: "allow" | "exclude") => {
    if (decisionPending || !selectedReview || selectedReview.status !== "pending") return;
    const allow = decision === "allow";
    setDecisionPending(true);
    setDecisionStatus("");
    try {
      const confirmed = await deps.confirm(
        allow ? "Allow this signup?" : "Exclude this signup?",
        allow
          ? "This allows only this participant signup in the named tournament."
          : "This excludes only this participant signup from the named tournament.",
        allow ? "Allow signup" : "Exclude signup",
        !allow,
      );
      if (!confirmed) return;
      await request(deps, "/api/people/reviews/" + encodeURIComponent(selectedReview.id) + "/decision", siteId, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      setReviewDialogOpen(false);
      await loadReviews();
      setReviewsStatus(allow ? "Signup allowed for this tournament." : "Signup excluded from this tournament.");
      setReviewsStatusError(false);
    } catch (error) {
      const message = getErrorMessage(error, "The decision could not be saved.");
      setDecisionStatus(message);
      setReviewsStatus(message);
      setReviewsStatusError(true);
    } finally {
      setDecisionPending(false);
    }
  }, [decisionPending, deps, loadReviews, selectedReview, siteId]);

  const decideLinked = useCallback(async (group: LinkedGroup, action: LinkedAction) => {
    if (linkedPending) return;
    const [title, body, confirmText, danger] = LINKED_ACTION_COPY[action];
    setLinkedPending(true);
    setLinkedStatus("");
    setLinkedStatusError(false);
    try {
      if (!await deps.confirm(title, body, confirmText, danger)) return;
      const data = await request<LinkedAccountsResponse>(deps, "/api/people/linked-accounts/decision", siteId, {
        method: "POST",
        body: JSON.stringify({ linkIds: group.linkIds, action }),
      });
      setLinkedGroups(data.groups || []);
      setLinkedCounts({
        pending: data.counts?.pending ?? 0,
        watching: data.counts?.watching ?? 0,
        restricted: data.counts?.restricted ?? 0,
        dismissed: data.counts?.dismissed ?? 0,
      });
      setLinkedStatus("Saved.");
    } catch (error) {
      setLinkedStatus(getErrorMessage(error, "The linked-account action could not be saved."));
      setLinkedStatusError(true);
    } finally {
      setLinkedPending(false);
    }
  }, [deps, linkedPending, siteId]);

  const selection = memberSelectionRef.current;
  const selectedOnPage = members.filter((member) => selection.has(member.id)).length;
  const selectAllState = selectedOnPage === 0
    ? false
    : selectedOnPage === members.length ? true : "indeterminate";
  const allowedReviewActions = selectedReview
    ? selectedReview.allowedDecisions || ["allow", "exclude"]
    : [];

  if (shellError) {
    const message = tab === "viewers" ? "People for the selected site could not be loaded." : "This Audience page could not be loaded.";
    return <div className="yr-react audience-react"><ErrorState title="Couldn't load this page" body={message} onRetry={() => window.location.reload()} /></div>;
  }

  if (tab === "viewers") {
    return (
      <div className="yr-react audience-react" data-audience-tab={tab}>
        <PageHeader title="Members" description="People who have joined this site or completed a supported community action." />
        <section className="cr-table-card cr-member-list audience-members" id="cr-viewers" aria-label="Members in this site">
          <div className="cr-table-card__head audience-members-head">
            <div><h2>Members in this site</h2><p className="hint">Membership and Credits activity for the selected site.</p></div>
            <div className="cr-list-toolbar" id="cr-viewer-toolbar">
              <Input
                className="list-search"
                type="search"
                placeholder="Search members…"
                aria-label="Search members"
                value={memberSearch}
                onChange={(event) => setMemberSearch(event.currentTarget.value)}
              />
              <Select value={memberSort} onValueChange={setMemberSort}>
                <SelectTrigger className="list-sort audience-select" aria-label="Sort members"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="activity">Recently active</SelectItem>
                  <SelectItem value="balance">Credit balance</SelectItem>
                  <SelectItem value="status">Blocked first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="cr-member-bulk-bar audience-bulk-bar" id="cr-member-bulk-bar" hidden={!selection.size} data-selection-version={selectionVersion}>
            <span id="cr-bulk-count">{selection.size} selected{selection.size > BULK_AWARD_MAX ? ` — bulk award is capped at ${BULK_AWARD_MAX} per apply` : ""}</span>
            <div className="cr-member-bulk-controls">
              <Label className="audience-bulk-field" htmlFor="cr-bulk-amount">Credits</Label>
              <Input id="cr-bulk-amount" type="number" min="1" step="1" defaultValue="100" aria-label="Credits per member" />
              <Label className="audience-bulk-field" htmlFor="cr-bulk-reason">Audit note</Label>
              <Input id="cr-bulk-reason" type="text" maxLength={500} placeholder="Why are you awarding these credits?" aria-label="Audit note for bulk credit award" />
              <Button id="cr-bulk-award" type="button" disabled={!selection.size || selection.size > BULK_AWARD_MAX} onClick={() => void awardMembers()}>Award credits</Button>
              <Button id="cr-bulk-export" type="button" variant="outline" onClick={exportMembers}>Export CSV</Button>
              <Button id="cr-bulk-clear" type="button" variant="ghost" onClick={clearMemberSelection}>Clear selection</Button>
            </div>
          </div>
          <StatusMessage error={memberStatusError}>{memberStatus}</StatusMessage>
          {membersLoading && !members.length
            ? <LoadingRows cols={5} />
            : membersError
              ? <ErrorState title="Couldn't load members" body="People for the selected site could not be loaded." onRetry={() => void loadMembers()} />
              : members.length === 0
                ? <div className="v3-empty audience-empty" id="cr-viewer-empty">
                    <h2>{debouncedMemberSearch ? "No matching members" : "No members yet"}</h2>
                    <p>{debouncedMemberSearch
                      ? "No member name matches this search on the selected site."
                      : "People become members when they choose to join this community or complete a supported community action."}</p>
                    {!debouncedMemberSearch && <a className="v3-btn v3-btn--accent v3-btn--sm" href="/dashboard/leaderboard/share">Share your site</a>}
                  </div>
                : (
                  <>
                    <div className="cr-table-scroll">
                      <table className="cr-table audience-member-table">
                        <thead><tr>
                          <th className="cr-member-select-col"><Checkbox id="cr-member-select-all" checked={selectAllState} aria-label="Select all members on this page" onCheckedChange={(checked) => members.forEach((member) => handleMemberSelection(member.id, checked === true))} /></th>
                          <th>Member</th><th>Membership</th><th>Account connection</th><th>Credits</th><th className="ta-r">Actions</th>
                        </tr></thead>
                        <tbody id="cr-viewer-list">
                          {members.map((member) => {
                            const name = memberIdentity(member);
                            const lastActive = member.lastSeenAt || member.lastCreditAt;
                            return (
                              <tr key={member.id}>
                                <td className="cr-member-select-col" data-label="Select">
                                  <Checkbox
                                    data-member-select={member.id}
                                    checked={selection.has(member.id)}
                                    aria-label={`Select ${name}`}
                                    onCheckedChange={(checked) => handleMemberSelection(member.id, checked === true)}
                                  />
                                </td>
                                <td data-label="Member"><div className="cr-viewer-identity">
                                  {member.avatarUrl
                                    ? <img className="cr-viewer-avatar" src={member.avatarUrl} alt="" loading="lazy" />
                                    : <span className="cr-viewer-avatar cr-viewer-avatar--fallback" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
                                  <span className="cr-member-name"><b>{name}</b>{member.blocked && <span className="v3-chip v3-chip--cancelled">Blocked on this site</span>}</span>
                                </div></td>
                                <td data-label="Membership"><div className="cr-member-activity">{lastActive
                                  ? <b title={`Last active: ${formatDate(lastActive)}`}>Active {relative(lastActive)}</b>
                                  : <b>No activity yet</b>}</div></td>
                                <td data-label="Account connection"><div className="cr-member-platforms">{member.linkedIdentities?.length
                                  ? member.linkedIdentities.map((identity, index) => <span key={`${identity.provider}-${index}`}>{identity.provider} sign-in</span>)
                                  : <span>No signed-in account</span>}</div></td>
                                <td data-label="Credits"><div className="cr-member-credits"><b>{Number(member.balance) || 0} Credits</b><span>Earned {Number(member.totalEarned) || 0} · Spent {Number(member.totalSpent) || 0}</span></div></td>
                                <td data-label="Actions" className="ta-r cr-member-actions"><Button
                                  className="btn btn--sm"
                                  type="button"
                                  variant="outline"
                                  data-member-detail={member.id}
                                  aria-controls="audience-member-drawer"
                                  aria-expanded={memberDetailOpen && memberDetailId === member.id}
                                  onClick={() => void loadMemberDetail(member.id)}
                                >View member</Button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <footer className="cr-list-foot audience-list-foot" id="cr-viewer-foot">
                      <span className="list-page-info">Showing {members.length}{memberTotal !== null ? ` of ${memberTotal}` : memberPage.hasMore ? "" : ""} members{memberPage.hasMore && memberTotal === null ? " · more available" : ""}</span>
                      {memberPage.hasMore && <Button type="button" variant="outline" size="sm" disabled={membersMoreLoading} onClick={() => void loadMembers({ append: true, cursor: memberPage.nextCursor || "" })}>{membersMoreLoading ? "Loading…" : "Load more"}</Button>}
                    </footer>
                  </>
                )}
        </section>
        <aside className="cr-audience-note audience-note">
          <div><h2>Looking for visitor trends?</h2><p>Anonymous visits and traffic sources live in Insights.</p></div>
          <a className="btn btn--sm" href="/dashboard/analytics">Open Insights</a>
        </aside>

        <Dialog open={memberDetailOpen} onOpenChange={setMemberDetailOpen}>
          <DialogContent id="audience-member-drawer" className="audience-drawer" aria-modal="true" showCloseButton={false}>
            <DialogHeader className="audience-drawer-header">
              <DialogTitle id="cr-member-history-title">{memberDetail ? memberIdentity(memberDetail) : "Member details"}</DialogTitle>
              <DialogDescription>{`Member in ${memberDetailSiteName || siteName || "the selected site"}`}</DialogDescription>
              <Button id="cr-member-history-close" className="audience-dialog-close" type="button" variant="ghost" aria-label="Close member details" onClick={() => setMemberDetailOpen(false)}>Close</Button>
            </DialogHeader>
            {memberDetailLoading
              ? <LoadingRows cols={2} rows={4} />
              : memberDetailError
                ? <ErrorState title="Couldn't load this member" body="Their site-specific details could not be loaded." onRetry={() => void loadMemberDetail(memberDetailId)} />
                : memberDetail && (
                  <div className="audience-drawer-body">
                    <section className="cr-member-history-identity">
                      <div className="cr-member-history-avatar" aria-hidden="true">{memberDetail.avatarUrl
                        ? <img className="cr-member-detail-avatar-image" src={memberDetail.avatarUrl} alt="" />
                        : memberIdentity(memberDetail).slice(0, 1).toUpperCase()}</div>
                      <div><h3 id="cr-member-identity-heading">{memberIdentity(memberDetail)}</h3><p>{memberDetail.linkedIdentities?.length ? "Signed-in viewer account" : "Site activity membership"}</p></div>
                    </section>
                    <dl className="audience-member-facts">
                      <div><dt>Last active</dt><dd>{memberDetail.lastSeenAt || memberDetail.lastCreditAt ? formatDate(memberDetail.lastSeenAt || memberDetail.lastCreditAt) : "No activity yet"}</dd></div>
                      <div><dt>Balance</dt><dd>{Number(memberDetail.balance) || 0} Credits</dd></div>
                      <div><dt>Earned</dt><dd>{Number(memberDetail.totalEarned) || 0}</dd></div>
                      <div><dt>Spent</dt><dd>{Number(memberDetail.totalSpent) || 0}</dd></div>
                    </dl>
                    <section className="audience-member-section">
                      <h3>Account connection</h3>
                      <div className="cr-member-history-connections">{memberDetail.linkedIdentities?.length
                        ? memberDetail.linkedIdentities.map((identity, index) => <span className="v3-chip v3-chip--fulfilled" key={`${identity.provider}-${index}`}>{identity.provider} sign-in verified</span>)
                        : <span className="v3-chip">No signed-in account connection</span>}</div>
                      <p className="hint">{memberDetail.linkedIdentities?.length
                        ? "These connections come from completed provider sign-in. Other records are not matched by name."
                        : "This membership comes from site activity. No leaderboard player or subscriber record is assumed to be this person."}</p>
                    </section>
                    <section className="audience-member-section">
                      <h3>Site status</h3>
                      <p><strong>{memberDetail.moderation?.status === "blocked" || memberDetail.blocked ? "Blocked on this site" : "Active on this site"}</strong></p>
                      <p className="hint">{memberDetail.moderation?.status === "blocked" || memberDetail.blocked
                        ? memberDetail.moderation?.reason || "No reason recorded."
                        : "No restrictions on this site."}</p>
                      <StatusMessage error={memberDetailStatusError}>{memberDetailStatus}</StatusMessage>
                      <Button
                        className="btn btn--sm"
                        type="button"
                        variant={memberDetail.moderation?.status === "blocked" || memberDetail.blocked ? "outline" : "destructive"}
                        disabled={memberBlockPending}
                        data-block={memberDetail.id}
                        data-blocked={memberDetail.moderation?.status === "blocked" || memberDetail.blocked ? "1" : ""}
                        onClick={() => void toggleMemberBlock(memberDetail)}
                      >{memberBlockPending ? "Saving…" : memberDetail.moderation?.status === "blocked" || memberDetail.blocked ? "Unblock member" : "Block member"}</Button>
                    </section>
                    <section className="audience-member-section">
                      <div className="audience-member-section-head"><h3>Credit activity</h3>{memberActivityHref(memberDetail, siteId) && <a className="btn btn--sm" id="cr-member-history-activity-all" href={memberActivityHref(memberDetail, siteId)}>View all activity</a>}</div>
                      {memberDetail.recentCreditActivity?.length
                        ? <ul className="cr-member-history-list">{memberDetail.recentCreditActivity.map((event, index) => <MemberEvent event={event} key={event.id || index} />)}</ul>
                        : <div className="v3-empty audience-empty"><h3>No credit activity yet</h3><p>This member has not earned or spent Credits on this site.</p></div>}
                    </section>
                    <DialogFooter className="audience-drawer-footer">
                      <Button id="cr-member-history-tip" type="button" onClick={() => openTip(memberDetail)}>Send credits</Button>
                    </DialogFooter>
                  </div>
                )}
          </DialogContent>
        </Dialog>

        <Dialog open={tipOpen} onOpenChange={setTipOpen}>
          <DialogContent id="cr-tip-drawer" className="audience-drawer audience-tip-drawer" aria-modal="true">
            <DialogHeader>
              <DialogTitle>Send Credits</DialogTitle>
              <DialogDescription>Send credits to an existing member on this site.</DialogDescription>
            </DialogHeader>
            <form id="cr-tip-form" className="audience-tip-form" onSubmit={(event) => void submitTip(event)}>
              <input id="cr-tip-viewer-id" type="hidden" value={tipMember?.id || ""} readOnly />
              <div className="audience-field"><Label htmlFor="cr-tip-username">Member</Label><Input id="cr-tip-username" name="username" type="text" readOnly value={tipMember ? memberIdentity(tipMember) : ""} /></div>
              <div className="audience-field"><Label htmlFor="cr-tip-amount">Credits</Label><Input id="cr-tip-amount" name="amount" type="number" min="1" step="1" value={tipAmount} onChange={(event) => setTipAmount(event.currentTarget.value)} /></div>
              <div className="audience-tip-presets">{[100, 250, 500].map((amount) => <Button className="cr-tip-preset" key={amount} type="button" variant="outline" data-amount={amount} onClick={() => setTipAmount(String(amount))}>+{amount}</Button>)}</div>
              <div className="audience-field"><Label htmlFor="cr-tip-reason">Reason</Label><Input id="cr-tip-reason" name="reason" type="text" maxLength={500} value={tipReason} onChange={(event) => setTipReason(event.currentTarget.value)} /></div>
              <StatusMessage error={tipStatusError}>{tipStatus}</StatusMessage>
              <DialogFooter><Button id="cr-tip-cancel" type="button" variant="outline" onClick={() => setTipOpen(false)}>Cancel</Button><Button id="cr-tip-submit" type="submit" disabled={tipPending}>{tipPending ? "Sending…" : "Send credits"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (tab === "history") {
    return (
      <div className="yr-react audience-react" data-audience-tab={tab}>
        <PageHeader title="Activity" description="Credit activity for the selected site. Filter by member and activity type." />
        <section className="cr-table-card audience-activity">
          <form className="audience-activity-filters" onSubmit={(event) => {
            event.preventDefault();
            const username = activityUsername.trim();
            if (username === appliedActivityUsername && activityType === appliedActivityType) {
              void loadActivity(true);
            } else {
              setAppliedActivityUsername(username);
              setAppliedActivityType(activityType);
            }
          }}>
            <div className="audience-field"><Label htmlFor="cr-history-username">Member username</Label><Input id="cr-history-username" name="username" type="text" value={activityUsername} onChange={(event) => setActivityUsername(event.currentTarget.value)} placeholder="Kick or Discord username" /></div>
            <div className="audience-field"><Label htmlFor="cr-history-type">Activity type</Label><Select value={activityType || "all"} onValueChange={(value) => setActivityType(value === "all" ? "" : value)}>
              <SelectTrigger id="cr-history-type" className="audience-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All activity</SelectItem>
                {Object.entries(LEDGER_EVENT_LABELS).map(([value, label]) => <SelectItem value={value} key={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select></div>
            <Button id="cr-history-search" type="submit" disabled={activityLoading}>{activityLoading ? "Loading…" : "Apply filters"}</Button>
          </form>
          {viewerHistoryVisible && <section className="cr-table-card audience-history-summary" id="cr-history-summary">
            <h2>Member activity across sites</h2>
            {viewerHistory?.length
              ? <div className="cr-table-scroll"><table className="cr-table"><thead><tr><th>Site</th><th>Balance</th><th>Earned</th><th>Spent</th><th>Pending</th><th>Claims</th><th className="ta-r">Actions</th></tr></thead>
                  <tbody id="cr-history-list">{viewerHistory.map((board) => <tr key={board.siteId}><td data-label="Site"><b>{board.name || board.slug}</b><br /><span className="hint">{board.slug}</span></td><td data-label="Balance" className="num">{board.balance}</td><td data-label="Earned" className="num">{board.totalEarned}</td><td data-label="Spent" className="num">{board.totalSpent}</td><td data-label="Pending" className="num">{board.redemptionsPending}</td><td data-label="Claims" className="num">{board.redemptionsTotal}</td><td data-label="Actions" className="ta-r"><a className="btn btn--sm" href={`/dashboard/site/connections?siteId=${encodeURIComponent(board.siteId)}`}>Connect Kick</a></td></tr>)}</tbody>
                </table></div>
              : <div className="v3-empty audience-empty" id="cr-history-empty"><h3>No sites found</h3><p>This member has no activity on your sites.</p></div>}
          </section>}
          <StatusMessage error={activityStatusError}>{activityStatus}</StatusMessage>
          {activityLoading
            ? <LoadingRows cols={5} />
            : activityError
              ? <ErrorState title="Couldn't load activity" body={activityStatus || "Activity for the selected site could not be loaded."} onRetry={() => void loadActivity(true)} />
              : activityEvents.length === 0
                ? <div className="v3-empty audience-empty" id="cr-history-feed-empty">
                    <h2>No credit activity found</h2>
                    <p>{appliedActivityUsername.trim()
                      ? "This member has not earned or spent credits yet. Try another member or activity type."
                      : "No credit activity matches the current filters. Try another member or activity type."}</p>
                  </div>
                : <div className="cr-table-scroll"><table className="cr-table audience-activity-table" aria-busy={activityMoreLoading}>
                    <thead><tr><th>When</th><th>Member</th><th>Activity</th><th>Change</th><th>Details</th></tr></thead>
                    <tbody id="cr-history-feed-list">{activityEvents.map((event, index) => {
                      const debit = event.direction === "debit";
                      const memberName = event.kickUsername || event.discordUsername || event.kickUserId || event.discordUserId || "Unknown member";
                      return <tr key={event.id || `${event.createdAt}-${index}`}><td data-label="When" title={formatDate(event.createdAt)}>{relative(event.createdAt)}</td><td data-label="Member">{memberName}</td><td data-label="Activity">{LEDGER_EVENT_LABELS[event.type] || event.type}</td><td data-label="Change" className={`num ${debit ? "cr-negative" : "cr-positive"}`}>{debit ? "−" : "+"}{event.amount}</td><td data-label="Details">{event.description || "—"}</td></tr>;
                    })}</tbody>
                  </table></div>}
          <footer className="cr-list-foot audience-list-foot">
            {activityCursor && <Button id="cr-history-load-more" type="button" variant="outline" disabled={activityMoreLoading} onClick={() => void loadActivity(false)}>{activityMoreLoading ? "Loading…" : "Show more"}</Button>}
          </footer>
        </section>
      </div>
    );
  }

  if (tab === "reviews") {
    return (
      <div className="yr-react audience-react" data-audience-tab={tab}>
        <PageHeader title="Reviews" description="Human decisions needed for your community." />
        <section className="people-reviews" aria-label="Audience reviews">
          <div className="people-reviews__head">
            <div className="people-review-count"><strong id="people-reviews-pending-count">{reviewCounts.pending}</strong><span>needs review</span></div>
            <div className="people-review-filters" role="group" aria-label="Review status">
              <Button type="button" variant={reviewFilter === "pending" ? "default" : "outline"} className={reviewFilter === "pending" ? "is-active" : ""} aria-pressed={reviewFilter === "pending"} onClick={() => setReviewFilter("pending")}>Needs review</Button>
              <Button type="button" variant={reviewFilter === "resolved" ? "default" : "outline"} className={reviewFilter === "resolved" ? "is-active" : ""} aria-pressed={reviewFilter === "resolved"} onClick={() => setReviewFilter("resolved")}>Resolved</Button>
            </div>
          </div>
          <div className={`people-review-queue${reviewsLoading ? " is-loading" : ""}`} aria-busy={reviewsLoading}>
            <div className="people-review-toolbar"><div><h2>{reviewFilter === "pending" ? "Needs review" : "Resolved reviews"}</h2><p>{reviewFilter === "pending" ? "Review the context before allowing or excluding a signup." : "Decisions made for this site."}</p></div></div>
            <div className="people-review-feedback" aria-live="polite"><StatusMessage error={reviewsStatusError}>{reviewsStatus}</StatusMessage>{reviewsError && <Button type="button" variant="outline" id="people-reviews-retry" onClick={() => void loadReviews()}>Try again</Button>}</div>
            {reviewsLoading
              ? <div id="people-reviews-loading" className="people-review-loading"><LoadingRows cols={5} /></div>
              : reviewsError
                ? <div className="people-review-empty"><h3>Couldn't load reviews</h3><p>{reviewsStatus || "Reviews could not be loaded. Try again."}</p></div>
                : reviews.length
                  ? <div className="people-review-table-wrap" id="people-reviews-table-wrap"><table className="people-review-table">
                      <thead><tr><th>Participant</th><th>Review reason</th><th>Signup</th><th>Status</th><th className="ta-r">Actions</th></tr></thead>
                      <tbody id="people-reviews-list">{reviews.map((review) => <tr key={review.id}>
                        <td data-label="Participant"><strong>{review.subject.displayName}</strong>{review.subject.memberDisplayName && <span className="people-review-secondary">{review.subject.memberDisplayName}</span>}</td>
                        <td data-label="Review reason"><strong>{review.reason.label}</strong><span className="people-review-secondary">{review.typeLabel || review.source.workflow}</span></td>
                        <td data-label="Signup"><strong>{review.source.title}</strong><time dateTime={review.createdAt} title={formatDate(review.createdAt)}>{relative(review.createdAt)}</time></td>
                        <td data-label="Status"><span className={`v3-chip ${review.status === "pending" ? "v3-chip--pending" : "v3-chip--fulfilled"}`}>{review.statusLabel || (review.status === "pending" ? "Needs review" : review.decision === "allow" ? "Allowed" : "Excluded")}</span></td>
                        <td data-label="Actions" className="ta-r"><Button className="btn btn--sm" type="button" variant="outline" data-open-review={review.id} aria-controls="people-review-drawer" aria-expanded={reviewDialogOpen && selectedReview?.id === review.id} onClick={() => void loadReviewDetail(review.id)}>View review</Button></td>
                      </tr>)}</tbody>
                    </table></div>
                  : <div className="people-review-empty" id="people-reviews-empty"><h3>{reviewFilter === "pending" ? "No reviews need your attention." : "No resolved reviews yet."}</h3><p>{reviewFilter === "pending" ? "New eligibility exceptions for this site will appear here." : "Decisions made for this site will appear here."}</p></div>}
          </div>
        </section>
        <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
          <DialogContent id="people-review-drawer" className="people-review-drawer" aria-modal="true" showCloseButton={false}>
            <DialogHeader className="people-review-drawer__head">
              <span className="people-review-eyebrow">Signup review</span>
              <DialogTitle id="people-review-title">{selectedReview?.subject.displayName || "Review details"}</DialogTitle>
              <DialogDescription id="people-review-description">{selectedReview ? `${selectedReview.source.title} · ${formatDate(selectedReview.createdAt)}` : "Review the signup context before deciding."}</DialogDescription>
              <Button className="people-review-close" type="button" variant="ghost" aria-label="Close review details" onClick={() => setReviewDialogOpen(false)}>Close</Button>
            </DialogHeader>
            <div id="people-review-detail" className="people-review-drawer__body">
              {reviewDetailLoading
                ? <div className="people-review-detail-loading" role="status"><span className="ui-loading__spinner" aria-hidden="true" />Loading review…</div>
                : reviewDetailError
                  ? <div className="v3-empty"><h3>Couldn't load this review</h3><p>{reviewDetailError}</p></div>
                  : selectedReview && <ReviewDetail review={selectedReview} siteId={siteId} />}
            </div>
            <div className="people-review-actions" id="people-review-actions" aria-busy={decisionPending}>
              <StatusMessage error={reviewsStatusError}>{decisionStatus}</StatusMessage>
              <div>
                <Button id="people-review-allow" type="button" hidden={!selectedReview || selectedReview.status !== "pending" || allowedReviewActions.length === 0 || !allowedReviewActions.includes("allow")} disabled={decisionPending} onClick={() => void decideReview("allow")}>{decisionPending ? "Saving…" : "Allow signup"}</Button>
                <Button id="people-review-exclude" type="button" variant="destructive" hidden={!selectedReview || selectedReview.status !== "pending" || allowedReviewActions.length === 0 || !allowedReviewActions.includes("exclude")} disabled={decisionPending} onClick={() => void decideReview("exclude")}>{decisionPending ? "Saving…" : "Exclude signup"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="yr-react audience-react" data-audience-tab="linked">
      <PageHeader title="Linked accounts" description="Review account links and decide how they should be handled on this site." />
      <section className="people-linked">
        <div className="people-linked-header">
          <div><h2>Account links</h2><p className="hint">Signals help prioritize review; they do not prove identity.</p></div>
          <div className="people-review-filters" role="group" aria-label="Linked account status">
            <Button type="button" variant={linkedFilter === "active" ? "default" : "outline"} aria-pressed={linkedFilter === "active"} onClick={() => setLinkedFilter("active")}>Active <span className="people-linked-filter-count">{linkedCounts.pending}</span></Button>
            <Button type="button" variant={linkedFilter === "dismissed" ? "default" : "outline"} aria-pressed={linkedFilter === "dismissed"} onClick={() => setLinkedFilter("dismissed")}>Dismissed <span className="people-linked-filter-count">{linkedCounts.dismissed}</span></Button>
          </div>
        </div>
        <div className="people-linked-content" aria-busy={linkedLoading}>
          <StatusMessage error={linkedStatusError}>{linkedStatus}</StatusMessage>
          {linkedLoading
            ? <LoadingRows cols={3} rows={3} />
            : linkedError
              ? <ErrorState title="Couldn't load linked accounts" body={linkedStatus || "Linked accounts could not be loaded. Try again."} onRetry={() => void loadLinked()} />
              : linkedGroups.length
                ? <div className="people-linked-groups">{linkedGroups.map((group) => <LinkedGroupCard
                    group={group}
                    key={group.id}
                    pending={linkedPending}
                    onAction={(action) => void decideLinked(group, action)}
                  />)}</div>
                : <div className="people-review-empty"><h3>{linkedFilter === "dismissed" ? "No dismissed account links." : "No linked accounts need attention."}</h3><p>{linkedFilter === "dismissed" ? "Dismissed signals for this site will appear here." : "New account-link signals for this site will appear here."}</p></div>}
        </div>
      </section>
    </div>
  );
}

function MemberEvent({ event }: { event: MemberCreditEvent }) {
  const debit = event.direction === "debit";
  return <li>
    <div><strong>{LEDGER_EVENT_LABELS[event.type] || event.type}</strong><span>{event.description || "No details"}</span></div>
    <div className="cr-member-history-event-meta"><b className={debit ? "cr-negative" : "cr-positive"}>{debit ? "−" : "+"}{event.amount}</b><time dateTime={event.createdAt} title={formatDate(event.createdAt)}>{relative(event.createdAt)}</time></div>
  </li>;
}

function ReviewDetail({ review, siteId }: { review: Review; siteId: string }) {
  const membership = review.context?.membership;
  const memberHref = membership
    ? `/dashboard/audience/members?siteId=${encodeURIComponent(siteId)}&member=${encodeURIComponent(membership.id)}`
    : "";
  const identities = membership?.linkedIdentities?.length
    ? membership.linkedIdentities.map((identity, index) => <li key={`${identity.provider}-${index}`}>{identity.provider}{identity.displayName ? ` · ${identity.displayName}` : ""}</li>)
    : <li>No linked sign-in providers</li>;
  return <>
    <section className="people-review-section"><div className="people-review-reason"><span aria-hidden="true">!</span><div><h3>{review.reason.label}</h3><p>{review.reason.explanation}</p></div></div></section>
    <section className="people-review-section"><h3>Signup context</h3><dl className="people-review-facts"><div><dt>Workflow</dt><dd>{review.source.workflow}</dd></div><div><dt>Tournament</dt><dd>{review.source.title}</dd></div><div><dt>Entry</dt><dd>Zero cost</dd></div><div><dt>Submitted</dt><dd>{formatDate(review.createdAt)}</dd></div></dl></section>
    <section className="people-review-section"><div className="people-review-section__head"><h3>Site membership</h3>{memberHref ? <a className="btn btn--sm" href={memberHref}>View member</a> : <span className="people-review-muted">No signed-in site membership is linked to this signup.</span>}</div>{membership && <ul className="people-review-identities">{identities}</ul>}</section>
    {review.context?.guidance && <aside className="people-review-guidance"><strong>Use context, not assumptions.</strong><p>{review.context.guidance}</p></aside>}
    <section className="people-review-section"><h3>History</h3><ol className="people-review-history">{(review.history || []).map((event, index) => <li key={`${event.createdAt}-${index}`}><span className="people-review-history-dot" aria-hidden="true" /><div><strong>{event.label}</strong><p>{event.actor ? `By ${event.actor.name || "Unknown"}` : "System event"}</p><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></div></li>)}</ol></section>
  </>;
}

function LinkedGroupCard({
  group,
  pending,
  onAction,
}: {
  group: LinkedGroup;
  pending: boolean;
  onAction: (action: LinkedAction) => void;
}) {
  const actions: LinkedAction[] = group.status === "dismissed"
    ? []
    : group.status === "restricted"
      ? ["unrestrict", "dismiss"]
      : ["watch", "restrict", "dismiss"];
  const statusLabel = group.status === "pending" ? "New" : group.status === "watching" ? "Watching" : group.status === "restricted" ? "Restricted" : "Dismissed";
  return <article className="people-linked-group">
    <div className="people-linked-group__head">
      <div className="people-linked-accounts">{group.accounts.map((account, index) => <span className="people-linked-account" key={`${account.displayName}-${index}`}>{account.displayName}</span>)}</div>
      <div className="people-linked-meta"><span className={`people-linked-pill people-linked-pill--${group.status}`}>{statusLabel}</span><span className="people-linked-confidence">{group.confidence}% Likely linked</span></div>
    </div>
    <p className="people-linked-summary">{group.summary}</p>
    {group.firstDetectedAt && <p className="people-linked-detected">First detected {relative(group.firstDetectedAt)}</p>}
    {actions.length > 0 && <div className="people-linked-actions">{actions.map((action) => <Button
      className="btn btn--sm"
      key={action}
      type="button"
      variant={action === "restrict" || action === "dismiss" ? "destructive" : "outline"}
      data-linked-action={action}
      disabled={pending}
      onClick={() => onAction(action)}
    >{action === "unrestrict" ? "Remove restriction" : action === "watch" ? "Watch" : action === "restrict" ? "Restrict" : "Dismiss"}</Button>)}</div>}
  </article>;
}

export { BULK_AWARD_MAX, memberCsv };
