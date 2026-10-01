export type AdminStats = {
  users: number;
  paid: number;
  leads: number;
  revenue: number;
};

export type AdminUser = {
  id: string;
  email: string;
  slug?: string | null;
  plan?: string | null;
  plan_expires_at?: number | string | null;
  is_admin?: boolean;
  status: string;
  totp_enabled?: boolean;
  totp_locked_until?: number | string | null;
  player_count?: number | null;
  created_at?: number | string | null;
  suspension_reason?: string | null;
};

export type AdminLead = {
  id?: string;
  handle?: string | null;
  brand?: string | null;
  contact?: string | null;
  note?: string | null;
  created_at?: number | string | null;
};

export type AdminPayment = {
  id?: string;
  user_id?: string | null;
  email?: string | null;
  provider?: string | null;
  amount_usd?: number | string | null;
  status: string;
  created_at?: number | string | null;
};

export type SupportMessage = {
  id: string;
  created_at?: number | string | null;
  name?: string | null;
  email?: string | null;
  subject?: string | null;
  message?: string | null;
  reply?: string | null;
  replied_at?: number | string | null;
};

export type FeatureFlag = {
  key: string;
  name?: string | null;
  description?: string | null;
  defaultValue?: boolean;
};

export type AuditEvent = {
  id?: string;
  created_at?: number | string | null;
  actor_email?: string | null;
  action: string;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
};

export type AdminIdentity = {
  company_name?: string | null;
  company_country?: string | null;
  company_number?: string | null;
  support_email?: string | null;
  affiliate_disclosure?: string | null;
  complete?: boolean;
};

export type PageData = {
  total?: number;
  pageSize?: number;
};

export type AdminPageDependencies = {
  navigate?: (path: string) => void;
  fetcher?: typeof fetch;
};

export type AdminPageProps = {
  dependencies?: AdminPageDependencies;
};
