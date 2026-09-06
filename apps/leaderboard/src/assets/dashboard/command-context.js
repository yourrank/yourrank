// Availability is derived at the point of use; search never turns a disabled
// or irrelevant control into an executable command.
export function commandAvailable(id, context) {
  if (id === "act-save") return context.canSave;
  if (id === "act-publish") return context.canPublish;
  if (id === "act-public") return context.live;
  if (id.startsWith("act-obs-")) return context.sharePage && context.live;
  if (id === "act-export-drops") return context.activitiesPage && context.siteSelected;
  if (id === "act-support") return context.hasSupport;
  return true;
}

export const PRIMARY_COMMANDS = new Set([
  "nav-home", "nav-site-settings", "nav-activities", "nav-members",
  "nav-rewards", "nav-analytics", "nav-settings",
]);
