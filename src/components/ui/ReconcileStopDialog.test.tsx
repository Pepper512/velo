import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import { ReconcileStopDialog } from "./ReconcileStopDialog";

vi.mock("@/services/imap/reconcilePass", () => ({
  deleteConfirmedAfterUserApproval: vi.fn(async () => 15),
}));

import { deleteConfirmedAfterUserApproval } from "@/services/imap/reconcilePass";

/** SPEC-F-4 REQ-3.1 — the stop is a human decision, rendered one folder at a time. */
describe("ReconcileStopDialog", () => {
  const stop = { accountId: "acc-1", folder: "INBOX", uidvalidity: 7, confirmed: 15, localRows: 20 };

  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ reconcileStops: [], notices: [] });
  });

  it("renders nothing when no folder is stopped", () => {
    const { container } = render(<ReconcileStopDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the folder and the numbers, and offers delete or keep", () => {
    useUIStore.setState({ reconcileStops: [stop] });
    render(<ReconcileStopDialog />);
    expect(screen.getByText("INBOX: 15 of 20 messages are gone from the server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete them" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep them" })).toBeInTheDocument();
  });

  it("'Delete them' removes the confirmed rows for that folder and clears the stop", async () => {
    useUIStore.setState({ reconcileStops: [stop] });
    render(<ReconcileStopDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Delete them" }));

    await waitFor(() => expect(useUIStore.getState().reconcileStops).toEqual([]));
    expect(deleteConfirmedAfterUserApproval).toHaveBeenCalledWith("acc-1", "INBOX", 7);
    expect(useUIStore.getState().notices[0]?.text).toContain("Removed 15 messages from INBOX");
  });

  it("'Keep them' deletes nothing and clears only this folder's stop", () => {
    const other = { ...stop, folder: "Sent", confirmed: 8, localRows: 12 };
    useUIStore.setState({ reconcileStops: [stop, other] });
    render(<ReconcileStopDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Keep them" }));

    expect(deleteConfirmedAfterUserApproval).not.toHaveBeenCalled();
    expect(useUIStore.getState().reconcileStops).toEqual([other]);
  });

  it("ignores a close while the deletion is running (Grok H6c)", async () => {
    let finish!: (n: number) => void;
    vi.mocked(deleteConfirmedAfterUserApproval).mockImplementationOnce(
      () => new Promise<number>((resolve) => { finish = resolve; }),
    );
    useUIStore.setState({ reconcileStops: [stop] });
    render(<ReconcileStopDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Delete them" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep them" }));
    expect(useUIStore.getState().reconcileStops).toEqual([stop]);

    finish(15);
    await waitFor(() => expect(useUIStore.getState().reconcileStops).toEqual([]));
  });

  it("a failed deletion leaves nothing changed, says so, and keeps the dialog open for a retry", async () => {
    vi.mocked(deleteConfirmedAfterUserApproval).mockRejectedValueOnce(new Error("DB busy"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    useUIStore.setState({ reconcileStops: [stop] });
    render(<ReconcileStopDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Delete them" }));

    await waitFor(() => expect(useUIStore.getState().notices[0]?.text).toContain("nothing was changed"));
    expect(useUIStore.getState().reconcileStops).toEqual([stop]);
    expect(screen.getByRole("button", { name: "Delete them" })).toBeInTheDocument();
  });
});
