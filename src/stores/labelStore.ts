import { create } from "zustand";
import { getLabelsForAccount, deleteLabel as dbDeleteLabel, updateLabelSortOrder } from "@/services/db/labels";
import { upsertLabel } from "@/services/db/labels";
import { getUnreadCountsByLabel } from "@/services/db/threads";
import { getGmailClient } from "@/services/gmail/tokenManager";

export interface Label {
  id: string;
  accountId: string;
  name: string;
  type: string;
  colorBg: string | null;
  colorFg: string | null;
  sortOrder: number;
}

// System labels that are already shown as nav items in the sidebar
const SYSTEM_LABEL_IDS = new Set([
  "INBOX",
  "SENT",
  "DRAFT",
  "TRASH",
  "SPAM",
  "STARRED",
  "UNREAD",
  "IMPORTANT",
  "SNOOZED",
  "CHAT",
]);

const CATEGORY_PREFIX = "CATEGORY_";

export function isSystemLabel(id: string): boolean {
  return SYSTEM_LABEL_IDS.has(id) || id.startsWith(CATEGORY_PREFIX);
}

interface LabelState {
  labels: Label[];
  isLoading: boolean;
  /** Unread threads by label id for the active account (SPEC-243); absent = 0. */
  unreadCounts: Record<string, number>;
  loadLabels: (accountId: string) => Promise<void>;
  /** Re-query every label's unread count in one statement. Keeps the old map on failure. */
  refreshUnreadCounts: (accountId: string) => Promise<void>;
  clearLabels: () => void;
  createLabel: (accountId: string, name: string, color?: { textColor: string; backgroundColor: string }) => Promise<void>;
  updateLabel: (accountId: string, labelId: string, updates: { name?: string; color?: { textColor: string; backgroundColor: string } | null }) => Promise<void>;
  deleteLabel: (accountId: string, labelId: string) => Promise<void>;
  reorderLabels: (accountId: string, labelIds: string[]) => Promise<void>;
}

/** Sequence of `refreshUnreadCounts` calls; only the newest may set state. */
let unreadRefreshSeq = 0;

export const useLabelStore = create<LabelState>((set, get) => ({
  labels: [],
  isLoading: false,
  unreadCounts: {},

  refreshUnreadCounts: async (accountId: string) => {
    // Latest request wins: a refresh for the previous account (or an earlier
    // one for this account) that resolves late must not overwrite a newer map
    // (#63 review, Gemini M2).
    const seq = ++unreadRefreshSeq;
    try {
      const unreadCounts = await getUnreadCountsByLabel(accountId);
      if (seq !== unreadRefreshSeq) return;
      set({ unreadCounts });
    } catch (err) {
      console.error("Failed to refresh label unread counts:", err);
    }
  },

  loadLabels: async (accountId: string) => {
    set({ isLoading: true });
    try {
      const dbLabels = await getLabelsForAccount(accountId);
      const labels: Label[] = dbLabels
        .filter((l) => !isSystemLabel(l.id))
        .map((l) => ({
          id: l.id,
          accountId: l.account_id,
          name: l.name,
          type: l.type,
          colorBg: l.color_bg,
          colorFg: l.color_fg,
          sortOrder: l.sort_order,
        }));
      set({ labels, isLoading: false });
    } catch (err) {
      console.error("Failed to load labels:", err);
      set({ isLoading: false });
    }
  },

  clearLabels: () => set({ labels: [], isLoading: false, unreadCounts: {} }),

  createLabel: async (accountId: string, name: string, color?: { textColor: string; backgroundColor: string }) => {
    const client = await getGmailClient(accountId);
    const gmailLabel = await client.createLabel(name, color);
    await upsertLabel({
      id: gmailLabel.id,
      accountId,
      name: gmailLabel.name,
      type: gmailLabel.type,
      colorBg: gmailLabel.color?.backgroundColor ?? null,
      colorFg: gmailLabel.color?.textColor ?? null,
    });
    await get().loadLabels(accountId);
  },

  updateLabel: async (accountId: string, labelId: string, updates: { name?: string; color?: { textColor: string; backgroundColor: string } | null }) => {
    const client = await getGmailClient(accountId);
    const gmailLabel = await client.updateLabel(labelId, updates);
    await upsertLabel({
      id: gmailLabel.id,
      accountId,
      name: gmailLabel.name,
      type: gmailLabel.type,
      colorBg: gmailLabel.color?.backgroundColor ?? null,
      colorFg: gmailLabel.color?.textColor ?? null,
    });
    await get().loadLabels(accountId);
  },

  deleteLabel: async (accountId: string, labelId: string) => {
    const client = await getGmailClient(accountId);
    await client.deleteLabel(labelId);
    await dbDeleteLabel(accountId, labelId);
    await get().loadLabels(accountId);
  },

  reorderLabels: async (accountId: string, labelIds: string[]) => {
    const labelOrders = labelIds.map((id, index) => ({ id, sortOrder: index }));
    await updateLabelSortOrder(accountId, labelOrders);
    await get().loadLabels(accountId);
  },
}));
