export const UNKNOWN = "—";

export const STATE_VOCABULARY = Object.freeze({
  loading: { title: "Loading…", body: "This panel is still loading." },
  error: { title: "Couldn't load this panel", body: "Try again to reload it." },
  empty: { title: "Nothing here yet", body: "This will fill in once there is activity." },
  setup: { title: "Connection needed", body: "Connect the required service to start using this panel." },
  locked: { title: "Plan limit reached", body: "Upgrade your plan to continue." },
  verification: { title: "Verification needed", body: "Confirm your email to continue." },
});

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

const ICONS = {
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M3 6h18"/><path d="M5 6v14h14V6"/><path d="M8 6V3h8v3"/><path d="M9 10h6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 3-4 3 2 4-6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><circle cx="9" cy="7" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M22 21a7 7 0 0 0-5-6.71"/></svg>',
};

export function emptyStateHtml({ icon = "chart", title, body, actions = [] }) {
  const iconHtml = ICONS[icon] || icon || ICONS.chart;
  const actionHtml = actions.length
    ? `<div class="v3-empty-actions">${actions.map((action) => {
      const tag = action.href ? "a" : "button";
      const attrs = action.href
        ? `href="${esc(action.href)}"`
        : `type="button"${action.id ? ` id="${esc(action.id)}"` : ""}`;
      return `<${tag} class="v3-btn${action.accent ? " v3-btn--accent" : ""}" ${attrs}>${esc(action.label)}</${tag}>`;
    }).join("")}</div>`
    : "";
  return `<div class="v3-empty"><span class="v3-empty-ic">${iconHtml}</span><h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ""}${actionHtml}</div>`;
}

export function inlineStateHtml({ kind = "empty", title, body, actions = [] } = {}) {
  const copy = STATE_VOCABULARY[kind] || STATE_VOCABULARY.empty;
  const action = actions[0];
  const actionHtml = action
    ? action.href
      ? `<a class="v3-btn v3-btn--sm${action.accent ? " v3-btn--accent" : ""}" href="${esc(action.href)}">${esc(action.label)}</a>`
      : `<button class="v3-btn v3-btn--sm${action.accent ? " v3-btn--accent" : ""}" type="button"${action.id ? ` id="${esc(action.id)}"` : ""}>${esc(action.label)}</button>`
    : "";
  return `<div class="v3-state-inline" data-state="${esc(kind)}" role="${kind === "error" ? "alert" : "status"}"><span class="v3-state-inline-copy"><b>${esc(title || copy.title)}</b>${body || copy.body ? `<span>${esc(body || copy.body)}</span>` : ""}</span>${actionHtml}</div>`;
}

export function renderInlineState(el, spec = {}) {
  if (!el) return;
  el.removeAttribute("aria-busy");
  el.innerHTML = inlineStateHtml(spec);
  el.hidden = false;
  const action = el.querySelector("button[id]");
  if (action && spec.actions?.[0]?.onClick) action.addEventListener("click", spec.actions[0].onClick, { once: true });
}

export function metricText(status, value) {
  return status === "loading" ? "" : status === "ready" ? String(value ?? UNKNOWN) : UNKNOWN;
}

export function setMetricLoading(el) {
  if (!el) return;
  el.setAttribute("aria-busy", "true");
  el.removeAttribute("data-metric-unavailable");
  el.removeAttribute("title");
  el.innerHTML = '<span class="skeleton v3-skel-kpi" aria-hidden="true"></span>';
}

export function setMetricValue(el, text) {
  if (!el) return;
  el.removeAttribute("aria-busy");
  el.removeAttribute("data-metric-unavailable");
  el.removeAttribute("title");
  el.textContent = metricText("ready", text);
}

// A KPI has three distinct non-value states and they must never share copy:
// the panel loaded and the number really is zero, the panel failed to load, or
// the feature behind it is not connected. "—" is only honest for the last two.
const METRIC_UNAVAILABLE_COPY = Object.freeze({
  error: "Couldn't load this stat. Reload the page to try again.",
  setup: "Not connected yet, so there is nothing to measure.",
});

/** The panel loaded and the real number is zero: show the zero, say why it is zero. */
export function setMetricEmpty(el, { value = "0", note = "No activity in this period yet." } = {}) {
  if (!el) return;
  el.removeAttribute("aria-busy");
  el.removeAttribute("data-metric-unavailable");
  el.setAttribute("data-metric-empty", "true");
  el.title = note;
  el.textContent = String(value);
}

/**
 * The value is genuinely unknown. `reason` picks the copy: "error" (the request
 * failed) or "setup" (the feature is not connected). Never used for real zeros.
 */
export function setMetricUnknown(el, reason = "error") {
  if (!el) return;
  el.removeAttribute("aria-busy");
  el.removeAttribute("data-metric-empty");
  el.setAttribute("data-metric-unavailable", reason);
  el.title = METRIC_UNAVAILABLE_COPY[reason] || METRIC_UNAVAILABLE_COPY.error;
  el.innerHTML = `<span class="metric-unavailable" aria-label="${reason === "setup" ? "Not connected" : "Couldn't load"}">${UNKNOWN}</span>`;
}

export function setRowsLoading(tbody, { cols = 1, rows = 3 } = {}) {
  if (!tbody) return;
  tbody.setAttribute("aria-busy", "true");
  tbody.innerHTML = Array.from({ length: rows }, () =>
    `<tr aria-hidden="true">${Array.from({ length: cols }, () => '<td><span class="skeleton v3-skel-cell"></span></td>').join("")}</tr>`
  ).join("");
}

export function setBlockLoading(el, { lines = 3 } = {}) {
  if (!el) return;
  el.setAttribute("aria-busy", "true");
  el.innerHTML = Array.from({ length: lines }, () => '<span class="skeleton v3-skel-line"></span>').join("");
}

export function setBlockReady(el) {
  if (!el) return;
  el.removeAttribute("aria-busy");
}

export function renderError(el, { title = "Couldn't load this panel", body = "Try again to reload it.", retry, retryLabel = "Try again" } = {}) {
  if (!el) return;
  el.removeAttribute("aria-busy");
  el.setAttribute("role", "alert");
  el.innerHTML = emptyStateHtml({
    icon: "chart",
    title,
    body,
    actions: retry ? [{ label: retryLabel, id: "stateRetry", accent: true }] : [],
  });
  el.hidden = false;
  if (retry) el.querySelector("#stateRetry")?.addEventListener("click", retry, { once: true });
}

export function renderEmpty(el, spec) {
  if (!el) return;
  el.removeAttribute("aria-busy");
  el.innerHTML = spec?.compactHeading ? compactHeadingHtml(spec) : spec?.compact ? inlineStateHtml(spec) : emptyStateHtml(spec);
  el.hidden = false;
}

function compactHeadingHtml({ title, body, actions = [] } = {}) {
  const actionHtml = actions.length
    ? `<div class="v3-empty-actions">${actions.map((action) => {
      const tag = action.href ? "a" : "button";
      const attrs = action.href
        ? `href="${esc(action.href)}"`
        : `type="button"${action.id ? ` id="${esc(action.id)}"` : ""}`;
      return `<${tag} class="v3-btn${action.accent ? " v3-btn--accent" : ""}" ${attrs}>${esc(action.label)}</${tag}>`;
    }).join("")}</div>`
    : "";
  return `<div class="v3-empty v3-empty--compact-heading"><h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ""}${actionHtml}</div>`;
}
