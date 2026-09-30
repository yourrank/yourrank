export type ViewerAuthState = "authenticated" | "unauthenticated" | "unresolved";

export type AccountViewId =
  | "vd-profile"
  | "vd-connections"
  | "vd-notifications"
  | "vd-security"
  | "vd-data";

export type ViewerConnection = {
  provider: string;
  username?: string | null;
  linkedAt?: string | null;
};

export type ViewerAccount = {
  displayName?: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
  connections?: ViewerConnection[];
};

export type ConnectedAccount = ViewerConnection & {
  label?: string | null;
  state?: string;
  connectUrl?: string | null;
};

export type ViewerCommunity = {
  slug: string;
  name?: string | null;
  balance?: number | string | null;
  pendingClaims?: number | null;
  claimingAvailable?: boolean;
};

export type ViewerMeResponse = {
  viewer?: ViewerAccount | null;
  communities?: ViewerCommunity[];
  connectedAccounts?: ConnectedAccount[];
};

export type LoginProvider = {
  provider: "kick" | "discord";
  href: string;
  className: string;
};
