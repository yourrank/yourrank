/**
 * @typedef {Object} DeliveryState
 * @property {boolean} [verified]
 * @property {Record<string, string>} [events]
 * @property {string[]} [required]
 * @property {string[]} [requiredLabels]
 */

/**
 * @param {{connected?: boolean, deliveryFailed?: boolean, status?: string, delivery?: DeliveryState | null}} [options]
 */
export function kickDeliveryPresentation({ connected = false, deliveryFailed = false, status = "", delivery = null } = {}) {
  if (!connected) return { label: "—", detail: "" };
  if (deliveryFailed) return { label: "Setup failed", detail: "" };
  if (status === "needs_attention") return { label: "Blocked by authorization", detail: "" };
  if (delivery?.verified) return { label: "Verified", detail: "" };

  const events = delivery?.events || {};
  if (!Object.values(events).some((event) => event === "subscribed")) {
    return { label: "Waiting for first event", detail: "" };
  }
  const firstUnverifiedIndex = (delivery?.required || []).findIndex((event) => events[event] !== "subscribed");
  const requiredLabel = delivery?.requiredLabels?.[firstUnverifiedIndex];
  const detail = requiredLabel ? `Waiting for the first ${requiredLabel}` : "";
  return { label: "Receiving events", detail };
}
