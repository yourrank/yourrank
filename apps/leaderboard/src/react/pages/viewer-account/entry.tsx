import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ViewerAccountPage, type ViewerAccountPageProps } from "./page";

export function mountViewerAccount(container: HTMLElement, props: ViewerAccountPageProps): Root {
  const root = createRoot(container);
  flushSync(() => {
    root.render(createElement(ViewerAccountPage, props));
  });
  return root;
}
