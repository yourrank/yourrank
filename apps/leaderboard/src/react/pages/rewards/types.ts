export type RewardsTab = "channel" | "overview" | "rules" | "shop" | "redemptions";

export type DeliveryState = {
  verified?: boolean;
  events?: Record<string, string>;
  required?: string[];
  requiredLabels?: string[];
};

export type ChannelState = {
  connected?: boolean;
  name?: string | null;
  externalId?: string | null;
  linkedAt?: string | null;
  status?: string;
  statusLabel?: string;
  detail?: string;
  needsAttention?: boolean;
  homeAttention?: boolean;
  canRepair?: boolean;
  canManage?: boolean;
  delivery?: DeliveryState | null;
};

export type RewardMapping = {
  id: string;
  kick_reward_id: string;
  kick_reward_title: string;
  kick_reward_cost: number;
  credits: number;
  active: boolean;
};

export type ShopItem = {
  id: string;
  name: string;
  description?: string | null;
  cost: number;
  stock: number | null;
  active: boolean;
  cooldown_seconds?: number | null;
  has_image?: boolean;
};

export type CreditsUsage = {
  rewardMappings?: number | null;
  shopItems?: number | null;
  pendingRedemptions?: number | null;
  redemptionsPer30Days?: number | null;
  newViewersPer30Days?: number | null;
};

export type CreditsLimits = {
  rewardMappings?: number | null;
  shopItems?: number | null;
  pendingRedemptions?: number | null;
  redemptionsPer30Days?: number | null;
  newViewersPer30Days?: number | null;
};

export type RewardsCapabilities = {
  manageRewards?: boolean;
  manageClaims?: boolean;
  adjustCredits?: boolean;
  manageConnections?: boolean;
};

export type CreditsStatus = {
  enabled?: boolean;
  channel?: ChannelState;
  mappings?: RewardMapping[];
  shopItems?: ShopItem[];
  creatorContact?: { ready?: boolean; editHref?: string };
  recentClaims?: Array<{ createdAt: string; displayName: string; itemName: string }>;
  usage?: CreditsUsage;
  limits?: CreditsLimits;
  capabilities?: RewardsCapabilities;
  viewerAuth?: { kick?: boolean; discord?: boolean; public?: boolean };
};

export type AnalyticsResponse = {
  days: number;
  summary?: {
    periodEarned?: number;
    allTimeEarned?: number;
    periodSpent?: number;
    allTimeSpent?: number;
    redemptionsTotal?: number;
    redemptionsPending?: number;
    viewerBalance?: number;
  };
  topItems?: Array<{ id: string; name: string; redemptions: number; credits_spent: number }>;
  creditsByDay?: Array<{ day: string; type: "earn" | "spend" | "refund" | "revoke"; total: number }>;
};

export type ClaimSupportMessage = {
  id: string;
  senderType: "creator" | "viewer";
  senderName: string;
  message: string;
  createdAt: string;
};

export type ClaimSupport = {
  id: string;
  status: "open" | "resolved";
  statusLabel?: string;
  issueLabel?: string;
  resolvedAt?: string | null;
  canReply?: boolean;
  messages?: ClaimSupportMessage[];
};

export type RewardClaim = {
  id: string;
  status: string;
  statusLabel?: string;
  allowedActions?: string[];
  subject?: { displayName?: string };
  source?: { id?: string; title?: string };
  reward?: { name?: string; cost?: number };
  submittedAt?: string;
  support?: { status?: string } | null;
};

export type ClaimPageResponse = {
  claims?: RewardClaim[];
  page?: { hasMore?: boolean; nextCursor?: string | null };
  total?: number;
};

export type ClaimDetail = RewardClaim & {
  fulfillmentDetails?: { note?: string };
  history?: Array<{
    label?: string;
    action?: string;
    actor?: { displayName?: string };
    createdAt: string;
  }>;
};

export type ClaimDetailResponse = {
  claim?: ClaimDetail;
};

export type ClaimSupportResponse = {
  support?: ClaimSupport | null;
};

export type BoardContext = {
  activeSiteId: string;
  board?: { id?: string; name?: string; slug?: string; plan?: string; published?: boolean };
};

export type PageDependencies = {
  api: <T>(path: string, options?: RequestInit, siteId?: string) => Promise<T>;
  loadBoardShell: () => Promise<BoardContext>;
  optimizeRewardImage: (file: File) => Promise<{ data: string; bytes: number }>;
  requestDashboardRoute: (page: string, tab: string, options?: { query?: string; force?: boolean }) => void;
};
