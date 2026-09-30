import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { HomePage } from "./page";
import type { HomeActions, HomeViewModel } from "./types";

type HomeRoot = HTMLElement & { _openOverviewBrandDialog?: () => void };

const roots = new WeakMap<Element, Root>();

export function renderHome(root: Element, vm: HomeViewModel, actions: HomeActions) {
  const element = root as HomeRoot;
  let reactRoot = roots.get(root);
  if (!reactRoot) {
    reactRoot = createRoot(root);
    roots.set(root, reactRoot);
  }
  flushSync(() => {
    reactRoot.render(React.createElement(HomePage, { root: element, vm, actions }));
  });
}

export function unmountHome(root: Element) {
  const reactRoot = roots.get(root);
  if (!reactRoot) return;
  reactRoot.unmount();
  roots.delete(root);
  delete (root as HomeRoot)._openOverviewBrandDialog;
}
