export type AudienceTab = "viewers" | "history" | "reviews" | "linked";

export type BoardShellContext = {
  activeSiteId?: string | null;
  board?: { name?: string | null; slug?: string | null } | null;
};

export type LinkedIdentity = {
  provider: string;
  displayName?: string | null;
};

export type Member = {
  id: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  lastSeenAt?: string | null;
  lastCreditAt?: string | null;
  balance?: number | null;
  totalEarned?: number | null;
  totalSpent?: number | null;
  blocked?: boolean;
  kick_username?: string | null;
  discord_username?: string | null;
  linkedIdentities?: LinkedIdentity[];
  moderation?: { status?: string | null; reason?: string | null };
  recentCreditActivity?: MemberCreditEvent[];
};

export type MemberCreditEvent = {
  id?: string;
  type: string;
  direction?: string;
  amount: number;
  description?: string | null;
  createdAt: string;
};

export type MemberPageResponse = {
  members?: Member[];
  page?: { hasMore?: boolean; nextCursor?: string | null };
  total?: number | null;
};

export type MemberDetailResponse = {
  member: Member;
  site?: { id?: string; name?: string | null };
};

export type ActivityEvent = MemberCreditEvent & {
  kickUsername?: string | null;
  discordUsername?: string | null;
  kickUserId?: string | null;
  discordUserId?: string | null;
};

export type ActivityResponse = {
  events?: ActivityEvent[];
  nextCursor?: string | null;
};

export type ViewerHistoryResponse = {
  boards?: Array<{
    siteId: string;
    name?: string | null;
    slug?: string | null;
    balance: number;
    totalEarned: number;
    totalSpent: number;
    redemptionsPending: number;
    redemptionsTotal: number;
  }>;
};

export type Review = {
  id: string;
  typeLabel?: string;
  status: string;
  statusLabel?: string;
  decision?: string | null;
  allowedDecisions?: string[];
  subject: { displayName: string; memberDisplayName?: string | null; membershipId?: string | null };
  reason: { label: string; explanation: string };
  source: { workflow: string; title: string };
  createdAt: string;
  context?: {
    membership?: { id: string; linkedIdentities?: LinkedIdentity[] } | null;
    guidance: string;
  };
  history?: Array<{
    label: string;
    actor?: { name?: string | null } | null;
    createdAt: string;
  }>;
};

export type ReviewsResponse = {
  reviews?: Review[];
  counts?: { pending?: number; resolved?: number };
};

export type LinkedGroup = {
  id: string;
  linkIds: string[];
  accounts: Array<{ displayName: string }>;
  confidence: number;
  reasons?: Array<{ label: string }>;
  summary: string;
  status: "pending" | "watching" | "restricted" | "dismissed";
  firstDetectedAt?: string | null;
  lastDetectedAt?: string | null;
};

export type LinkedAccountsResponse = {
  groups?: LinkedGroup[];
  counts?: { pending?: number; watching?: number; restricted?: number; dismissed?: number };
};
