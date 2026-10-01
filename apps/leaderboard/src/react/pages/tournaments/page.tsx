import * as React from "react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarDays,
  ChevronDown,
  Crown,
  Gamepad2,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import { connectKickChat } from "../../../assets/chat-entry.js";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Bracket } from "./bracket";
import type {
  BoardShell,
  ChatConnectionHandle,
  ChatConnectionOptions,
  ChatRegistration,
  ChatroomLookupResponse,
  EntryCounts,
  SettingsFix,
  SettingsRequestBody,
  Tournament,
  TournamentActionResponse,
  TournamentApiErrorData,
  TournamentBracketResponse,
  TournamentCreateResponse,
  TournamentDeleteResponse,
  TournamentEntriesResponse,
  TournamentEntry,
  TournamentEntryAction,
  TournamentListResponse,
  TournamentListItem,
  TournamentMatch,
  TournamentSettingsResponse,
  TournamentState,
} from "./types";

type SettingsDraft = {
  title: string;
  gameName: string;
  bracketSize: string;
  chatChannel: string;
  keyword: string;
  capMode: string;
  cap: string;
  waitlist: boolean;
};
type FieldError = { message: string; fix?: SettingsFix };
type PageDependencies = {
  api: typeof api;
  loadBoardShell: () => Promise<BoardShell>;
  connectKickChat: (options: ChatConnectionOptions) => ChatConnectionHandle;
  fetch: typeof fetch;
};
type PageActions = {
  loadTournament: (preferredId?: string, scopedSiteId?: string) => Promise<void>;
  startChat: () => Promise<void>;
  openCreate: () => void;
};

const BOARD_SHELL_MODULE = "/assets/dashboard/board-shell.js";
const EMPTY_COUNTS: EntryCounts = { active: 0, eligible: 0, waitlist: 0, removed: 0, blocked: 0, inactive: 0 };
const BRACKET_SIZES = [4, 8, 16, 32];
const SOURCE_LABELS: Record<string, string> = { manual: "Manual", chat: "Chat", viewer: "Viewer", page: "Signup page" };
const LINKED_REASON_LABELS: Record<string, string> = {
  same_device: "same device",
  same_payment: "same payment method",
  linked_account: "linked account",
};
const DEFAULT_DEPENDENCIES: PageDependencies = {
  api,
  loadBoardShell: async () => {
    const shell = await import(BOARD_SHELL_MODULE) as { loadBoardShell: () => Promise<BoardShell> };
    return shell.loadBoardShell();
  },
  connectKickChat: (options) => connectKickChat({
    ...options,
    onOpen: options.onOpen || (() => {}),
    onError: options.onError || (() => {}),
    onClose: options.onClose || (() => {}),
  }),
  fetch: (...args) => fetch(...args),
};

const settingsFrom = (tournament: Tournament | null): SettingsDraft => {
  const bracketSize = String(tournament?.bracket_size ?? 8);
  const entryCap = tournament?.entry_cap;
  const capMode = entryCap == null ? "unlimited" : Number(entryCap) === Number(bracketSize) ? "bracket" : "custom";
  return {
    title: tournament?.title || "",
    gameName: tournament?.game_name || "",
    bracketSize,
    chatChannel: tournament?.chat_channel || "",
    keyword: tournament?.entry_keyword || "!join",
    capMode,
    cap: entryCap == null ? "" : String(entryCap),
    waitlist: tournament?.waitlist_enabled === true,
  };
};

const snapshot = (draft: SettingsDraft) => JSON.stringify(draft);
function request<T extends object>(method: string, body: T): RequestInit {
  return { method, body: JSON.stringify(body) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function apiErrorData(error: unknown): TournamentApiErrorData | undefined {
  if (!(error instanceof Error)) return undefined;
  const data = "data" in error ? error.data : undefined;
  if (!isRecord(data)) return undefined;
  const result: TournamentApiErrorData = {};
  if (typeof data.error === "string") result.error = data.error;
  if (typeof data.field === "string") result.field = data.field;
  if (
    isRecord(data.fix)
    && typeof data.fix.label === "string"
    && isRecord(data.fix.settings)
  ) {
    const settings: SettingsRequestBody = {};
    if (typeof data.fix.settings.entryCap === "string" || typeof data.fix.settings.entryCap === "number") {
      settings.entryCap = data.fix.settings.entryCap;
    }
    if (typeof data.fix.settings.bracketSize === "number") {
      settings.bracketSize = data.fix.settings.bracketSize;
    }
    result.fix = { label: data.fix.label, settings };
  }
  return result;
}

const getError = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback;
  return apiErrorData(error)?.error || error.message || fallback;
};

function StatusPill({ lifecycle, label, tone }: { lifecycle: string; label: string; tone?: string }) {
  const color = tone || lifecycle;
  const colorClass = color === "live" || color === "in-bracket"
    ? "border-primary/40 bg-accent text-primary"
    : color === "finished" || color === "champion"
      ? "border-green-600/20 bg-green-600/10 text-green-700"
      : color === "waitlist" || color === "duplicate"
        ? "border-amber-600/20 bg-amber-600/10 text-amber-800"
        : ["cancelled", "removed", "blocked", "eliminated"].includes(color)
          ? "border-red-600/20 bg-red-600/5 text-red-700"
          : "border-border bg-muted text-muted-foreground";
  return <Badge className={cn("tn-pill rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", `tn-pill--${color}`, colorClass)}>{label}</Badge>;
}

function Stat({ icon: Icon, label, value, id }: { icon: React.ElementType; label: string; value: string; id?: string }) {
  return (
    <div className="tn-stat min-w-0 border-l border-border px-4 py-3 first:border-l-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="tn-stat-ic size-3.5" aria-hidden="true" />{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold tabular-nums" id={id}>{value}</dd>
    </div>
  );
}

function Field({
  label,
  id,
  children,
  hint,
  error,
  errorId,
  onFix,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  error?: FieldError;
  errorId?: string;
  onFix?: () => void;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", error && "has-error")}>
      <Label htmlFor={id} className="text-[13px] font-semibold">{label}</Label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      <span className="field-error text-xs text-red-700" id={`${errorId || id}-error`} role="alert" hidden={!error}>
        {error?.message}
        {error?.fix && <Button type="button" size="sm" variant="ghost" className="tn-settings-fix ml-2 h-7 px-2" id="tournament-settings-fix" data-field={id} onClick={onFix}>{error.fix.label}</Button>}
      </span>
    </div>
  );
}

function EntryRow({
  entry,
  duplicateProtection,
  onAction,
}: {
  entry: TournamentEntry;
  duplicateProtection: boolean;
  onAction: (action: TournamentEntryAction, entryId: string) => void;
}) {
  const flagged = duplicateProtection && Boolean(entry.flagged || entry.alt_flag || entry.linked_to);
  const linkedReasons = (entry.linked_reasons || []).map((code: string) => LINKED_REASON_LABELS[code] || code).join(" · ");
  const flagReason = entry.linked_to
    ? `Linked to ${entry.linked_to}${linkedReasons ? ` · ${linkedReasons}` : ""}`
    : entry.alt_reason || "Possible duplicate account.";
  const name = entry.display_name || "?";
  return (
    <div className={cn("tn-entry grid grid-cols-[minmax(0,1fr)_minmax(76px,0.5fr)_minmax(100px,0.55fr)_44px] items-center gap-3 border-t border-border px-3 py-3 first:border-t-0", flagged && "is-flagged") } data-entry-id={entry.id}>
      <div className="tn-entry-player flex min-w-0 items-center gap-2.5">
        <span className="tn-avatar grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-primary" aria-hidden="true">{String(name).trim().charAt(0).toUpperCase() || "?"}</span>
        <span className="tn-entry-name min-w-0">
          <strong className="block truncate text-[13px]">{name}</strong>
          {flagged && <span className="tn-entry-flag mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground"><StatusPill lifecycle="" tone="duplicate" label="Possible duplicate" /><span className="tn-entry-flag-reason">{flagReason}{entry.linked_to && <> · <a href="/dashboard/audience/linked" className="underline underline-offset-2">Review</a></>}</span></span>}
        </span>
      </div>
      <div className="tn-entry-source text-xs text-muted-foreground">{SOURCE_LABELS[entry.source || ""] || entry.source || "—"}</div>
      <div className="tn-entry-status"><StatusPill lifecycle="" tone={entry.status_tone} label={entry.status_label} /></div>
      <div className="tn-entry-actions flex justify-end">
        {entry.actions?.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" className="tn-menu-btn size-8 rounded-md" aria-label={`Actions for ${name}`}><MoreHorizontal className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="tn-menu-list">
              {entry.actions.map((action) => (
                <DropdownMenuItem
                  key={action}
                  asChild
                  className="tn-menu-item cursor-pointer px-3 py-2 text-[13px]"
                >
                  <button type="button" role="menuitem" data-entry-action={action} data-entry-id={entry.id} onClick={() => onAction(action, String(entry.id))}>
                    {action === "remove" ? "Remove" : action === "block" ? "Block" : "Restore"}
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

export function TournamentsPage({ deps = DEFAULT_DEPENDENCIES }: { deps?: PageDependencies } = {}) {
  const [siteId, setSiteId] = useState("");
  const [board, setBoard] = useState<BoardShell["board"]>(null);
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [entries, setEntries] = useState<TournamentEntry[]>([]);
  const [entryCounts, setEntryCounts] = useState<EntryCounts>(EMPTY_COUNTS);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [tournamentState, setTournamentState] = useState<TournamentState | null>(null);
  const [chatRegistration, setChatRegistration] = useState<ChatRegistration | null>(null);
  const [tournamentsEnabled, setTournamentsEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState("entries");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; error: boolean }>({ text: "", error: false });
  const [seeding, setSeeding] = useState("signup");
  const [addName, setAddName] = useState("");
  const [addPending, setAddPending] = useState(false);
  const [duplicatePending, setDuplicatePending] = useState<boolean | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState({ title: "", bracketSize: "8", gameName: "", capMode: "bracket", customCap: "", chatChannel: "", keyword: "!join" });
  const [createMore, setCreateMore] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [selectMode, setSelectMode] = useState("random");
  const [manualSelection, setManualSelection] = useState<string[]>([]);
  const [selectSearch, setSelectSearch] = useState("");
  const [selectError, setSelectError] = useState("");
  const [selectPending, setSelectPending] = useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [expandedBracket, setExpandedBracket] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTitle, setDeleteTitle] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletePending, setDeletePending] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(settingsFrom(null));
  const [settingsBaseline, setSettingsBaseline] = useState("");
  const [settingsErrors, setSettingsErrors] = useState<Record<string, FieldError>>({});
  const [settingsPending, setSettingsPending] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsFix, setSettingsFix] = useState<SettingsFix | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settingsAdvancedOpen, setSettingsAdvancedOpen] = useState(false);
  const [advancePending, setAdvancePending] = useState<string[]>([]);
  const [scorePending, setScorePending] = useState<string[]>([]);

  const siteIdRef = useRef("");
  const tournamentRef = useRef<Tournament | null>(null);
  const selectedIdRef = useRef("");
  const loadTokenRef = useRef(0);
  const mountedRef = useRef(false);
  const tournamentsEnabledRef = useRef(false);
  const chatConnectionRef = useRef<ChatConnectionHandle | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRunningRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const duplicatePendingRef = useRef<boolean | null>(null);
  const duplicateInFlightRef = useRef(false);
  const advancePendingRef = useRef(new Set<string>());
  const savedBodyRef = useRef<SettingsRequestBody | null>(null);
  const actionRefs = useRef<PageActions>({
    loadTournament: async () => {},
    startChat: async () => {},
    openCreate: () => {},
  });

  const lifecycle = tournamentState?.lifecycle ?? tournament?.lifecycle ?? "setup";
  const finished = lifecycle === "finished" || lifecycle === "cancelled";
  const signupOpen = tournament?.signup_state === "open";
  const keyword = tournament?.entry_keyword || "!join";
  const channel = String(tournament?.chat_channel || "").trim();
  const inactiveEntries = entries.filter((entry) => entry.inactive);
  const activeEntries = entries.filter((entry) => !entry.inactive);
  const hasMatches = Boolean(matches.length || tournament?.winner_name);
  const playedMatches = matches.filter((match) => match.status === "completed" && match.player1_name !== "__YOURRANK_INTERNAL_BYE__" && match.player2_name !== "__YOURRANK_INTERNAL_BYE__").length;
  const settingsDirty = snapshot(settingsDraft) !== settingsBaseline;
  const addEntryState = tournamentState?.add_entry || {
    visible: false,
    enabled: false,
    label: "Add",
    note: null,
    unavailable_reason: null,
  };

  function setCurrent(next: Tournament | null, resetSettings = false) {
    tournamentRef.current = next;
    setTournament(next);
    if (resetSettings) {
      const draft = settingsFrom(next);
      const nextSnapshot = snapshot(draft);
      setSettingsDraft(draft);
      setSettingsBaseline(nextSnapshot);
      setSettingsErrors({});
    }
  }

  function toast(text = "", error = false) {
    setMessage({ text, error });
  }

  function stopChat() {
    chatConnectionRef.current?.close();
    chatConnectionRef.current = null;
  }

  async function fetchEntries(id: string, refreshOnly = true, token = loadTokenRef.current, scopedSiteId = siteIdRef.current) {
    let bracketUnavailable = false;
    const [entryData, bracketData] = await Promise.all([
      deps.api<TournamentEntriesResponse>(`/api/tournaments/${encodeURIComponent(id)}/entries`, {}, scopedSiteId),
      deps.api<TournamentBracketResponse>(`/api/tournaments/${encodeURIComponent(id)}/bracket`, {}, scopedSiteId).catch((): TournamentBracketResponse => {
        bracketUnavailable = true;
        return { matches: [] };
      }),
    ]);
    if (!mountedRef.current || token !== loadTokenRef.current || selectedIdRef.current !== id) return;
    setEntries(entryData.entries || []);
    setEntryCounts(entryData.counts || EMPTY_COUNTS);
    setTournamentState(entryData.state || null);
    setMatches(bracketData.matches || []);
    const updatedTournament = entryData.tournament || bracketData.tournament;
    if (updatedTournament) {
      const current = tournamentRef.current;
      let next: Tournament = { ...(current || updatedTournament), ...updatedTournament, ...(bracketData.tournament || {}) };
      if (duplicatePendingRef.current !== null) next = { ...next, anti_alt_enabled: duplicatePendingRef.current };
      setCurrent(next);
    }
    if (bracketUnavailable) toast("Could not load the tournament bracket. Try again.", true);
    else if (message.text === "Could not load the tournament bracket. Try again.") toast();
    if (!refreshOnly) setLoading(false);
  }

  async function loadTournament(preferredId = selectedIdRef.current, scopedSiteId = siteIdRef.current) {
    const token = ++loadTokenRef.current;
    const data = await deps.api<TournamentListResponse>("/api/tournaments", {}, scopedSiteId);
    if (!mountedRef.current || token !== loadTokenRef.current) return;
    setChatRegistration(data.chatRegistration || null);
    tournamentsEnabledRef.current = data.entitlement?.enabled !== false;
    setTournamentsEnabled(tournamentsEnabledRef.current);
    const list = data.tournaments || [];
    setTournaments(list);
    const saved = preferredId || window.sessionStorage.getItem(`yr:tournament:${scopedSiteId}`);
    const selected = (saved && list.find((item) => String(item.id) === saved))
      || list.find((item) => item.id === data.current_id)
      || list[0]
      || null;
    const id = selected ? String(selected.id) : "";
    selectedIdRef.current = id;
    setSelectedId(id);
    if (id) window.sessionStorage.setItem(`yr:tournament:${scopedSiteId}`, id);
    else window.sessionStorage.removeItem(`yr:tournament:${scopedSiteId}`);
    setCurrent(selected, true);
    setEntries([]);
    setEntryCounts(EMPTY_COUNTS);
    setMatches([]);
    setTournamentState(null);
    if (selected) await fetchEntries(String(selected.id), false, token, scopedSiteId);
    else setLoading(false);
  }

  async function switchTournament(id: string) {
    const selected = tournaments.find((item) => String(item.id) === String(id));
    if (!selected || String(selected.id) === String(tournament?.id)) return;
    stopChat();
    const token = ++loadTokenRef.current;
    selectedIdRef.current = String(selected.id);
    setSelectedId(String(selected.id));
    window.sessionStorage.setItem(`yr:tournament:${siteIdRef.current}`, String(selected.id));
    setCurrent(selected, true);
    setEntries([]);
    setEntryCounts(EMPTY_COUNTS);
    setMatches([]);
    setTournamentState(null);
    setActiveTab("entries");
    await fetchEntries(String(selected.id), false, token);
    if (selected.signup_state === "open") await startChat();
  }

  function reportChatFailure(error: unknown) {
    console.error("[tournaments] live Kick chat connection failed:", error instanceof Error ? error.message : error);
    toast("Live chat updates are unavailable. Chat entries are still saved; they appear when the entry list refreshes.", true);
  }

  async function startChat() {
    const current = tournamentRef.current;
    if (!current || current.signup_state !== "open" || chatConnectionRef.current) return;
    const currentChannel = String(current.chat_channel || "").trim();
    if (!currentChannel) return;
    try {
      const response = await deps.fetch(`/api/giveaways/chatroom?channel=${encodeURIComponent(currentChannel)}`);
      const data = await response.json() as ChatroomLookupResponse;
      if (!response.ok || !data.chatroomId) throw new Error(data.error || "Could not find that Kick channel.");
      if (!mountedRef.current || tournamentRef.current?.id !== current.id) return;
      chatConnectionRef.current = deps.connectKickChat({
        chatroomId: data.chatroomId,
        onOpen: () => {},
        onError: reportChatFailure,
        onClose: () => { chatConnectionRef.current = null; },
        onMessage: (chatData) => {
          const content = String(chatData?.content || "").trim();
          const word = String(tournamentRef.current?.entry_keyword || "!join").toLowerCase();
          if (content && content.split(/\s+/)[0].toLowerCase() === word) refreshEntriesSoon();
        },
      });
    } catch (error) {
      reportChatFailure(error);
    }
  }

  async function refreshEntries() {
    const id = selectedIdRef.current;
    if (!id) return;
    await fetchEntries(id, true);
  }

  function refreshEntriesSoon() {
    refreshQueuedRef.current = true;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(async () => {
      refreshTimerRef.current = null;
      if (refreshRunningRef.current || !refreshQueuedRef.current) return;
      refreshQueuedRef.current = false;
      refreshRunningRef.current = true;
      try {
        await refreshEntries();
      } catch (error) {
        toast(getError(error, "Could not refresh entries."), true);
      } finally {
        refreshRunningRef.current = false;
        if (refreshQueuedRef.current) refreshEntriesSoon();
      }
    }, 180);
  }

  actionRefs.current = {
    loadTournament,
    startChat,
    openCreate: () => {
      if (!tournamentsEnabledRef.current) {
        toast("Tournaments is available on Starter and higher plans.", true);
        return;
      }
      setCreateDraft({ title: "", bracketSize: "8", gameName: "", capMode: "bracket", customCap: "", chatChannel: (chatRegistration?.connected ? chatRegistration.channelName : tournament?.chat_channel || board?.kickChannelName) || "", keyword: "!join" });
      setCreateMore(false);
      setCreateError("");
      setCreateOpen(true);
    },
  };

  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    (async () => {
      try {
        const shell = await deps.loadBoardShell();
        if (!alive) return;
        const activeSiteId = shell.activeSiteId || "";
        siteIdRef.current = activeSiteId;
        setSiteId(activeSiteId);
        setBoard(shell.board || {});
        await actionRefs.current.loadTournament("", activeSiteId);
        if (!alive) return;
        await actionRefs.current.startChat();
        const url = new URL(window.location.href);
        if (url.searchParams.get("new") === "1") {
          url.searchParams.delete("new");
          window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
          actionRefs.current.openCreate();
        }
      } catch (error) {
        if (alive) {
          setLoading(false);
          toast(getError(error, "Tournament unavailable. Try again in a moment."), true);
        }
      }
    })();
    return () => {
      alive = false;
      mountedRef.current = false;
      loadTokenRef.current += 1;
      stopChat();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (lifecycle === "setup" && signupOpen) {
      pollTimerRef.current = setInterval(() => refreshEntriesSoon(), 15000);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [lifecycle, signupOpen]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind === "tournament") {
        event.preventDefault();
        actionRefs.current.openCreate();
      } else if (detail?.kind === "player") {
        event.preventDefault();
        if (!tournamentRef.current) {
          actionRefs.current.openCreate();
          return;
        }
        const currentState = currentStateRef.current;
        if (currentState?.add_entry?.enabled) {
          setActiveTab("entries");
          window.setTimeout(() => document.getElementById("tournament-add-entry-name")?.focus(), 0);
        } else {
          toast(currentState?.add_entry?.note || currentState?.add_entry?.unavailable_reason || "", true);
        }
      }
    };
    document.addEventListener("yr:quick-new", listener);
    return () => document.removeEventListener("yr:quick-new", listener);
  }, []);

  const currentStateRef = useRef<TournamentState | null>(null);
  currentStateRef.current = tournamentState;

  async function onPrimary() {
    if (!tournament) {
      actionRefs.current.openCreate();
      return;
    }
    const start = tournamentState?.start;
    if (!start?.allowed) return;
    if (start.needs_selection) {
      setSelectMode("random");
      setManualSelection([]);
      setSelectSearch("");
      setSelectError("");
      setSelectOpen(true);
      return;
    }
    if (start.confirm) {
      setStartConfirmOpen(true);
      return;
    }
    await startAll();
  }

  async function startAll() {
    if (!tournament || !tournamentState?.start?.allowed) return;
    try {
      await deps.api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/select`, request("POST", { mode: "all", seeding }), siteId);
      stopChat();
      setActiveTab("bracket");
      await refreshEntries();
    } catch (error) {
      toast(getError(error, "Could not start the tournament."), true);
    }
  }

  async function submitSelection() {
    if (!tournament) return;
    const body = selectMode === "manual"
      ? { mode: "manual", entryIds: manualSelection, seeding }
      : { mode: "random", seeding };
    setSelectPending(true);
    setSelectError("");
    try {
      await deps.api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/select`, request("POST", body), siteId);
      setSelectOpen(false);
      stopChat();
      setActiveTab("bracket");
      await refreshEntries();
    } catch (error) {
      setSelectError(getError(error, "Could not create the bracket."));
    } finally {
      setSelectPending(false);
    }
  }

  async function toggleChatSignup(opening: boolean) {
    if (!tournament || !channel) return;
    try {
      const data = await deps.api<TournamentActionResponse>(`/api/tournaments/${encodeURIComponent(tournament.id)}/signups/${opening ? "open" : "lock"}`, request("POST", {}), siteId);
      stopChat();
      await loadTournament(String(tournament.id));
      if (opening) await startChat();
      toast(data.message);
    } catch (error) {
      toast(getError(error, `Could not ${opening ? "open" : "close"} signups.`), true);
    }
  }

  async function submitAddEntry(event: FormEvent) {
    event.preventDefault();
    const displayName = addName.trim();
    if (!displayName) {
      toast("Enter a player name.", true);
      document.getElementById("tournament-add-entry-name")?.focus();
      return;
    }
    if (!tournament || addPending || !addEntryState.enabled) return;
    setAddPending(true);
    try {
      await deps.api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries`, request("POST", { displayName }), siteId);
      setAddName("");
      await refreshEntries();
      toast();
    } catch (error) {
      toast(getError(error, "Could not add player."), true);
    } finally {
      setAddPending(false);
    }
  }

  async function onEntryAction(action: TournamentEntryAction, entryId: string) {
    if (!tournament) return;
    try {
      await deps.api(`/api/tournaments/${encodeURIComponent(tournament.id)}/entries/${encodeURIComponent(entryId)}/${action}`, request("POST", {}), siteId);
      await refreshEntries();
      toast();
    } catch (error) {
      toast(getError(error, "Action failed."), true);
    }
  }

  async function toggleDuplicateProtection(enabled: boolean) {
    if (!tournament || duplicateInFlightRef.current) return;
    duplicateInFlightRef.current = true;
    duplicatePendingRef.current = enabled;
    setDuplicatePending(enabled);
    const previous = tournament.anti_alt_enabled === true;
    setCurrent({ ...tournament, anti_alt_enabled: enabled });
    try {
      const data = await deps.api<TournamentSettingsResponse>(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, request("POST", { antiAltEnabled: enabled }), siteId);
      const persisted = data.tournament?.anti_alt_enabled === true;
      duplicatePendingRef.current = persisted;
      setCurrent({ ...(tournamentRef.current || tournament), ...(data.tournament || {}), anti_alt_enabled: persisted });
      await refreshEntries();
      toast(data.message);
    } catch (error) {
      duplicatePendingRef.current = previous;
      if (tournamentRef.current) setCurrent({ ...tournamentRef.current, anti_alt_enabled: previous });
      toast(getError(error, "Could not update duplicate protection."), true);
    } finally {
      duplicatePendingRef.current = null;
      duplicateInFlightRef.current = false;
      setDuplicatePending(null);
    }
  }

  async function submitScore(matchId: string, player1Score: number, player2Score: number, correcting: boolean) {
    if (!tournament || scorePending.includes(matchId)) return;
    if (player1Score === player2Score) {
      toast("A match cannot end in a tie. Enter different scores.", true);
      return;
    }
    setScorePending((current) => current.includes(matchId) ? current : [...current, matchId]);
    try {
      const data = await deps.api<TournamentActionResponse>(`/api/tournaments/${encodeURIComponent(tournament.id)}/score`, request(correcting ? "PATCH" : "POST", { matchId, player1Score, player2Score }), siteId);
      if (correcting) await loadTournament(String(tournament.id));
      else await loadTournament(String(tournament.id));
      toast(data.message || "");
    } catch (error) {
      toast(getError(error, "Could not save the score."), true);
    } finally {
      setScorePending((current) => current.filter((id) => id !== matchId));
    }
  }

  async function advanceMatch(match: TournamentMatch, player: 1 | 2) {
    if (!tournament) return;
    const matchId = String(match.id);
    if (advancePendingRef.current.has(matchId)) return;
    advancePendingRef.current.add(matchId);
    setAdvancePending([...advancePendingRef.current]);
    try {
      const data = await deps.api<TournamentActionResponse>(`/api/tournaments/${encodeURIComponent(tournament.id)}/score`, request("POST", { matchId, winnerSlot: player }), siteId);
      await loadTournament(String(tournament.id));
      toast(data.message);
    } catch (error) {
      toast(getError(error, "Could not advance the winner."), true);
    } finally {
      advancePendingRef.current.delete(matchId);
      setAdvancePending([...advancePendingRef.current]);
    }
  }

  function updateSettings(field: keyof SettingsDraft, value: string | boolean) {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
    setSettingsErrors({});
    setSettingsFix(null);
  }

  function settingsBodyFrom(draft: SettingsDraft) {
    let entryCap: string | number = draft.capMode;
    if (draft.capMode === "custom") entryCap = Number.parseInt(draft.cap, 10);
    const body: SettingsRequestBody = {
      title: draft.title.trim(),
      gameName: draft.gameName.trim(),
      entryCap,
      entryKeyword: draft.keyword.trim() || "!join",
      waitlistEnabled: draft.waitlist,
      chatChannel: draft.chatChannel.trim(),
    };
    if (lifecycle === "setup") body.bracketSize = Number.parseInt(draft.bracketSize, 10);
    return body;
  }

  async function saveSettingsBody(body: SettingsRequestBody) {
    if (!tournament || finished || settingsPending) return;
    setSettingsPending(true);
    setSettingsErrors({});
    setSettingsFix(null);
    savedBodyRef.current = body;
    const wasOpen = tournament.signup_state === "open";
    try {
      const data = await deps.api<TournamentSettingsResponse>(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, request("POST", body), siteId);
      const savedTournament = data.tournament || { ...tournament, ...body };
      setCurrent({ ...(tournamentRef.current || tournament), ...savedTournament }, true);
      stopChat();
      await loadTournament(String(tournament.id));
      if (wasOpen && tournamentRef.current?.signup_state === "open") await startChat();
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 2500);
    } catch (error) {
      const data = apiErrorData(error);
      const inputByField: Record<string, keyof SettingsDraft> = {
        title: "title",
        bracketSize: "bracketSize",
        entryCap: "cap",
        chatChannel: "chatChannel",
      };
      const key = data?.field ? inputByField[data.field] : undefined;
      if (key) {
        setSettingsErrors({ [key]: { message: data?.error || (error instanceof Error ? error.message : "Could not save settings."), fix: data?.fix } });
        if (data?.fix) setSettingsFix(data.fix);
      } else {
        toast(data?.error || getError(error, "Could not save settings."), true);
      }
    } finally {
      setSettingsPending(false);
    }
  }

  async function submitSettings(event: FormEvent) {
    event.preventDefault();
    if (settingsDraft.capMode === "custom") {
      const cap = Number.parseInt(settingsDraft.cap, 10);
      if (!Number.isInteger(cap) || cap < 1) {
        setSettingsErrors({ cap: { message: "Enter a signup limit of at least 1, or choose Unlimited." } });
        return;
      }
    }
    await saveSettingsBody(settingsBodyFrom(settingsDraft));
  }

  async function retrySettingsFix() {
    if (!settingsFix || !savedBodyRef.current) return;
    await saveSettingsBody({ ...savedBodyRef.current, ...settingsFix.settings });
  }

  function discardSettings() {
    const draft = settingsFrom(tournament);
    setSettingsDraft(draft);
    setSettingsErrors({});
    setSettingsFix(null);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    const bracketSize = Number.parseInt(createDraft.bracketSize, 10);
    if (!BRACKET_SIZES.includes(bracketSize)) {
      setCreateError(`Bracket size must be one of ${BRACKET_SIZES.join(", ")}.`);
      return;
    }
    let entryCap: string | number = createDraft.capMode;
    if (createDraft.capMode === "custom") {
      entryCap = Number.parseInt(createDraft.customCap, 10);
      if (!Number.isInteger(entryCap) || entryCap < 1) {
        setCreateError("Enter a signup limit of at least 1, or choose Unlimited.");
        return;
      }
    }
    setCreatePending(true);
    setCreateError("");
    try {
      const data = await deps.api<TournamentCreateResponse>("/api/tournaments", request("POST", {
        siteId,
        title: createDraft.title.trim(),
        gameName: createDraft.gameName.trim(),
        bracketSize,
        entryCap,
        chatChannel: createDraft.chatChannel.trim(),
        entryKeyword: createDraft.keyword.trim() || "!join",
      }), siteId);
      stopChat();
      const id = String(data.tournament.id);
      selectedIdRef.current = id;
      window.sessionStorage.setItem(`yr:tournament:${siteId}`, id);
      setActiveTab("entries");
      setCreateOpen(false);
      toast();
      await loadTournament(id);
    } catch (error) {
      setCreateError(getError(error, "Could not create the tournament."));
    } finally {
      setCreatePending(false);
    }
  }

  async function submitDelete(event: FormEvent) {
    event.preventDefault();
    if (!tournament || deletePending || deleteTitle.trim() !== String(tournament.title || "").trim()) return;
    setDeletePending(true);
    setDeleteError("");
    try {
      const data = await deps.api<TournamentDeleteResponse>(`/api/tournaments/${encodeURIComponent(tournament.id)}/delete`, request("POST", { confirmTitle: deleteTitle }), siteId);
      setDeleteOpen(false);
      setDeleteTitle("");
      stopChat();
      selectedIdRef.current = "";
      setActiveTab("entries");
      window.sessionStorage.removeItem(`yr:tournament:${siteId}`);
      await loadTournament("");
      toast(data.message);
    } catch (error) {
      setDeleteError(getError(error, "Could not delete the tournament."));
    } finally {
      setDeletePending(false);
    }
  }

  const currentTitle = String(tournament?.title || "");
  const eligibleEntries = entries.filter((entry) => entry.eligible === true);
  const filteredEligible = eligibleEntries.filter((entry) => String(entry.display_name || "").toLowerCase().includes(selectSearch.trim().toLowerCase()));
  const cap = Number(tournament?.bracket_size || 0);
  const canSelect = selectMode !== "manual" || manualSelection.length === cap;
  const siteChannel = String(chatRegistration?.channelName || board?.kickChannelName || "").trim();
  const chatRegChannel = String(chatRegistration?.channelName || "").trim().toLowerCase();
  const chatReg = signupOpen && chatRegistration?.connected && chatRegistration?.chatReady && channel && channel.toLowerCase() === chatRegChannel
    ? "Active"
    : signupOpen ? "Unavailable" : "Off";
  const entryCap = tournament?.entry_cap;
  const activeCount = Number(entryCounts.active || 0);
  const statusLabel = tournamentState?.status_label || tournament?.status_label || lifecycle;
  const start = tournamentState?.start;
  const addNote = addEntryState.note;
  const showJoinCommand = signupOpen;

  const switcher = tournaments.length > 0 && (
    <DropdownMenu>
      <div className="tn-switcher relative z-40" id="tournament-switcher">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-bold text-primary" aria-label={`All tournaments (${tournaments.length})`}>
            All tournaments ({tournaments.length})<ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="tn-switcher-list max-h-[min(70vh,420px)] min-w-[260px] max-w-[80vw]">
          {tournaments.map((item) => {
            const current = String(item.id) === String(selectedId);
            return (
              <DropdownMenuItem key={item.id} asChild className="p-0 focus:bg-muted">
                <button type="button" role="menuitem" data-tournament-switch={item.id} aria-current={current ? "true" : undefined} className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left hover:bg-muted" onClick={() => switchTournament(String(item.id))}>
                  <span className="tn-switcher-title min-w-0 truncate text-[13px]">{item.title || ""}</span>
                  <StatusPill lifecycle={current ? lifecycle : item.lifecycle} label={current ? statusLabel : item.status_label} />
                </button>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </div>
    </DropdownMenu>
  );

  if (loading && !tournament && !tournaments.length) {
    return (
      <div id="tournament-workspace" className="yr-react flex min-w-0 flex-col gap-[18px] px-1 py-1" aria-label="Tournament workspace">
        <section className="tn-loading space-y-3 py-6" role="status" aria-busy="true">
          <h1 className="tn-loading-title text-[22px] font-bold">Tournaments</h1>
          <Skeleton className="tn-loading-bar h-3.5 w-full" />
          <Skeleton className="tn-loading-bar tn-loading-bar--short h-3.5 w-[55%]" />
        </section>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="yr-react flex min-w-0 flex-col gap-[18px]">
        <section className="tn-empty-card flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 sm:p-8" id="tournament-empty" aria-labelledby="tournament-empty-heading">
          <span className="tn-empty-mark grid size-12 place-items-center rounded-xl bg-accent text-primary"><Trophy className="size-7" aria-hidden="true" /></span>
          <h1 className="text-[22px] font-bold" id="tournament-empty-heading">Tournaments</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Run a tournament for your community. Collect entries from your audience, select participants, then manage the bracket here.</p>
          <Button type="button" id="tournament-create" disabled={!tournamentsEnabled} aria-describedby={!tournamentsEnabled ? "tournament-plan-lock" : undefined} onClick={() => actionRefs.current.openCreate()}>Create tournament</Button>
          {!tournamentsEnabled && <p id="tournament-plan-lock" className="rounded-md border border-border bg-muted p-3 text-sm" data-plan-lock="tournaments">Tournaments is available on Starter and higher plans.</p>}
          <p className={cn("tn-message w-full rounded-md border border-border p-3 text-sm", message.error && "is-error border-red-600/30 bg-red-600/5 text-red-700")} id="tournament-message" role="status" aria-live="polite" hidden={!message.text}>{message.text}</p>
          {CreateDialog()}
        </section>
      </div>
    );
  }

  const meta = [String(tournament.game_name || "").trim(), `${tournament.bracket_size}-player bracket`].filter(Boolean).join(" · ");
  const step = lifecycle === "setup"
    ? tournamentState?.chat_signup_text || "Add players below, or turn on chat signup to collect entries from Kick chat."
    : lifecycle === "live"
      ? "Click the winner's name in the Bracket tab to advance them, or enter scores."
      : lifecycle === "finished"
        ? <><Crown className="tn-crown mr-1 size-3.5 text-amber-700" aria-hidden="true" /><span>Champion: {tournament.winner_name || "—"}</span></>
        : statusLabel;
  const titleId = "tournament-title-display";
  const updateSettingsCapMode = (mode: string) => updateSettings("capMode", mode);

  return (
    <div className="yr-react flex min-w-0 flex-col gap-[18px] text-foreground" id="tournament-workspace" data-lifecycle={lifecycle}>
      <section id="tournament-empty" hidden />
      <header className="tn-head overflow-visible rounded-xl border border-border bg-card">
        <div className="tn-head-main flex flex-wrap items-center gap-4 px-4 py-4 sm:flex-nowrap sm:px-5">
          <span className="tn-head-mark grid size-[54px] shrink-0 place-items-center rounded-xl bg-accent text-primary"><Trophy className="tn-ic size-7" aria-hidden="true" /></span>
          <div className="tn-head-text min-w-0 flex-1">
            <div className="tn-head-title-row flex flex-wrap items-center gap-2.5">
              <h1 className="text-[21px] font-bold tracking-tight" id={titleId}>{currentTitle}</h1>
              <span id="tournament-status" data-lifecycle={lifecycle} hidden>{statusLabel}</span>
              <StatusPill lifecycle={lifecycle} label={statusLabel} />
              {switcher}
            </div>
            <p className="tn-meta mt-0.5 text-[13px] text-muted-foreground" id="tournament-meta">{meta}</p>
            <p className="tn-step mt-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground" id="tournament-step-label">{step}</p>
            {lifecycle === "setup" && (
              <div className="tn-setup-controls mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                <RadioGroup value={seeding} onValueChange={setSeeding} className="tn-seeding flex flex-wrap items-center gap-2" aria-label="Seeding">
                  <span className="tn-seeding-label font-semibold text-foreground">Seeding:</span>
                  <Label className="tn-seeding-opt flex cursor-pointer items-center gap-1.5 text-xs font-normal"><RadioGroupItem id="tournament-seeding-signup" value="signup" />Signup order (default)</Label>
                  <Label className="tn-seeding-opt flex cursor-pointer items-center gap-1.5 text-xs font-normal"><RadioGroupItem id="tournament-seeding-shuffle" value="shuffle" />Shuffle</Label>
                </RadioGroup>
                <div className="tn-chat-signup flex flex-wrap items-center gap-2">
                  <Label className="tn-switch-line flex items-center gap-2">
                    <Switch
                      id="tournament-chat-signup"
                      checked={Boolean(signupOpen)}
                      disabled={!channel}
                      aria-label="Chat signup"
                      onCheckedChange={(checked) => toggleChatSignup(checked)}
                    />
                    <span>Chat signup ({keyword})</span>
                  </Label>
                  <span className="tn-chat-signup-state" id="tournament-chat-signup-state">
                    {channel ? tournamentState?.chat_signup_text : <>
                      <b>Kick channel required.</b> {siteChannel ? "Use your connected Kick channel to open signups." : "Add your Kick channel before opening signups."}{" "}
                      <Button type="button" size="sm" variant="ghost" id="tournament-use-channel" data-channel={siteChannel || undefined} className="h-7 px-2" onClick={async () => {
                        if (!siteChannel) {
                          setActiveTab("settings");
                          window.setTimeout(() => document.getElementById("tournament-chat-channel")?.focus(), 0);
                          return;
                        }
                        try {
                          await deps.api(`/api/tournaments/${encodeURIComponent(tournament.id)}/settings`, request("POST", { chatChannel: siteChannel }), siteId);
                          toast();
                          await loadTournament(String(tournament.id));
                        } catch (error) { toast(getError(error, "Could not update the Kick channel."), true); }
                      }}>{siteChannel ? `Use ${siteChannel}` : "Add Kick channel"}</Button>
                    </>}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="tn-head-actions flex shrink-0 items-center gap-2">
            {lifecycle === "setup" && (
              <span className="tn-primary-wrap flex flex-col items-end">
              <Button type="button" id="tournament-primary" disabled={!start?.allowed} aria-describedby={start?.reason ? "tournament-primary-reason" : undefined} onClick={onPrimary}>Start tournament</Button>
                {start?.reason && <p className="tn-primary-reason max-w-48 text-right text-xs text-muted-foreground" id="tournament-primary-reason">{start.reason}</p>}
              </span>
            )}
            <Button type="button" variant="ghost" id="tournament-new" hidden={!tournamentsEnabled} onClick={() => actionRefs.current.openCreate()}><Plus className="tn-ic size-4" />New tournament</Button>
          </div>
        </div>
        <dl className={cn("tn-stats grid grid-cols-2 divide-y divide-border border-t border-border sm:grid-cols-4 sm:divide-y-0", showJoinCommand && "tn-stats--4")}>
          <Stat icon={Users} label="Entries" value={entryCap ? `${activeCount} of ${entryCap}` : String(activeCount)} id="tournament-count" />
          <Stat icon={Trophy} label="Bracket spots" value={String(tournament.bracket_size ?? "—")} id="tournament-fact-spots" />
          {showJoinCommand && <Stat icon={ShieldCheck} label="Join command" value={keyword} id="tournament-fact-keyword" />}
          <Stat icon={Users} label="Signup limit" value={entryCap ? String(entryCap) : "Unlimited"} id="tournament-fact-cap" />
        </dl>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="tn-workspace-tabs">
        <TabsList className="tn-tabs mb-3 h-auto justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
          <TabsTrigger className="tn-tab rounded-none border-b-2 border-transparent px-3 py-2 text-[13px] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none" id="tournament-tab-entries" data-tournament-tab="entries" value="entries">Entries ({activeCount}){entryCounts.waitlist > 0 ? ` · Waitlist ${entryCounts.waitlist}` : ""}</TabsTrigger>
          <TabsTrigger className="tn-tab rounded-none border-b-2 border-transparent px-3 py-2 text-[13px] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none" id="tournament-tab-bracket" data-tournament-tab="bracket" value="bracket">Bracket</TabsTrigger>
          <TabsTrigger className="tn-tab rounded-none border-b-2 border-transparent px-3 py-2 text-[13px] data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none" id="tournament-tab-settings" data-tournament-tab="settings" value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent className="tn-panel mt-0" id="tournament-panel-entries" value="entries" role="tabpanel" aria-labelledby="tournament-tab-entries" forceMount hidden={activeTab !== "entries"}>
          <Card className="tn-panel border-border bg-card shadow-none">
            <CardHeader className="tn-panel-head flex flex-row flex-wrap items-start justify-between gap-2 p-4 pb-3 sm:px-5">
              <div>
                <CardTitle className="text-base" id="tournament-list-heading">Entries</CardTitle>
                <p className="tn-sub mt-1 text-xs text-muted-foreground" id="tournament-list-sub">Review tournament entries and their status.</p>
              </div>
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="tn-advanced" id="tournament-advanced">
                <CollapsibleTrigger className="flex items-center gap-1 text-xs font-bold text-primary">Advanced<ChevronDown className={cn("size-3 transition-transform", advancedOpen && "rotate-180")} /></CollapsibleTrigger>
                <CollapsibleContent className="tn-dup-protection mt-3 max-w-md rounded-md border border-border bg-muted/40 p-3">
                  <Label className="tn-switch-line flex items-center gap-2 text-[13px]"><Switch id="tournament-dup-protection" checked={duplicatePending ?? tournament.anti_alt_enabled === true} disabled={duplicatePending !== null} aria-label="Duplicate protection" onCheckedChange={toggleDuplicateProtection} />Duplicate protection</Label>
                  <p className="mt-2 text-xs text-muted-foreground">Flags lookalike accounts; flagged entries in free tournaments stay out of the bracket until allowed in People → Reviews.</p>
                </CollapsibleContent>
              </Collapsible>
            </CardHeader>
            {addEntryState.visible && (
              <form className="tn-add-entry mx-4 mb-4 grid gap-2 sm:mx-5" id="tournament-add-entry-form" onSubmit={submitAddEntry}>
                <Label htmlFor="tournament-add-entry-name" className="text-[13px] font-semibold">Add player</Label>
                <div className="tn-add-entry-row flex gap-2">
                <Input className="tn-input h-10" id="tournament-add-entry-name" name="displayName" value={addName} maxLength={80} autoComplete="off" placeholder="Add player" aria-label="Add player" disabled={!addEntryState.enabled || addPending} onChange={(event) => setAddName(event.currentTarget.value)} />
                  <Button className="shrink-0" type="submit" id="tournament-add-entry-submit" disabled={!addEntryState.enabled || addPending}>{addEntryState.label}</Button>
                </div>
                {addNote && <p className="tn-add-entry-note text-xs text-muted-foreground">{addNote}</p>}
              </form>
            )}
            {!activeEntries.length && (
              <div className="tn-empty mx-4 mb-4 grid gap-1 rounded-md border border-dashed border-border bg-muted/30 p-5 text-sm sm:mx-5" id="tournament-entries-empty">
                <b>{lifecycle === "setup" && signupOpen ? "Waiting for viewers." : lifecycle === "setup" ? "No entries yet." : "No entries."}</b>
                <span className="text-muted-foreground">{lifecycle === "setup" && signupOpen ? `Ask viewers to type ${keyword} in chat.` : lifecycle === "setup" ? "Add players below, or turn on chat signup to collect them from Kick chat." : "This tournament collected no entries."}</span>
              </div>
            )}
            {activeEntries.length > 0 && (
              <div className="tn-entries overflow-visible" id="tournament-entries">
                <div className="tn-entry tn-entry--head hidden grid-cols-[minmax(0,1fr)_minmax(76px,0.5fr)_minmax(100px,0.55fr)_44px] gap-3 border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:grid" role="row">
                  <span>Player</span><span>Source</span><span>Status</span><span className="tn-col-actions">Actions</span>
                </div>
                <div id="tournament-entry-list" aria-label="Tournament entries">
                  {activeEntries.map((entry) => <EntryRow key={entry.id} entry={entry} duplicateProtection={duplicatePending ?? tournament.anti_alt_enabled === true} onAction={onEntryAction} />)}
                </div>
                <table id="tournament-entry-table" hidden><tbody /></table>
              </div>
            )}
            {inactiveEntries.length > 0 && (
              <details className="tn-removed mt-3 border-t border-border" id="tournament-removed">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-left text-xs font-bold text-primary sm:px-5" id="tournament-removed-summary">
                  Removed ({entryCounts.inactive})
                </summary>
                <div className="tn-entries" id="tournament-removed-list">
                  {inactiveEntries.map((entry) => <EntryRow key={entry.id} entry={entry} duplicateProtection={duplicatePending ?? tournament.anti_alt_enabled === true} onAction={onEntryAction} />)}
                </div>
              </details>
            )}
          </Card>
        </TabsContent>

        <TabsContent className="tn-panel mt-0" id="tournament-panel-bracket" value="bracket" role="tabpanel" aria-labelledby="tournament-tab-bracket" forceMount hidden={activeTab !== "bracket"}>
          <div className="tn-layout grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <Card className="tn-panel tn-bracket-main min-w-0 border-border bg-card shadow-none">
              <CardHeader className="tn-panel-head tn-panel-head--row flex flex-row items-center justify-between gap-3 p-4 sm:px-5">
                <div>
                  <CardTitle className="text-base" id="tournament-bracket-heading">Tournament bracket</CardTitle>
                  <p className="tn-sub mt-1 text-xs text-muted-foreground" id="tournament-bracket-sub">{tournament.bracket_size}-player bracket</p>
                </div>
                <Button className="shrink-0" variant="ghost" size="sm" id="tournament-bracket-expand" type="button" onClick={() => setExpandedBracket(true)}>Open stream view</Button>
              </CardHeader>
              <CardContent className="p-4 pt-0 sm:px-5">
                <div id="tournament-bracket" className="tn-bracket-host min-w-0" hidden={!hasMatches}>
                  {hasMatches && <Bracket tournament={tournament} matches={matches} lifecycle={lifecycle} onScore={submitScore} onAdvance={advanceMatch} advancePending={advancePending} />}
                </div>
                {!hasMatches && <div className="tn-empty grid gap-1 rounded-md border border-dashed border-border bg-muted/30 p-5 text-sm" id="tournament-bracket-empty"><b>Bracket not created yet.</b><span className="text-muted-foreground">Start the tournament from the Entries tab to generate the bracket.</span></div>}
              </CardContent>
            </Card>
            <aside className="tn-aside" id="tournament-summary">
              <Card className="tn-card border-border bg-card shadow-none">
                <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Tournament summary</CardTitle></CardHeader>
                <CardContent className="p-4 pt-0">
                  <dl className="tn-kv-list grid gap-3 text-xs">
                    <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground"><Users className="tn-kv-ic size-3.5" />Entries</dt><dd>{activeCount}</dd></div>
                    <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground"><Trophy className="tn-kv-ic size-3.5" />Bracket size</dt><dd>{tournament.bracket_size}</dd></div>
                    <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground"><Gamepad2 className="tn-kv-ic size-3.5" />Matches played</dt><dd>{playedMatches}</dd></div>
                    <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground">Status</dt><dd><StatusPill lifecycle={lifecycle} label={statusLabel} /></dd></div>
                    {tournament.winner_name && <div className="tn-champ mt-2 flex items-center justify-between gap-3 rounded-md border border-amber-600/30 bg-amber-600/10 px-3 py-2"><span className="text-xs text-muted-foreground">Champion</span><strong className="flex items-center gap-1.5 text-xs text-amber-800"><Crown className="tn-crown size-3.5" />{tournament.winner_name}</strong></div>}
                    <Separator />
                    {tournament.game_name?.trim() && <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground"><Gamepad2 className="tn-kv-ic size-3.5" />Game</dt><dd>{tournament.game_name.trim()}</dd></div>}
                    <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="tn-kv-ic size-3.5" />Created</dt><dd>{formatCreated(tournament.created_at)}</dd></div>
                  </dl>
                </CardContent>
              </Card>
            </aside>
            <p className="tn-champion-sr" id="tournament-champion" hidden>{tournament.winner_name ? `Champion: ${tournament.winner_name}` : ""}</p>
          </div>
        </TabsContent>

        <TabsContent className="tn-panel mt-0" id="tournament-panel-settings" value="settings" role="tabpanel" aria-labelledby="tournament-tab-settings" forceMount hidden={activeTab !== "settings"}>
          <div className="tn-layout grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <Card className="tn-panel tn-settings-main border-border bg-card shadow-none">
              {finished ? (
                <div id="tournament-settings-view" className="p-4 sm:p-5">
                  <div id="tournament-settings-bar" hidden />
                  <div className="tn-panel-head pb-4"><h2 className="text-base font-semibold">Tournament settings</h2><p className="tn-sub mt-1 text-xs text-muted-foreground">This tournament has finished; its settings are read-only.</p></div>
                  <h3 className="tn-group border-t border-border py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">General</h3>
                  <dl className="tn-kv-list grid gap-3 text-sm">
                    <div className="tn-kv flex justify-between gap-3"><dt className="text-muted-foreground">Tournament name</dt><dd>{tournament.title || "—"}</dd></div>
                    <div className="tn-kv flex justify-between gap-3"><dt className="text-muted-foreground">Game</dt><dd>{tournament.game_name || "Not specified"}</dd></div>
                    <div className="tn-kv flex justify-between gap-3"><dt className="text-muted-foreground">Bracket size</dt><dd>{tournament.bracket_size} players</dd></div>
                  </dl>
                  <h3 className="tn-group mt-4 border-t border-border py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Registration</h3>
                  <dl className="tn-kv-list grid gap-3 text-sm">
                    <div className="tn-kv flex justify-between gap-3"><dt className="text-muted-foreground">Kick channel</dt><dd>{tournament.chat_channel || "—"}</dd></div>
                    <div className="tn-kv flex justify-between gap-3"><dt className="text-muted-foreground">Join command</dt><dd>{keyword}</dd></div>
                    <div className="tn-kv flex justify-between gap-3"><dt className="text-muted-foreground">Signup limit</dt><dd>{entryCap ? String(entryCap) : "Unlimited"}</dd></div>
                    <div className="tn-kv flex justify-between gap-3"><dt className="text-muted-foreground">Chat registration</dt><dd>{chatReg}</dd></div>
                  </dl>
                </div>
              ) : (
                <form id="tournament-settings-form" className="tn-form grid gap-4 p-4 sm:p-5" onSubmit={submitSettings} noValidate>
                  <h2 className="text-base font-semibold">Tournament settings</h2>
                  <h3 className="tn-group border-t border-border pt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">General</h3>
                  <div className="tn-form-grid grid gap-4 sm:grid-cols-2">
                    <Field label="Tournament name" id="tournament-title" error={settingsErrors.title} onFix={() => void retrySettingsFix()}>
                      <Input id="tournament-title" name="title" value={settingsDraft.title} placeholder="e.g. Friday Night Cup" maxLength={120} className="tn-input h-10" onChange={(event) => updateSettings("title", event.currentTarget.value)} />
                    </Field>
                    <Field label="Game" id="tournament-game">
                      <Input id="tournament-game" name="gameName" value={settingsDraft.gameName} placeholder="Game" maxLength={120} className="tn-input h-10" onChange={(event) => updateSettings("gameName", event.currentTarget.value)} />
                    </Field>
                    <Field label="Bracket size" id="tournament-bracket-size" error={settingsErrors.bracketSize} onFix={() => void retrySettingsFix()} hint={(lifecycle === "live" || finished) ? <span id="tournament-bracket-size-hint">Bracket size is locked: the bracket has already been created.</span> : undefined}>
                      <Select value={settingsDraft.bracketSize} disabled={lifecycle === "live" || finished} onValueChange={(value) => updateSettings("bracketSize", value)}>
                        <SelectTrigger id="tournament-bracket-size" name="bracketSize" className="tn-input h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>{BRACKET_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} players</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <h3 className="tn-group border-t border-border pt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Registration</h3>
                  <div className="tn-form-grid grid gap-4 sm:grid-cols-2">
                    <Field label="Kick channel" id="tournament-chat-channel" error={settingsErrors.chatChannel} onFix={() => void retrySettingsFix()} hint={<span>Chat registration: <span className={cn("tn-live", chatReg === "Active" && "is-live")} id="tournament-chat-status">Chat registration {chatReg.toLowerCase()}</span></span>}>
                      <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
                        <span className="flex items-center border-r border-input bg-muted px-3 py-2 text-xs text-muted-foreground">kick.com/</span>
                        <Input id="tournament-chat-channel" name="chatChannel" value={settingsDraft.chatChannel} placeholder={siteChannel || "channelname"} autoComplete="off" className="tn-input h-10 border-0 shadow-none focus-visible:ring-0" onChange={(event) => updateSettings("chatChannel", event.currentTarget.value)} />
                      </div>
                    </Field>
                    <Field label="Chat command" id="tournament-keyword">
                      <Input id="tournament-keyword" name="entryKeyword" value={settingsDraft.keyword} maxLength={40} className="tn-input h-10" onChange={(event) => updateSettings("keyword", event.currentTarget.value)} />
                    </Field>
                    <Field label="Signup limit" id="tournament-entry-cap-mode" errorId="tournament-entry-cap" error={settingsErrors.cap} onFix={() => void retrySettingsFix()}>
                      <Select value={settingsDraft.capMode} onValueChange={updateSettingsCapMode}>
                        <SelectTrigger id="tournament-entry-cap-mode" name="entryCapMode" className="tn-input h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bracket">Same as bracket size ({settingsDraft.bracketSize})</SelectItem>
                          <SelectItem value="unlimited">Unlimited</SelectItem>
                          <SelectItem value="custom">Custom…</SelectItem>
                        </SelectContent>
                      </Select>
                      {settingsDraft.capMode === "custom" && <Input id="tournament-entry-cap" name="entryCap" type="number" min="1" inputMode="numeric" aria-label="Custom signup limit" placeholder="e.g. 40" value={settingsDraft.cap} className="tn-input mt-2 h-10" onChange={(event) => updateSettings("cap", event.currentTarget.value)} />}
                      <span className="text-xs text-muted-foreground">Defaults to the bracket size.</span>
                    </Field>
                  </div>
                  <Collapsible open={settingsAdvancedOpen} onOpenChange={setSettingsAdvancedOpen} className="tn-advanced tn-settings-advanced border-t border-border pt-3">
                    <CollapsibleTrigger className="flex items-center gap-1 text-xs font-bold text-primary">Advanced<ChevronDown className={cn("size-3 transition-transform", settingsAdvancedOpen && "rotate-180")} /></CollapsibleTrigger>
                    <CollapsibleContent className="mt-3">
                      <Label className="tn-check flex items-start gap-2 text-[13px]"><Checkbox id="tournament-waitlist" name="waitlistEnabled" checked={settingsDraft.waitlist} onCheckedChange={(checked) => updateSettings("waitlist", checked === true)} /><span>Allow waitlist<span className="mt-1 block text-xs text-muted-foreground">When the limit is reached, new signups join a waitlist and move up automatically when a spot opens.</span></span></Label>
                    </CollapsibleContent>
                  </Collapsible>
                  <div className="tn-form-bar sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-card py-3" id="tournament-settings-bar" hidden={!settingsDirty}>
                    <span className="text-xs text-muted-foreground">Unsaved changes</span>
                    <span className="tn-form-bar-actions flex gap-2">
                      <Button type="button" size="sm" variant="ghost" id="tournament-settings-discard" disabled={settingsPending} onClick={discardSettings}>Discard</Button>
                      <Button type="submit" size="sm" id="tournament-settings-save" disabled={settingsPending || !settingsDirty}>Save settings</Button>
                    </span>
                  </div>
                  {settingsSaved && <p className="tn-saved text-xs text-green-700" id="tournament-settings-saved" role="status">Settings saved.</p>}
                </form>
              )}
            </Card>
            <aside className="tn-aside grid content-start gap-3" id="tournament-settings-aside">
              <Card className="tn-card border-border bg-card shadow-none">
                <CardHeader className="p-4 pb-1"><CardTitle className="text-sm">Tournament status</CardTitle></CardHeader>
                <CardContent className="p-4 pt-2"><p className="tn-status-line"><StatusPill lifecycle={lifecycle} label={statusLabel} /></p></CardContent>
              </Card>
              <Card className="tn-card border-border bg-card shadow-none">
                <CardHeader className="p-4 pb-1"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
                <CardContent className="p-4 pt-2"><dl className="tn-kv-list grid gap-3 text-xs">
                  <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="tn-kv-ic size-3.5" />Created</dt><dd>{formatCreated(tournament.created_at)}</dd></div>
                  <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground"><Users className="tn-kv-ic size-3.5" />Entries</dt><dd>{activeCount}</dd></div>
                  <div className="tn-kv flex justify-between gap-3"><dt className="flex items-center gap-1.5 text-muted-foreground"><Gamepad2 className="tn-kv-ic size-3.5" />Matches played</dt><dd>{playedMatches}</dd></div>
                </dl></CardContent>
              </Card>
              <Card className="tn-card tn-card--danger border-red-700/20 bg-card shadow-none">
                <CardHeader className="p-4 pb-1"><CardTitle className="text-sm">Delete tournament</CardTitle></CardHeader>
                <CardContent className="p-4 pt-2"><p className="tn-sub mb-3 text-xs text-muted-foreground">Permanently delete this tournament.</p><Button type="button" variant="ghost" className="tn-danger text-red-700 hover:bg-red-600/5" id="tournament-delete" onClick={() => { setDeleteTitle(""); setDeleteError(""); setDeleteOpen(true); }}>Delete tournament</Button></CardContent>
              </Card>
            </aside>
          </div>
        </TabsContent>
      </Tabs>

      <p className={cn("tn-message rounded-md border border-border bg-card px-3.5 py-2.5 text-[13px]", message.error && "is-error border-red-600/30 bg-red-600/5 text-red-700")} id="tournament-message" role="status" aria-live="polite" hidden={!message.text}>{message.text}</p>

      <Dialog open={selectOpen} onOpenChange={setSelectOpen}>
        <DialogContent id="tournament-select-modal" className="tn-dialog max-h-[90vh] max-w-[560px] overflow-y-auto p-0">
          <div className="tn-dialog-card grid gap-4 p-5 sm:p-6" id="tournament-select-card">
            <DialogHeader><DialogTitle id="tournament-select-heading">Select participants</DialogTitle></DialogHeader>
            <RadioGroup value={selectMode} onValueChange={setSelectMode} className="tn-select-modes grid grid-cols-2 gap-2" aria-label="Selection mode">
              <Label htmlFor="ts-mode-random" className={cn("tn-select-mode flex cursor-pointer items-center gap-2 rounded-md border border-border p-3 text-sm", selectMode === "random" && "border-primary bg-accent")}><RadioGroupItem id="ts-mode-random" value="random" />Random</Label>
              <Label htmlFor="ts-mode-manual" className={cn("tn-select-mode flex cursor-pointer items-center gap-2 rounded-md border border-border p-3 text-sm", selectMode === "manual" && "border-primary bg-accent")}><RadioGroupItem id="ts-mode-manual" value="manual" />Manual</Label>
            </RadioGroup>
            <div id="ts-pane-random" hidden={selectMode !== "random"}>
              <p id="ts-random-text">Randomly select {cap} of {entryCounts.eligible} eligible players.</p>
              <p className="mt-1 text-xs text-muted-foreground">Players will be randomly placed in the bracket.</p>
            </div>
            <div id="ts-pane-manual" className="grid gap-3" hidden={selectMode !== "manual"}>
              <Button type="button" size="sm" variant="ghost" id="ts-select-first" onClick={() => setManualSelection(eligibleEntries.filter((entry) => Number(entry.eligible_rank) > 0 && Number(entry.eligible_rank) <= cap).map((entry) => String(entry.id)))}>Select first {cap}</Button>
              <Input id="ts-search" type="search" placeholder="Search entries" aria-label="Search entries" autoComplete="off" value={selectSearch} className="tn-input h-10" onChange={(event) => setSelectSearch(event.currentTarget.value)} />
              <ul id="ts-entry-list" className="tn-select-list m-0 max-h-60 list-none overflow-y-auto rounded-md border border-border p-0">
                {filteredEligible.map((entry) => {
                  const id = String(entry.id);
                  const checked = manualSelection.includes(id);
                  return <li className="tn-select-row border-t border-border first:border-t-0" key={id}><Label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px]"><Checkbox value={id} checked={checked} onCheckedChange={(value) => setManualSelection((current) => value === true ? [...current, id] : current.filter((candidate) => candidate !== id))} /><span>{entry.display_name}</span></Label></li>;
                })}
              </ul>
              <p className="tn-select-counter text-xs text-muted-foreground" id="ts-counter" aria-live="polite">Selected {manualSelection.length} / {cap}</p>
              <p className="text-xs text-muted-foreground">Players will be randomly placed in the bracket.</p>
            </div>
            <p className="tn-message is-error rounded-md border border-red-600/30 bg-red-600/5 p-2.5 text-sm text-red-700" id="tournament-select-error" role="alert" hidden={!selectError}>{selectError}</p>
            <DialogFooter className="tn-dialog-actions border-t border-border pt-4">
              <Button type="button" variant="ghost" size="sm" id="tournament-select-cancel" onClick={() => setSelectOpen(false)}>Cancel</Button>
              <Button type="button" size="sm" id="tournament-select-submit" disabled={selectPending || !canSelect} onClick={submitSelection}>{selectPending ? "Creating…" : "Create bracket"}</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={startConfirmOpen} onOpenChange={setStartConfirmOpen}>
        <AlertDialogContent className="yr-react tn-dialog">
          <AlertDialogHeader><AlertDialogTitle>Start tournament</AlertDialogTitle><AlertDialogDescription>{tournamentState?.start?.confirm}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction id="tournament-start-confirm" onClick={(event) => { event.preventDefault(); setStartConfirmOpen(false); void startAll(); }}>Start tournament</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={expandedBracket} onOpenChange={setExpandedBracket}>
        <DialogContent id="tournament-bracket-modal" className="tn-dialog tn-dialog--bracket max-h-[92vh] max-w-[96vw] overflow-y-auto p-0">
          <div className="tn-dialog-card tn-dialog-card--bracket grid gap-3 p-4 sm:p-6">
            <div className="tn-dialog-head flex items-start justify-between gap-4">
              <DialogHeader><DialogTitle id="tournament-bracket-modal-heading">Stream view</DialogTitle><DialogDescription className="tn-sub">Read-only, sized for screen sharing. Enter scores in the Bracket tab.</DialogDescription></DialogHeader>
              <Button type="button" variant="ghost" size="sm" id="tournament-bracket-close" aria-label="Close stream view" onClick={() => setExpandedBracket(false)}>Close</Button>
            </div>
            <div id="tournament-bracket-full" className="tn-dialog-scroll overflow-auto"><Bracket tournament={tournament} matches={matches} lifecycle={lifecycle} mode="expanded" onScore={submitScore} advancePending={advancePending} /></div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent id="tournament-delete-modal" className="tn-dialog max-w-[520px] p-0">
          <form className="tn-dialog-card grid gap-4 p-5 sm:p-6" id="tournament-delete-form" onSubmit={submitDelete} noValidate>
            <DialogHeader><DialogTitle id="tournament-delete-heading">Delete tournament</DialogTitle></DialogHeader>
            <p className="tn-sub text-sm text-muted-foreground">{tournamentState?.delete_warning}</p>
            <Field label={`Type “${currentTitle}” to confirm`} id="td-confirm">
              <Input id="td-confirm" name="confirmTitle" type="text" autoComplete="off" className="tn-input h-10" value={deleteTitle} onChange={(event) => { setDeleteTitle(event.currentTarget.value); setDeleteError(""); }} />
            </Field>
            <p className="tn-message is-error rounded-md border border-red-600/30 bg-red-600/5 p-2.5 text-sm text-red-700" id="tournament-delete-error" role="alert" hidden={!deleteError}>{deleteError}</p>
            <DialogFooter className="tn-dialog-actions border-t border-border pt-4">
              <Button type="button" variant="ghost" size="sm" id="tournament-delete-cancel" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button type="submit" variant="ghost" size="sm" className="tn-danger text-red-700 hover:bg-red-600/5" id="tournament-delete-submit" disabled={deletePending || deleteTitle.trim() !== currentTitle.trim()}>{deletePending ? "Deleting…" : "Delete tournament"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {CreateDialog()}
    </div>
  );

  function CreateDialog() {
    return (
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent id="tournament-create-modal" className="tn-dialog max-h-[90vh] max-w-[640px] overflow-y-auto p-0">
          <form className="tn-dialog-card grid gap-4 p-5 sm:p-6" id="tournament-create-form" onSubmit={submitCreate} noValidate>
            <DialogHeader><DialogTitle id="tournament-create-heading">Create tournament</DialogTitle><DialogDescription>Create a tournament and collect entries from your community.</DialogDescription></DialogHeader>
            <div className="tn-form-grid tn-form-grid--two grid gap-4 sm:grid-cols-2">
              <Field label="Tournament name" id="tc-title">
                <Input id="tc-title" name="title" value={createDraft.title} placeholder="e.g. Friday Night Cup" maxLength={120} required className="tn-input h-10" onChange={(event) => { const title = event.currentTarget.value; setCreateDraft((current) => ({ ...current, title })); }} />
              </Field>
              <Field label="Bracket size" id="tc-bracket-size" hint={<span>How many participants play in the bracket.</span>}>
                <Select value={createDraft.bracketSize} onValueChange={(value) => setCreateDraft((current) => ({ ...current, bracketSize: value }))}>
                  <SelectTrigger id="tc-bracket-size" className="tn-input h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{BRACKET_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} players</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <Collapsible open={createMore} onOpenChange={setCreateMore} className="tn-more border-t border-border pt-3">
              <CollapsibleTrigger id="tc-more-trigger" className="flex items-center gap-1 text-xs font-bold text-primary">More options<ChevronDown className={cn("size-3 transition-transform", createMore && "rotate-180")} /></CollapsibleTrigger>
              <CollapsibleContent className="tn-form-grid tn-form-grid--two mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Game" id="tc-game"><Input id="tc-game" name="gameName" value={createDraft.gameName} placeholder="e.g. Fortnite" maxLength={120} className="tn-input h-10" onChange={(event) => { const gameName = event.currentTarget.value; setCreateDraft((current) => ({ ...current, gameName })); }} /></Field>
                <Field label="Signup limit" id="tc-entry-cap">
                  <Select value={createDraft.capMode} onValueChange={(value) => setCreateDraft((current) => ({ ...current, capMode: value }))}>
                    <SelectTrigger id="tc-entry-cap" className="tn-input h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bracket">Same as bracket size ({createDraft.bracketSize})</SelectItem>
                      <SelectItem value="unlimited">Unlimited</SelectItem>
                      <SelectItem value="custom">Custom…</SelectItem>
                    </SelectContent>
                  </Select>
                  {createDraft.capMode === "custom" && <Input id="tc-entry-cap-custom" name="entryCap" type="number" min="1" placeholder="e.g. 40" inputMode="numeric" aria-label="Custom signup limit" className="tn-input mt-2 h-10" value={createDraft.customCap} onChange={(event) => { const customCap = event.currentTarget.value; setCreateDraft((current) => ({ ...current, customCap })); }} />}
                  <span className="text-xs text-muted-foreground">Defaults to the bracket size.</span>
                </Field>
                <Field label="Kick channel" id="tc-chat-channel">
                  <div className="flex items-stretch overflow-hidden rounded-md border border-input bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
                    <span className="flex items-center border-r border-input bg-muted px-3 py-2 text-xs text-muted-foreground">kick.com/</span>
                    <Input id="tc-chat-channel" name="chatChannel" value={createDraft.chatChannel} placeholder="channelname" autoComplete="off" readOnly={Boolean(chatRegistration?.connected)} className="tn-input h-10 border-0 shadow-none focus-visible:ring-0" onChange={(event) => { const chatChannel = event.currentTarget.value; setCreateDraft((current) => ({ ...current, chatChannel })); }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{chatRegistration?.connected ? "Your connected Kick channel. Signups are collected here." : "Connect Kick in Settings → Connections before opening signups."}</span>
                </Field>
                <Field label="Chat command" id="tc-keyword"><Input id="tc-keyword" name="entryKeyword" value={createDraft.keyword} maxLength={40} className="tn-input h-10" onChange={(event) => { const keyword = event.currentTarget.value; setCreateDraft((current) => ({ ...current, keyword })); }} /></Field>
              </CollapsibleContent>
            </Collapsible>
            <p className="tn-message is-error rounded-md border border-red-600/30 bg-red-600/5 p-2.5 text-sm text-red-700" id="tournament-create-error" role="alert" hidden={!createError}>{createError}</p>
            <DialogFooter className="tn-dialog-actions border-t border-border pt-4">
              <Button type="button" variant="ghost" size="sm" id="tournament-create-cancel" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" id="tournament-create-submit" disabled={createPending}>{createPending ? "Creating…" : "Create tournament"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }
}

function formatCreated(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
