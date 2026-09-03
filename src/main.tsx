import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import ThreadWindow from "./ThreadWindow";
import ComposerWindow from "./ComposerWindow";
import "./styles/globals.css";
import { windowKindFromSearch } from "./utils/windowKind";

// One rule for which window this is, shared with the components that hide
// "Open in new window" inside a pop-out (SPEC-P11).
const windowKind = windowKindFromSearch(window.location.search);

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
