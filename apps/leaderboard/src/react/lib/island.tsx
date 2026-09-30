import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

export function defineIsland<Props extends object = Record<string, never>>(
  rootId: string,
  Component: ComponentType<Props>,
  getProps: () => Props = () => ({} as Props),
) {
  let root: Root | null = null;

  function enter() {
    const element = document.getElementById(rootId);
    if (!element || root) return;
    root = createRoot(element);
    root.render(createElement(Component, getProps()));
  }

  function leave() {
    const current = root;
    root = null;
    current?.unmount();
  }

  return { enter, leave };
}
