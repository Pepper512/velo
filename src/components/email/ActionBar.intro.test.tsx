import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The bar touches stores, the router and several services at mount; only
// the follow-up lookup runs on render, so the rest are inert fakes.
vi.mock("@/stores/threadStore", () => ({
  useThreadStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ updateThread: vi.fn(), removeThread: vi.fn() }),
}));
vi.mock("@/stores/accountStore", () => ({
  useAccountStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ activeAccountId: "acc1" }),
}));
vi.mock("@/hooks/useRouteNavigation", () => ({ useActiveLabel: () => "inbox" }));
vi.mock("@/services/emailActions", () => ({ markThreadRead: vi.fn(), starThread: vi.fn() }));
vi.mock("@/hooks/useEmailActions", () => ({
  archiveThread: vi.fn(),
  trashThread: vi.fn(),
  permanentDeleteThread: vi.fn(),
  spamThread: vi.fn(),
}));
vi.mock("@/services/db/threads", () => ({
  deleteThread: vi.fn(),
  pinThread: vi.fn(),
  unpinThread: vi.fn(),
  muteThread: vi.fn(),
  unmuteThread: vi.fn(),
}));
vi.mock("@/services/gmail/draftDeletion", () => ({ deleteDraftsForThread: vi.fn() }));
vi.mock("@/services/snooze/snoozeManager", () => ({ snoozeThread: vi.fn() }));
vi.mock("@/services/gmail/tokenManager", () => ({ getGmailClient: vi.fn() }));
vi.mock("@/services/db/followUpReminders", () => ({
  insertFollowUpReminder: vi.fn(),
  getFollowUpForThread: vi.fn().mockResolvedValue(null),
  cancelFollowUpForThread: vi.fn(),
}));
vi.mock("./SnoozeDialog", () => ({ SnoozeDialog: () => null }));
vi.mock("./FollowUpDialog", () => ({ FollowUpDialog: () => null }));

import { ActionBar } from "./ActionBar";
import type { Thread } from "@/stores/threadStore";
import type { DbMessage } from "@/services/db/messages";

const thread = {
  id: "t1",
  accountId: "acc1",
  subject: "Intro",
  isRead: true,
  isStarred: false,
  isPinned: false,
  isMuted: false,
  labels: [],
} as unknown as Thread;

const message = { id: "m1", thread_id: "t1", from_address: "alice@intro.io" } as unknown as DbMessage;

describe("ActionBar — Instant Intro button (SPEC-II REQ-3.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the button with its key and calls the handler", () => {
    const onInstantIntro = vi.fn();
    render(<ActionBar thread={thread} messages={[message]} onInstantIntro={onInstantIntro} />);
    const button = screen.getByTitle("Instant Intro (b)");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onInstantIntro).toHaveBeenCalledTimes(1);
  });

  it("is disabled and explains why when no intro makes sense", () => {
    const onInstantIntro = vi.fn();
    render(
      <ActionBar
        thread={thread}
        messages={[message]}
        onInstantIntro={onInstantIntro}
        introUnavailableReason="Nobody to introduce you to"
      />,
    );
    const button = screen.getByTitle("Nobody to introduce you to");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onInstantIntro).not.toHaveBeenCalled();
  });

  it("is disabled when the sender does not accept replies", () => {
    render(<ActionBar thread={thread} messages={[message]} noReply onInstantIntro={vi.fn()} />);
    // Reply, Reply All and the intro all carry the reason; before SPEC-II there were two.
    const disabled = screen.getAllByTitle("This sender does not accept replies");
    expect(disabled).toHaveLength(3);
    for (const b of disabled) expect(b).toBeDisabled();
  });
});
