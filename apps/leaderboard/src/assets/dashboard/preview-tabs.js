// Device switcher for every live preview (leaderboard editor and Site settings).
// The preview renderer reads the active tab's data-device/data-width attributes,
// so this controller owns the accessible tab state and asks the existing refresh
// path to re-render and re-fit the frame.

function refreshPreview() {
  // Load lazily so the controller can be used independently of dashboard boot
  // timing and does not make the page wait on preview code before the tabs work.
  return import("./site.js").then(({ refreshDesignPreview }) => refreshDesignPreview());
}

function setupPreviewTabs() {
  for (const tablist of document.querySelectorAll('.preview-tabs[role="tablist"]')) {
    wireTablist(tablist);
  }
}

function wireTablist(tablist) {
  if (!tablist || tablist._previewTabsWired) return;
  const tabs = [...tablist.querySelectorAll(".preview-tab")];
  if (!tabs.length) return;
  tablist._previewTabsWired = true;

  const setActive = (next) => {
    if (!next || !tabs.includes(next)) return;
    tabs.forEach((tab) => {
      const active = tab === next;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    refreshPreview();
  };

  tablist.addEventListener("click", (event) => {
    const tab = event.target.closest(".preview-tab");
    if (!tab || !tabs.includes(tab)) return;
    event.preventDefault();
    setActive(tab);
  });

  tablist.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let nextIndex = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    next.focus();
    setActive(next);
  });

  setActive(tabs.find((tab) => tab.classList.contains("is-active")) || tabs[0]);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupPreviewTabs, { once: true });
else setupPreviewTabs();

export { setupPreviewTabs };
