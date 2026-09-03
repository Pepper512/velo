import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import ThreadWindow from "./ThreadWindow";
import ComposerWindow from "./ComposerWindow";
import "./styles/globals.css";
import { currentWindowKind } from "./utils/windowKind";

// One rule for which window this is — by the window label inside Tauri, which
// is what the capability grant is keyed by — shared with the components that
// hide "Open in new window" inside a pop-out (SPEC-P11).
const windowKind = currentWindowKind();
if (windowKind === "unknown") {
  // A label this code does not route. It gets the main root so the page is
  // not blank, but it holds no capability grant (SPEC-P11), so it will fail
  // loudly on its first plugin call — which is the right failure.
  console.warn("[main] Unknown window label; rendering the main root without a grant");
}

function Root() {
  if (windowKind === "thread") return <ThreadWindow />;
  if (windowKind === "compose") return <ComposerWindow />;
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
