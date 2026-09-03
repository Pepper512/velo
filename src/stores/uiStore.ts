import { create } from "zustand";
import { setSetting } from "@/services/db/settings";
import type { ColorThemeId } from "@/constants/themes";

type Theme = "light" | "dark" | "system";
type ReadingPanePosition = "right" | "bottom" | "hidden";
type ReadFilter = "all" | "read" | "unread";
export type EmailDensity = "compact" | "default" | "spacious";
export type DefaultReplyMode = "reply" | "replyAll";
export type MarkAsReadBehavior = "instant" | "2s" | "manual";
export type FontScale = "small" | "default" | "large" | "xlarge";
export type InboxViewMode = "unified" | "split";

export interface SidebarNavItem {
  id: string;
  visible: boolean;
}

/** A transient message shown by `NoticeToast`; auto-dismissed after `NOTICE_TTL_MS`. */
export interface Notice {
  id: string;
  text: string;
  action?: { label: string; onClick: () => void | Promise<void> };
}

export const NOTICE_TTL_MS = 6000;

/**
 * F-4 REQ-3.1's hard stop: more than half of a folder's local messages have
 * been confirmed absent on the server twice over. Sync deletes nothing there
 * until a person decides; `ReconcileStopDialog` renders this.
 */
export interface ReconcileStop {
  accountId: string;
  folder: string;
  uidvalidity: number;
  confirmed: number;
  localRows: number;
}

let noticeCounter = 0;
function nextNoticeId(): string {
  noticeCounter += 1;
  return `notice-${Date.now()}-${noticeCounter}`;
}

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  contactSidebarVisible: boolean;
  readingPanePosition: ReadingPanePosition;
  readFilter: ReadFilter;
  emailListWidth: number;
  emailDensity: EmailDensity;
  defaultReplyMode: DefaultReplyMode;
  markAsReadBehavior: MarkAsReadBehavior;
  fontScale: FontScale;
  colorTheme: ColorThemeId;
  sendAndArchive: boolean;
  /** SPEC-AR: a follow-up reminder by default on external sends. On unless turned off. */
  autoRemindersEnabled: boolean;
  /** SPEC-AR: days until the automatic reminder falls due (1, 2, 3 or 7). */
  autoRemindersDays: number;
  inboxViewMode: InboxViewMode;
  taskSidebarVisible: boolean;
  sidebarNavConfig: SidebarNavItem[] | null;
  reduceMotion: boolean;
  isOnline: boolean;
  /** Set when stored credentials could not be decrypted (audit P5). */
  credentialError: string | null;
  pendingOpsCount: number;
  isSyncingFolder: string | null;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleContactSidebar: () => void;
  setContactSidebarVisible: (visible: boolean) => void;
  setReadingPanePosition: (position: ReadingPanePosition) => void;
  setReadFilter: (filter: ReadFilter) => void;
  setEmailListWidth: (width: number) => void;
  setEmailDensity: (density: EmailDensity) => void;
  setDefaultReplyMode: (mode: DefaultReplyMode) => void;
  setMarkAsReadBehavior: (behavior: MarkAsReadBehavior) => void;
  setFontScale: (scale: FontScale) => void;
  setColorTheme: (theme: ColorThemeId) => void;
  setSendAndArchive: (enabled: boolean) => void;
  setAutoRemindersEnabled: (enabled: boolean) => void;
  setAutoRemindersDays: (days: number) => void;
  setInboxViewMode: (mode: InboxViewMode) => void;
  toggleTaskSidebar: () => void;
  setTaskSidebarVisible: (visible: boolean) => void;
  setSidebarNavConfig: (config: SidebarNavItem[]) => void;
  restoreSidebarNavConfig: (config: SidebarNavItem[]) => void;
  setReduceMotion: (reduce: boolean) => void;
  setOnline: (online: boolean) => void;
  setCredentialError: (message: string | null) => void;
  setPendingOpsCount: (count: number) => void;
  setSyncingFolder: (folder: string | null) => void;
  notices: Notice[];
  /** Queue a notice; returns its id. Dismisses itself after `NOTICE_TTL_MS`. */
  addNotice: (input: Omit<Notice, "id">) => string;
  dismissNotice: (id: string) => void;
  /** One entry per `account:folder`; a repeat for the same folder replaces its entry. */
  reconcileStops: ReconcileStop[];
  pushReconcileStop: (stop: ReconcileStop) => void;
  clearReconcileStop: (accountId: string, folder: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: "system",
  sidebarCollapsed: false,
  contactSidebarVisible: true,
  readingPanePosition: "right",
  readFilter: "all",
  emailListWidth: 320,
  emailDensity: "default",
  defaultReplyMode: "reply",
  markAsReadBehavior: "instant",
  fontScale: "default",
  colorTheme: "indigo",
  sendAndArchive: false,
  autoRemindersEnabled: true,
  autoRemindersDays: 3,
  inboxViewMode: "unified",
  taskSidebarVisible: false,
  sidebarNavConfig: null,
  reduceMotion: false,
  isOnline: true,
  credentialError: null,
  pendingOpsCount: 0,
  isSyncingFolder: null,

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () =>
    set((state) => {
      const collapsed = !state.sidebarCollapsed;
      setSetting("sidebar_collapsed", String(collapsed)).catch(() => {});
      return { sidebarCollapsed: collapsed };
    }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleContactSidebar: () =>
    set((state) => {
      const visible = !state.contactSidebarVisible;
      setSetting("contact_sidebar_visible", String(visible)).catch(() => {});
      return { contactSidebarVisible: visible };
    }),
  setContactSidebarVisible: (contactSidebarVisible) => set({ contactSidebarVisible }),
  setReadingPanePosition: (readingPanePosition) => {
    setSetting("reading_pane_position", readingPanePosition).catch(() => {});
    set({ readingPanePosition });
  },
  setReadFilter: (readFilter) => {
    setSetting("read_filter", readFilter).catch(() => {});
    set({ readFilter });
  },
  setEmailListWidth: (emailListWidth) => {
    setSetting("email_list_width", String(emailListWidth)).catch(() => {});
    set({ emailListWidth });
  },
  setEmailDensity: (emailDensity) => {
    setSetting("email_density", emailDensity).catch(() => {});
    set({ emailDensity });
  },
  setDefaultReplyMode: (defaultReplyMode) => {
    setSetting("default_reply_mode", defaultReplyMode).catch(() => {});
    set({ defaultReplyMode });
  },
  setMarkAsReadBehavior: (markAsReadBehavior) => {
    setSetting("mark_as_read_behavior", markAsReadBehavior).catch(() => {});
    set({ markAsReadBehavior });
  },
  setFontScale: (fontScale) => {
    setSetting("font_size", fontScale).catch(() => {});
    set({ fontScale });
  },
  setColorTheme: (colorTheme) => {
    setSetting("color_theme", colorTheme).catch(() => {});
    set({ colorTheme });
  },
  setSendAndArchive: (sendAndArchive) => {
    setSetting("send_and_archive", String(sendAndArchive)).catch(() => {});
    set({ sendAndArchive });
  },
  setAutoRemindersEnabled: (autoRemindersEnabled) => {
    setSetting("auto_reminders_enabled", String(autoRemindersEnabled)).catch(() => {});
    set({ autoRemindersEnabled });
  },
  setAutoRemindersDays: (autoRemindersDays) => {
    setSetting("auto_reminders_days", String(autoRemindersDays)).catch(() => {});
    set({ autoRemindersDays });
  },
  setInboxViewMode: (inboxViewMode) => {
    setSetting("inbox_view_mode", inboxViewMode).catch(() => {});
    set({ inboxViewMode });
  },
  toggleTaskSidebar: () =>
    set((state) => {
      const visible = !state.taskSidebarVisible;
      setSetting("task_sidebar_visible", String(visible)).catch(() => {});
      return { taskSidebarVisible: visible };
    }),
  setTaskSidebarVisible: (taskSidebarVisible) => set({ taskSidebarVisible }),
  setSidebarNavConfig: (sidebarNavConfig) => {
    setSetting("sidebar_nav_config", JSON.stringify(sidebarNavConfig)).catch(() => {});
    set({ sidebarNavConfig });
  },
  restoreSidebarNavConfig: (sidebarNavConfig) => set({ sidebarNavConfig }),
  setReduceMotion: (reduceMotion) => {
    setSetting("reduce_motion", String(reduceMotion)).catch(() => {});
    set({ reduceMotion });
  },
  setOnline: (isOnline) => set({ isOnline }),
  setCredentialError: (credentialError) => set({ credentialError }),
  setPendingOpsCount: (pendingOpsCount) => set({ pendingOpsCount }),
  setSyncingFolder: (isSyncingFolder) => set({ isSyncingFolder }),
  notices: [],
  addNotice: (input) => {
    const id = nextNoticeId();
    set((state) => ({ notices: [...state.notices, { ...input, id }] }));
    setTimeout(() => {
      set((state) => ({ notices: state.notices.filter((n) => n.id !== id) }));
    }, NOTICE_TTL_MS);
    return id;
  },
  dismissNotice: (id) =>
    set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  reconcileStops: [],
  pushReconcileStop: (stop) =>
    set((state) => ({
      reconcileStops: [
        ...state.reconcileStops.filter(
          (s) => !(s.accountId === stop.accountId && s.folder === stop.folder),
        ),
        stop,
      ],
    })),
  clearReconcileStop: (accountId, folder) =>
    set((state) => ({
      reconcileStops: state.reconcileStops.filter(
        (s) => !(s.accountId === accountId && s.folder === folder),
      ),
    })),
}));
