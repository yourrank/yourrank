import type { AccountViewId, ViewerAuthState } from "./types";

type ViewerWindow = Window & {
  YRViewerApp?: {
    navigate?: (href: string) => unknown;
  };
};

type ChromeState = {
  accountPath: string;
  currentView: AccountViewId | "";
  requestedView: AccountViewId | "";
  title: string;
};

export function readViewerAuthState(): ViewerAuthState {
  if (document.body.classList.contains("viewer-auth-authenticated")) return "authenticated";
  if (document.body.classList.contains("viewer-auth-unauthenticated")) return "unauthenticated";
  return "unresolved";
}

function setViewerAuthState(state: ViewerAuthState) {
  document.body.classList.remove(
    "viewer-auth-authenticated",
    "viewer-auth-unauthenticated",
    "viewer-auth-unresolved",
  );
  document.body.classList.add(`viewer-auth-${state}`);
}

function syncViewerNavigation({ currentView, requestedView, title }: ChromeState) {
  const accountLink = document.getElementById("viewer-account-link");
  const communitiesLink = document.getElementById("viewer-communities-link");

  if (currentView) {
    communitiesLink?.removeAttribute("aria-current");
  } else {
    accountLink?.removeAttribute("aria-current");
    communitiesLink?.setAttribute("aria-current", "page");
  }

  document.querySelectorAll<HTMLAnchorElement>(".viewer-destinations a").forEach((link) => {
    if (requestedView && new URL(link.href, window.location.href).hash === `#${requestedView}`) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  const topTitle = document.getElementById("viewer-top-title");
  if (topTitle) topTitle.textContent = title;
}

function setViewerTopName(name: string) {
  const topName = document.getElementById("viewer-top-name");
  if (topName) topName.textContent = name;
}

export function setViewerTopInitial(value: string) {
  const topMark = document.getElementById("viewer-top-mark");
  if (topMark) topMark.textContent = value;
}

export function setViewerTopAvatarImage(src: string) {
  const topMark = document.getElementById("viewer-top-mark");
  if (!topMark) return;

  const image = document.createElement("img");
  image.src = src;
  image.alt = "";
  topMark.replaceChildren(image);
}

export function syncSignedInViewerChrome(name: string, state: ChromeState) {
  setViewerAuthState("authenticated");

  const accountLink = document.getElementById("viewer-account-link");
  if (accountLink) {
    accountLink.setAttribute("href", `${state.accountPath}#vd-profile`);
    accountLink.hidden = false;
  }

  const railLogout = document.getElementById("vd-rail-logout");
  if (railLogout) railLogout.hidden = false;

  setViewerTopName(name);

  const topAvatar = document.getElementById("viewer-top-avatar");
  topAvatar?.setAttribute("aria-label", `Viewer account: ${name}`);
  topAvatar?.setAttribute("title", `Open ${name}'s viewer account`);

  syncViewerNavigation(state);
}

export function syncLoggedOutViewerChrome(state: ChromeState) {
  setViewerAuthState("unauthenticated");

  const railLogout = document.getElementById("vd-rail-logout");
  if (railLogout) railLogout.hidden = true;

  setViewerTopName("Sign in");
  setViewerTopInitial("");
  const topAvatar = document.getElementById("viewer-top-avatar");
  topAvatar?.setAttribute("aria-label", "Sign in to your viewer account");
  topAvatar?.setAttribute("title", "Sign in");

  const accountLink = document.getElementById("viewer-account-link");
  if (accountLink) {
    accountLink.setAttribute("href", `${state.accountPath}#vd-login-card`);
    accountLink.hidden = true;
  }

  const viewerWindow = window as ViewerWindow;
  if (viewerWindow.YRViewerApp) {
    document.querySelector(".viewer-overview")?.replaceChildren();
  }

  syncViewerNavigation(state);
}

export function wireViewerRailLogout(onLogout: () => void) {
  const railLogout = document.getElementById("vd-rail-logout");
  if (!railLogout) return () => {};

  const handleClick = () => onLogout();
  railLogout.addEventListener("click", handleClick);
  return () => railLogout.removeEventListener("click", handleClick);
}

export function navigateToViewerCommunity(href: string) {
  const viewerWindow = window as ViewerWindow;
  if (viewerWindow.YRViewerApp?.navigate) {
    viewerWindow.YRViewerApp.navigate(href);
  } else {
    window.location.href = href;
  }
}
