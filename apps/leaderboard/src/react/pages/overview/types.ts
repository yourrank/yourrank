export type HomeSectionError = {
  key: string;
  message: string;
};

export type HomeAttentionItem = {
  key: string;
  scope: string;
  title: string;
  why: string;
  action: string;
  href: string;
};

export type HomeLiveItem = {
  key: string;
  kind: string;
  name: string;
  status: string;
  meta: string;
  href: string;
  action: string;
};

export type HomeUpcomingItem = {
  key: string;
  kind: string;
  name: string;
  meta: string;
  at: string;
  formattedAt: string;
  href: string;
  action: string;
};

export type HomePulseMetric = {
  key: string;
  label: string;
  value: string | null;
};

export type HomeRecentEvent = {
  kind: string;
  title: string;
  detail?: string;
  at: string;
  relative: string;
  formattedAt: string;
};

export type HomeSetupStep = {
  key: string;
  label: string;
  description: string;
  complete: boolean;
  ownerOnly: boolean;
  next: boolean;
  stateLabel: string;
  stateKey: string;
  rowClass: string;
  href: string;
  publicationAction: boolean;
  brandAction: boolean;
};

export type HomeViewModel = {
  header: {
    siteName: string;
    initial: string;
    logoSrc: string | null;
    operatorHidden: boolean;
    operatorText: string;
    headSub: string;
    statusState: string;
    statusLabel: string;
    publicHidden: boolean;
    publicHref: string;
  };
  attention: {
    hidden: boolean;
    countText: string;
    items: HomeAttentionItem[];
  };
  live: {
    hidden: boolean;
    busy: boolean;
    summary: string;
    items: HomeLiveItem[];
    loading: boolean;
    error: HomeSectionError | null;
  };
  upcoming: {
    hidden: boolean;
    busy: boolean;
    items: HomeUpcomingItem[];
    loading: boolean;
    error: HomeSectionError | null;
  };
  pulse: {
    hidden: boolean;
    busy: boolean;
    rangeLabel: string;
    status: string;
    metrics: HomePulseMetric[];
    error: HomeSectionError | null;
  };
  recent: {
    hidden: boolean;
    busy: boolean;
    allHref: string;
    events: HomeRecentEvent[];
    loading: boolean;
    empty: { title: string; body: string } | null;
    error: HomeSectionError | null;
  };
  quickActions: Array<{ key: string; label: string; href: string }>;
  setup: {
    hidden: boolean;
    attention: boolean;
    title: string;
    message: string;
    action: {
      hidden: boolean;
      href: string;
      label: string;
      publicationAction: boolean;
      brandAction: boolean;
    };
    countText: string;
    steps: HomeSetupStep[];
  };
};

export type HomeActionResult = { ok: true } | { ok: false; error: string };

export type HomeActions = {
  retry: (key: string) => void;
  publish: () => void;
  saveBrandName: (name: string) => Promise<HomeActionResult>;
};
