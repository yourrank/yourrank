export function serializeWebhookUrl(value, configured) {
  const url = String(value || "").trim();
  return url || (configured ? undefined : "");
}

export async function runNotificationTest({ button, status, request, toast }) {
  const setStatus = (message) => {
    if (status) status.textContent = message;
  };
  if (button?.getAttribute("aria-disabled") === "true") {
    const message = "Notifications are a Pro feature. Upgrade to unlock.";
    setStatus(message);
    toast?.(message, "error");
    return;
  }

  setStatus("Sending…");
  try {
    const response = await request();
    const data = await response.json().catch(() => null);
    const sent = response.ok && data?.ok === true;
    const message = sent ? "✅ Sent!" : data?.error || `Server error (HTTP ${response.status})`;
    setStatus(message);
    toast?.(sent ? "Test notification sent." : message, sent ? "success" : "error");
  } catch {
    const message = "Network error.";
    setStatus(message);
    toast?.(message, "error");
  }
}
