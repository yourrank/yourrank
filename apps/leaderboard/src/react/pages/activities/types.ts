export type ActivitySource = {
  kind: "code_drop";
  id: string;
};

export type ActivityState = "open" | "completed";

export type Activity = {
  id: string;
  source: ActivitySource;
  type: "drop";
  typeLabel: "Drop";
  title: string;
  state: ActivityState;
  stateLabel: string;
  createdAt: string;
  endsAt: string | null;
  participation: {
    mode: "free";
    cost: 0;
    identity: "site_membership";
  };
  progress: {
    claimed: number;
    capacity: number;
  };
  reward: {
    creditsPerClaim: number;
  };
  actions: {
    canEnd: boolean;
  };
};

export type ActivityPageInfo = {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type ActivityTemplateConfig = {
  pointsReward: number;
  maxClaims: number;
  expireMinutes: number;
};

export type ActivityTemplate = {
  id: string;
  kind: "safe_code_drop";
  name: string;
  config: ActivityTemplateConfig;
  createdAt: string;
  updatedAt: string;
};

export type ActivityRecurrence = "once" | "daily" | "weekly";
export type ActivityScheduleStatus = "scheduled" | "paused" | "completed" | "cancelled" | "failed";

export type ActivitySchedule = {
  id: string;
  kind: "safe_code_drop";
  templateId: string;
  templateName: string;
  config: ActivityTemplateConfig;
  recurrence: ActivityRecurrence;
  nextRunAt: string | null;
  status: ActivityScheduleStatus;
  lastRunAt: string | null;
  failureCode: string | null;
  attentionMessage: string | null;
  createdAt: string;
};

export type ActivityEntitlement = {
  plan: string;
  canAutomate: boolean;
  message: string | null;
};

export type ActivityAutomation = {
  entitlement: ActivityEntitlement;
  kinds: ["safe_code_drop"];
  templateSemantics: "snapshot_on_schedule";
  timezone: "UTC";
  templates: ActivityTemplate[];
  schedules: ActivitySchedule[];
  comingNext: ActivitySchedule | null;
  needsAttention: ActivitySchedule[];
  announcements: "deferred_communication_not_ready";
};

export type ActivityFoundation = {
  persistence: "existing_workflow_adapter";
  membership: "site_viewers";
  includedTypes: ["drop"];
  challenges: "deferred";
};

export type ActivitiesResponse = {
  ok: true;
  site: {
    id: string;
    name: string;
    slug: string;
  };
  foundation: ActivityFoundation;
  activities: Activity[];
  state: "all" | "open" | "completed";
  page: ActivityPageInfo;
  total: number;
  automation?: ActivityAutomation;
};

export type CloseActivityRequest = {
  siteId: string;
  activityId: string;
};

export type CloseActivityResponse = {
  ok: true;
  activity: Activity;
  changed: boolean;
};

export type CreateCodeDropRequest = {
  siteId: string;
  code: string;
  pointsReward: number;
  maxClaims: number;
  expireMinutes: number;
};

export type CodeDropRecord = {
  id: string;
  code: string;
  points_reward: number;
  max_claims: number;
  claimed_count: number;
  status: "active" | "exhausted" | "expired";
  expires_at: string | null;
  created_at: string;
  automation_occurrence_id: string | null;
};

export type CreateCodeDropResponse = {
  ok: true;
  drop: CodeDropRecord;
  message: string;
};

export type ActivityTemplateWriteRequest = {
  siteId: string;
  kind: "safe_code_drop";
  name: string;
  config: ActivityTemplateConfig;
  templateId?: string;
};

export type ActivityTemplateRecord = {
  id: string;
  kind: "safe_code_drop";
  name: string;
  config: ActivityTemplateConfig;
  created_at: string;
  updated_at: string;
};

export type ActivityTemplateResponse = {
  ok: true;
  template: ActivityTemplateRecord;
};

export type ActivityTemplateDeleteRequest = {
  siteId: string;
  templateId: string;
};

export type ActivityTemplateDeleteResponse = {
  ok: true;
  deleted: true;
};

export type CreateActivityScheduleRequest = {
  siteId: string;
  templateId: string;
  recurrence: ActivityRecurrence;
  runAt: string;
};

export type ResumeActivityScheduleRequest = {
  siteId: string;
  scheduleId: string;
  runAt: string;
};

export type ActivityScheduleRecord = {
  id: string;
  template_id?: string;
  kind?: "safe_code_drop";
  template_name_snapshot?: string;
  config_snapshot?: ActivityTemplateConfig;
  recurrence: ActivityRecurrence;
  next_run_at?: string;
  status: ActivityScheduleStatus;
  created_at?: string;
};

export type ActivityScheduleResponse = {
  ok: true;
  schedule: ActivityScheduleRecord;
};

export type CancelActivityScheduleRequest = {
  siteId: string;
  scheduleId: string;
};

export type BoardShell = {
  activeSiteId?: string | null;
  board?: {
    id?: string | null;
    name?: string | null;
    slug?: string | null;
  } | null;
};
