import { getLogger, type Logger } from "./request-id.js";
import type { DashboardRouteId, DashboardWorker } from "./dashboard-routes.js";

export const LEGACY_DASHBOARD_REDIRECT_EVENT = "dashboard_legacy_redirect";

export interface LegacyDashboardRedirectEvent {
  readonly alias: string;
  readonly route_id: DashboardRouteId;
  readonly status: 301 | 302;
  readonly served_by: DashboardWorker;
  readonly source: "path_alias" | "nav_query";
}

/** Fire-and-forget redirect telemetry that never affects the response. */
export function logLegacyDashboardRedirect(
  event: LegacyDashboardRedirectEvent,
  logger?: Pick<Logger, "info">,
): void {
  try {
    (logger ?? getLogger()).info(LEGACY_DASHBOARD_REDIRECT_EVENT, {
      alias: event.alias,
      route_id: event.route_id,
      status: event.status,
      served_by: event.served_by,
      source: event.source,
    });
  } catch {
    // Logging must never change redirect behavior.
  }
}
