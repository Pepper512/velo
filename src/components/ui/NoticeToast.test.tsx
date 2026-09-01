import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { NoticeToast } from "./NoticeToast";
import { useUIStore } from "@/stores/uiStore";

/** SPEC-F-2 design §3b: a minimal, reusable notice toast fed by `uiStore.notices`. */
describe("NoticeToast", () => {
  beforeEach(() => {
    useUIStore.setState({ notices: [] });
  });

  it("renders nothing when there are no notices", () => {
    const { container } = render(<NoticeToast />);
    expect(container.querySelector("[role='status']")).toBeNull();
  });

  it("shows the newest notice text and its action, and runs the action on click", async () => {
    const onClick = vi.fn();
    render(<NoticeToast />);
    act(() => {
      useUIStore.getState().addNotice({ text: "Couldn't open link — example.com", action: { label: "Copy link", onClick } });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't open link — example.com");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("dismisses a notice when its close button is clicked", () => {
    render(<NoticeToast />);
    act(() => {
      useUIStore.getState().addNotice({ text: "hello" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(useUIStore.getState().notices).toHaveLength(0);
  });
});
