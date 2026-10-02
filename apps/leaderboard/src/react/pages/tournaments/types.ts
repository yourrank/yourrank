export type TournamentLifecycle = "setup" | "live" | "finished" | "cancelled";

export type Tournament = {
  id: string | number;
  title?: string | null;
  game_name?: string | null;
  bracket_size?: number | null;
  status?: string | null;
  lifecycle?: TournamentLifecycle;
  status_label?: string;
  winner_name?: string | null;
  signup_state?: string | null;
  entry_cap?: number | null;
  waitlist_enabled?: boolean;
  anti_alt_enabled?: boolean;
  entry_keyword?: string | null;
  chat_channel?: string | null;
  created_at?: string | null;
};

export type TournamentListItem = Tournament & {
  lifecycle: TournamentLifecycle;
  status_label: string;
};

export type TournamentEntryAction = "remove" | "block" | "restore";

export type TournamentEntry = {
  id: string | number;
  display_name?: string | null;
  source?: string | null;
  status: string;
  status_label: string;
  status_tone: string;
  actions: TournamentEntryAction[];
  inactive: boolean;
  eligible: boolean;
  eligible_rank: number | null;
  flagged?: boolean;
  alt_flag?: boolean;
  linked_to?: string | null;
  linked_reasons?: string[];
  alt_reason?: string | null;
};

export type TournamentMatch = {
  id: string | number;
  round_number: number;
  match_index: number;
  player1_name?: string | null;
  player2_name?: string | null;
  player1_score?: number | string | null;
  player2_score?: number | string | null;
  winner_name?: string | null;
  status?: string;
  correctable?: boolean;
};

export type EntryCounts = {
  active: number;
  eligible: number;
  waitlist: number;
  removed: number;
  blocked: number;
  inactive: number;
};

export type TournamentStartState = {
  allowed: boolean;
  reason: string | null;
  needs_selection: boolean;
  confirm: string | null;
};

export type TournamentAddEntryState = {
  visible: boolean;
  enabled: boolean;
  label: string;
  note: string | null;
  unavailable_reason: string | null;
};

export type TournamentState = {
  lifecycle: TournamentLifecycle;
  status_label: string;
  start: TournamentStartState | null;
  add_entry: TournamentAddEntryState;
  chat_signup_text: string | null;
  delete_warning: string;
};

export type ChatRegistration = {
  connected?: boolean;
  chatReady?: boolean;
  channelName?: string | null;
};

export type TournamentListResponse = {
  tournaments?: TournamentListItem[];
  current_id?: string | number | null;
  chatRegistration?: ChatRegistration | null;
  entitlement?: { enabled?: boolean };
};

export type TournamentEntriesResponse = {
  tournament?: Tournament;
  entries?: TournamentEntry[];
  counts?: EntryCounts;
  state?: TournamentState | null;
};

export type TournamentBracketResponse = {
  tournament?: Tournament;
  matches?: TournamentMatch[];
};

export type SettingsRequestBody = {
  title?: string;
  gameName?: string;
  bracketSize?: number;
  entryCap?: string | number;
  entryKeyword?: string;
  waitlistEnabled?: boolean;
  chatChannel?: string;
  antiAltEnabled?: boolean;
};

export type SettingsFix = {
  label: string;
  settings: Partial<SettingsRequestBody>;
};

export type TournamentSettingsResponse = {
  tournament?: Tournament;
  message?: string;
  error?: string;
  field?: string;
  fix?: SettingsFix;
};

export type TournamentActionResponse = {
  message?: string;
};

export type ScoreRequestBody =
  | { matchId: string; player1Score: number; player2Score: number }
  | { matchId: string; winnerSlot: 1 | 2 }
  | { matchId: string; reopen: true };

export type ScoreOutcome = { ok: boolean; message: string };

export type ScoreHandler = (method: "POST" | "PATCH", body: ScoreRequestBody) => Promise<ScoreOutcome>;

export type TournamentCreateResponse = {
  tournament: Tournament;
};

export type TournamentDeleteResponse = {
  message: string;
};

export type BoardShell = {
  activeSiteId?: string | null;
  board?: { kickChannelName?: string | null; slug?: string | null; published?: boolean | null } | null;
};

export type KickChatMessage = {
  content?: unknown;
};

export type ChatConnectionOptions = {
  chatroomId: string | number;
  onMessage: (message: KickChatMessage) => void;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
};

export type ChatConnectionHandle = {
  close: () => void;
};

export type ChatroomLookupResponse = {
  chatroomId?: string | number;
  error?: string;
};

export type TournamentApiErrorData = {
  error?: string;
  field?: string;
  fix?: SettingsFix;
};
