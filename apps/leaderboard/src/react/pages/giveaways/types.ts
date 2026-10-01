export type GiveawayRules = {
  entryMode?: "chat" | "members" | "verified";
  subscriberOnly?: boolean;
  vipOnly?: boolean;
  excludePreviousWinners?: boolean;
  winnerRepeat?: "once" | "again";
  onePerIp?: boolean;
  vpnDetection?: boolean;
  winnerMustRespond?: boolean;
  responseTimeout?: number;
  autoReroll?: boolean;
};

export type ChatConnection = {
  connected: boolean;
  chatReady: boolean;
  channelName: string | null;
};

export type GiveawaySession = {
  id: string;
  provider: "kick" | "manual";
  keyword: string;
  status: string;
  started_at: string | null;
  stopped_at?: string | null;
  drawn_at?: string | null;
  winner_entry_id?: string | null;
  winner_confirmed_at?: string | null;
  winner_confirmation_message?: string | null;
  winner_finalized_at?: string | null;
  winner_response_required?: boolean | null;
  winner_response_timeout_seconds?: number | null;
  winner_response_deadline?: string | null;
  auto_reroll_exhausted_at?: string | null;
  rules?: GiveawayRules;
};

export type LinkedEntrant = {
  username: string;
  reasons?: string[];
};

export type GiveawayEntrant = {
  id: string;
  provider: string;
  provider_user_id?: string | null;
  username: string;
  avatar_url?: string | null;
  message?: string | null;
  badges?: Array<{ type?: string }>;
  entered_at: string;
  eligibility_status?: string;
  eligibility_reason?: string | null;
  eligibility_reason_label?: string | null;
  linked?: LinkedEntrant[];
};

export type GiveawayWinner = GiveawayEntrant & {
  entry_id?: string;
};

export type GiveawayDraw = {
  id?: string;
  username?: string | null;
  replaced_username?: string | null;
  reason?: string | null;
  drawn_at?: string | null;
  confirmed_at?: string | null;
};

export type ChatGiveawayPayload = {
  message?: string;
  connection?: ChatConnection;
  capabilities?: { vpnDetection?: boolean };
  session?: GiveawaySession | null;
  entries?: GiveawayEntrant[];
  winner?: GiveawayWinner | null;
  draws?: GiveawayDraw[];
  excluded?: string[];
};

export type BoardShell = {
  activeSiteId?: string;
  board?: {
    id?: string;
    name?: string;
    slug?: string;
  };
};

export type GiveawayPageDependencies = {
  api: typeof import("../../lib/api").api;
  loadBoardShell: () => Promise<BoardShell>;
};
