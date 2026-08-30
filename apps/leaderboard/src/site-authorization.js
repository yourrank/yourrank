import { bad } from "./auth.js";
import {
  hasSiteCapability,
  getSiteRole as defaultGetSiteRole,
} from "@yourrank/shared/team";

export async function requireSiteCapability(
  user,
  site,
  capability,
  { getSiteRole = defaultGetSiteRole } = {}
) {
  if (!site) return { role: null, res: bad("Site not found.", 404) };
  const role = site.user_id === user.id ? "owner" : await getSiteRole(site.id, user.id);
  if (!hasSiteCapability(role, capability)) {
    return {
      role,
      res: bad(`Your ${role || "account"} role is not permitted to perform this action.`, 403),
    };
  }
  return { role, res: null };
}
