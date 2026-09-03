import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { CSSTransition } from "react-transition-group";
import { ThreadCard } from "../email/ThreadCard";
import { CategoryTabs } from "../email/CategoryTabs";
import { SearchBar } from "../search/SearchBar";
import { EmailListSkeleton } from "../ui/Skeleton";
import { useThreadStore, type Thread } from "@/stores/threadStore";
import { threadMessageCache, type PrefetchJob } from "@/services/threads/messageCache";
import { prefetchOrder, joinIds, splitIds, PREFETCH_DELAY_MS } from "@/services/threads/neighbours";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildListItems, type ListItem } from "@/services/inbox/listItems";
import { useAccountStore } from "@/stores/accountStore";
import { useUIStore } from "@/stores/uiStore";
import { useActiveLabel, useSelectedThreadId, useActiveCategory } from "@/hooks/useRouteNavigation";
import { navigateToThread, navigateToLabel } from "@/router/navigate";
import { getThreadsForAccount, getThreadsForCategory, getInboxThreadsForLabel, getThreadsWithPendingReminders, getThreadLabelIds, deleteThread as deleteThreadFromDb } from "@/services/db/threads";
import { getCategoriesForThreads } from "@/services/db/threadCategories";
import { getSplitTabCounts } from "@/services/db/splitTabCounts";
import { visibleSplitTabs, resolveActiveTab, type TabCount, type LabelInfo } from "@/services/inbox/splitTabs";
import { getActiveFollowUpThreadIds } from "@/services/db/followUpReminders";
import { getBundleRules, getHeldThreadIds, getBundleSummaries, type DbBundleRule } from "@/services/db/bundleRules";
import { getGmailClient } from "@/services/gmail/tokenManager";
import { useLabelStore } from "@/stores/labelStore";
import { useSmartFolderStore } from "@/stores/smartFolderStore";
import { useContextMenuStore } from "@/stores/contextMenuStore";
import { useComposerStore } from "@/stores/composerStore";
import { getMessagesForThread } from "@/services/db/messages";
import { getSmartFolderSearchQuery, mapSmartFolderRows, type SmartFolderRow } from "@/services/search/smartFolderQuery";
import { getDb } from "@/services/db/connection";
import { Archive, Trash2, X, Ban, Funnel, ChevronRight, Package, FolderSearch } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";
import {
  InboxClearIllustration,
  NoSearchResultsIllustration,
  NoAccountIllustration,
  GenericEmptyIllustration,
} from "../ui/illustrations";

const PAGE_SIZE = 50;

/** Which list is on screen — the key the stagger set and the scroll latch hang off. */
function folderKeyOf(accountId: string | null, label: string, category: string): string {
  return `${accountId ?? ""}|${label}|${category}`;
}

// Map sidebar labels to Gmail label IDs
const LABEL_MAP: Record<string, string> = {
  inbox: "INBOX",
  starred: "STARRED",
  sent: "SENT",
  drafts: "DRAFT",
  trash: "TRASH",
  spam: "SPAM",
  snoozed: "SNOOZED",
  all: "", // no filter
};

/**
 * SPEC-SIT: the threads a split-inbox tab lists — a category (INBOX ∩
 * category, Primary including uncategorised), a label (INBOX ∩ label), or
 * Reminders (every thread with a pending follow-up reminder).
 */
function loadTabThreads(accountId: string, tabId: string, limit: number, offset: number) {
  if (tabId === "reminders") return getThreadsWithPendingReminders(accountId, limit, offset);
  if (tabId.startsWith("label:")) return getInboxThreadsForLabel(accountId, tabId.slice("label:".length), limit, offset);
  return getThreadsForCategory(accountId, tabId, limit, offset);
}

export function EmailList({ width, listRef }: { width?: number; listRef?: React.Ref<HTMLDivElement> }) {
  const threads = useThreadStore((s) => s.threads);
  const selectedThreadId = useSelectedThreadId();
  const selectedThreadIds = useThreadStore((s) => s.selectedThreadIds);
  const isLoading = useThreadStore((s) => s.isLoading);
  const setThreads = useThreadStore((s) => s.setThreads);
  const setLoading = useThreadStore((s) => s.setLoading);
  const removeThreads = useThreadStore((s) => s.removeThreads);
  const clearMultiSelect = useThreadStore((s) => s.clearMultiSelect);
  const selectAll = useThreadStore((s) => s.selectAll);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const activeLabel = useActiveLabel();
  const readFilter = useUIStore((s) => s.readFilter);
  const setReadFilter = useUIStore((s) => s.setReadFilter);
  const readingPanePosition = useUIStore((s) => s.readingPanePosition);
  const emailDensity = useUIStore((s) => s.emailDensity);
  const threadMap = useThreadStore((s) => s.threadMap);
  const userLabels = useLabelStore((s) => s.labels);
  const smartFolders = useSmartFolderStore((s) => s.folders);

  // Detect smart folder mode
  const isSmartFolder = activeLabel.startsWith("smart-folder:");
  const smartFolderId = isSmartFolder ? activeLabel.replace("smart-folder:", "") : null;
  const activeSmartFolder = smartFolderId ? smartFolders.find((f) => f.id === smartFolderId) ?? null : null;

  const inboxViewMode = useUIStore((s) => s.inboxViewMode);
  const splitInboxTabs = useUIStore((s) => s.splitInboxTabs);
  const routerCategory = useActiveCategory();
  const [tabCounts, setTabCounts] = useState<Map<string, TabCount>>(() => new Map());

  // Counts belong to one account: drop them the moment the account changes,
  // before the refresh lands, so the previous account's totals cannot hide or
  // count a tab here (Grok M3 on #87).
  useEffect(() => {
    setTabCounts(new Map());
  }, [activeAccountId]);

  // SPEC-SIT: the tabs to draw — configured tabs, minus label tabs this
  // account does not have and hide-when-empty tabs with nothing in them.
  // `userLabels` is the active account's labels: the label store replaces its
  // list from `getLabelsForAccount` on every account switch (REQ-2.5). The
  // tab the router asks for is never hidden.
  const visibleTabs = useMemo(() => {
    if (inboxViewMode !== "split") return [];
    const labelsById = new Map<string, LabelInfo>(
      userLabels.map((l) => [l.id, { name: l.name, color: l.colorBg }]),
    );
    return visibleSplitTabs(splitInboxTabs, { labelsById, counts: tabCounts, keep: routerCategory });
  }, [inboxViewMode, splitInboxTabs, userLabels, tabCounts, routerCategory]);

  // In split mode the router asks for a tab and the visible set decides
  // (REQ-3.2); in unified mode it is always "All".
  const activeCategory = inboxViewMode === "split" ? resolveActiveTab(visibleTabs, routerCategory) : "All";
  const setActiveCategory = inboxViewMode === "split"
    ? (cat: string) => navigateToLabel("inbox", { category: cat })
    : () => {};

  const [hasMore, setHasMore] = useState(true);
  // SPEC-SB REQ-3.4: which folder's freshly loaded rows may animate in.
  const [staggerSet, setStaggerSet] = useState<{ folder: string; ids: Set<string> } | null>(null);
  // Which folder the rows on screen belong to. On the frame right after a
  // folder switch the previous folder's rows are still mounted under the new
  // key, so the scroll-to-selection must not act on them. (The stagger has its
  // own folder tag on `staggerSet`.)
  const [loadedFolder, setLoadedFolder] = useState<string | null>(null);
  // Only the most recent load may write these: two loads race whenever the
  // user switches folders quickly, and the older one must not land last
  // (Gemini fifth pass F-01).
  const loadSeqRef = useRef(0);
  // One key for "which list is this": the stagger set and the scroll latch
  // both hang off it.
  const folderKey = folderKeyOf(activeAccountId, activeLabel, activeCategory);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [categoryMap, setCategoryMap] = useState<Map<string, string>>(() => new Map());
  const [followUpThreadIds, setFollowUpThreadIds] = useState<Set<string>>(() => new Set());
  const [bundleRules, setBundleRules] = useState<DbBundleRule[]>([]);
  const [heldThreadIds, setHeldThreadIds] = useState<Set<string>>(() => new Set());
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(() => new Set());
  const [bundleSummaries, setBundleSummaries] = useState<Map<string, { count: number; latestSubject: string | null; latestSender: string | null }>>(() => new Map());

  const openMenu = useContextMenuStore((s) => s.openMenu);
  const multiSelectCount = selectedThreadIds.size;

  const openComposer = useComposerStore((s) => s.openComposer);
  const multiSelectBarRef = useRef<HTMLDivElement>(null);

  const handleThreadContextMenu = useCallback((e: React.MouseEvent, threadId: string) => {
    e.preventDefault();
    openMenu("thread", { x: e.clientX, y: e.clientY }, { threadId });
  }, [openMenu]);

  const handleDraftClick = useCallback(async (thread: Thread) => {
    if (!activeAccountId) return;
    try {
      const messages = await getMessagesForThread(activeAccountId, thread.id);
      // Get the last message (the draft)
      const draftMsg = messages[messages.length - 1];
      if (!draftMsg) return;

      // Look up the Gmail draft ID so auto-save can update the existing draft
      let draftId: string | null = null;
      try {
        const client = await getGmailClient(activeAccountId);
        const drafts = await client.listDrafts();
        const match = drafts.find((d) => d.message.id === draftMsg.id);
        if (match) draftId = match.id;
      } catch {
        // If we can't get draft ID, composer will create a new draft on save
      }

      const to = draftMsg.to_addresses
        ? draftMsg.to_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];
      const cc = draftMsg.cc_addresses
        ? draftMsg.cc_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];
      const bcc = draftMsg.bcc_addresses
        ? draftMsg.bcc_addresses.split(",").map((a) => a.trim()).filter(Boolean)
        : [];

      openComposer({
        mode: "new",
        to,
        cc,
        bcc,
        subject: draftMsg.subject ?? "",
        bodyHtml: draftMsg.body_html ?? draftMsg.body_text ?? "",
        threadId: thread.id,
        draftId,
      });
    } catch (err) {
      console.error("Failed to open draft:", err);
    }
  }, [activeAccountId, openComposer]);

  const handleThreadClick = useCallback((thread: Thread) => {
    if (activeLabel === "drafts") {
      handleDraftClick(thread);
    } else {
      navigateToThread(thread.id);
    }
  }, [activeLabel, handleDraftClick]);

  const handleBulkDelete = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const isTrashView = activeLabel === "trash";
    const ids = [...selectedThreadIds];
    removeThreads(ids);
    try {
      const client = await getGmailClient(activeAccountId);
      await Promise.all(ids.map(async (id) => {
        if (isTrashView) {
          await client.deleteThread(id);
          await deleteThreadFromDb(activeAccountId, id);
        } else {
          await client.modifyThread(id, ["TRASH"], ["INBOX"]);
        }
      }));
    } catch (err) {
      console.error("Bulk delete failed:", err);
    }
  };

  const handleBulkArchive = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const ids = [...selectedThreadIds];
    removeThreads(ids);
    try {
      const client = await getGmailClient(activeAccountId);
      await Promise.all(ids.map((id) => client.modifyThread(id, undefined, ["INBOX"])));
    } catch (err) {
      console.error("Bulk archive failed:", err);
    }
  };

  const handleBulkSpam = async () => {
    if (!activeAccountId || multiSelectCount === 0) return;
    const ids = [...selectedThreadIds];
    const isSpamView = activeLabel === "spam";
    removeThreads(ids);
    try {
      const client = await getGmailClient(activeAccountId);
      await Promise.all(ids.map((id) =>
        isSpamView
          ? client.modifyThread(id, ["INBOX"], ["SPAM"])
          : client.modifyThread(id, ["SPAM"], ["INBOX"]),
      ));
    } catch (err) {
      console.error("Bulk spam failed:", err);
    }
  };

  const searchThreadIds = useThreadStore((s) => s.searchThreadIds);
  const searchQuery = useThreadStore((s) => s.searchQuery);

  const filteredThreads = useMemo(() => {
    let filtered = threads;
    // Apply search filter
    if (searchThreadIds !== null) {
      filtered = filtered.filter((t) => searchThreadIds.has(t.id));
    }
    // Apply read filter
    if (readFilter === "unread") filtered = filtered.filter((t) => !t.isRead);
    else if (readFilter === "read") filtered = filtered.filter((t) => t.isRead);
    // Category filtering is now server-side (Phase 4) — no client-side filter needed
    return filtered;
  }, [threads, readFilter, searchThreadIds]);

  // Pre-compute bundled category Set for O(1) lookups in filter
  const bundledCategorySet = useMemo(
    () => new Set(bundleRules.map((r) => r.category)),
    [bundleRules],
  );

  // Memoize visible threads (excludes bundled/held threads in "All" inbox view)
  const visibleThreads = useMemo(() => {
    if (activeLabel !== "inbox" || activeCategory !== "All") return filteredThreads;
    return filteredThreads.filter((t) => {
      const cat = categoryMap.get(t.id);
      if (cat && bundledCategorySet.has(cat)) return false;
      if (heldThreadIds.has(t.id)) return false;
      return true;
    });
  }, [filteredThreads, activeLabel, activeCategory, categoryMap, bundledCategorySet, heldThreadIds]);

  // SPEC-SB REQ-2.3: after a 150 ms quiet period, warm the message cache for
  // the next three and previous one threads in visible order; a newer
  // selection cancels a pending or running warm-up. Keyed on the neighbour
  // ids themselves, so a reload that leaves the neighbours unchanged does not
  // restart the timer or cancel a warm-up in flight (Gemini F-03).
  const prefetchKey = useMemo(
    () => joinIds(prefetchOrder(visibleThreads.map((t) => t.id), selectedThreadId)),
    [visibleThreads, selectedThreadId],
  );
  useEffect(() => {
    if (!activeAccountId || prefetchKey === "") return;
    const order = splitIds(prefetchKey);
    let job: PrefetchJob | null = null;
    const timer = setTimeout(() => {
      job = threadMessageCache.prefetch(activeAccountId, order);
    }, PREFETCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      job?.cancel();
    };
  }, [activeAccountId, prefetchKey]);

  const mapDbThreads = useCallback(async (dbThreads: Awaited<ReturnType<typeof getThreadsForAccount>>): Promise<Thread[]> => {
    return Promise.all(
      dbThreads.map(async (t) => {
        const labelIds = await getThreadLabelIds(t.account_id, t.id);
        return {
          id: t.id,
          accountId: t.account_id,
          subject: t.subject,
          snippet: t.snippet,
          lastMessageAt: t.last_message_at ?? 0,
          messageCount: t.message_count,
          isRead: t.is_read === 1,
          isStarred: t.is_starred === 1,
          isPinned: t.is_pinned === 1,
          isMuted: t.is_muted === 1,
          hasAttachments: t.has_attachments === 1,
          labelIds,
          fromName: t.from_name,
          fromAddress: t.from_address,
        };
      }),
    );
  }, []);

  const clearSearch = useThreadStore((s) => s.clearSearch);

  const loadThreads = useCallback(async () => {
    if (!activeAccountId) {
      setThreads([]);
      setStaggerSet(null);
      return;
    }

    // SPEC-SB REQ-3.4: the rows this load puts on screen are the ones that
    // animate in; captured here so a folder change can never stagger the
    // previous folder's rows, and `loadMore` never re-triggers it.
    const folder = folderKeyOf(activeAccountId, activeLabel, activeCategory);
    const seq = ++loadSeqRef.current;
    const markStagger = (threadsLoaded: ReadonlyArray<{ id: string }>) => {
      if (seq !== loadSeqRef.current) return; // a newer load has started
      setStaggerSet({ folder, ids: new Set(threadsLoaded.slice(0, 15).map((t) => t.id)) });
      setLoadedFolder(folder);
    };

    clearSearch();
    setLoading(true);
    setHasMore(true);
    try {
      // Smart folder query path
      if (isSmartFolder && activeSmartFolder) {
        const { sql, params } = getSmartFolderSearchQuery(
          activeSmartFolder.query,
          activeAccountId,
          PAGE_SIZE,
        );
        const db = await getDb();
        const rows = await db.select<SmartFolderRow[]>(sql, params);
        const mapped = await mapSmartFolderRows(rows);
        setThreads(mapped);
        markStagger(mapped);
        setHasMore(false); // Smart folders load all at once
      } else {
        let dbThreads;
        // Server-side category filtering for inbox
        if (activeLabel === "inbox" && activeCategory !== "All") {
          dbThreads = await loadTabThreads(activeAccountId, activeCategory, PAGE_SIZE, 0);
        } else {
          const gmailLabelId = LABEL_MAP[activeLabel] ?? activeLabel;
          dbThreads = await getThreadsForAccount(
            activeAccountId,
            gmailLabelId || undefined,
            PAGE_SIZE,
            0,
          );
        }

        const mapped = await mapDbThreads(dbThreads);
        setThreads(mapped);
        markStagger(mapped);
        setHasMore(dbThreads.length === PAGE_SIZE);
      }
    } catch (err) {
      console.error("Failed to load threads:", err);
      // The stagger set is left alone: it is folder-tagged, so it can only
      // belong to rows that are still on screen from an earlier successful
      // load of this same folder, and clearing it would strip the animation
      // from rows mid-flight (Gemini fifth pass F-03).
    } finally {
      setLoading(false);
    }
  }, [activeAccountId, activeLabel, activeCategory, isSmartFolder, activeSmartFolder, setThreads, setLoading, mapDbThreads, clearSearch]);

  const loadMore = useCallback(async () => {
    if (!activeAccountId || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const offset = threads.length;
      let dbThreads;
      if (activeLabel === "inbox" && activeCategory !== "All") {
        dbThreads = await loadTabThreads(activeAccountId, activeCategory, PAGE_SIZE, offset);
      } else {
        const gmailLabelId = LABEL_MAP[activeLabel] ?? activeLabel;
        dbThreads = await getThreadsForAccount(
          activeAccountId,
          gmailLabelId || undefined,
          PAGE_SIZE,
          offset,
        );
      }

      const mapped = await mapDbThreads(dbThreads);
      if (mapped.length > 0) {
        setThreads([...threads, ...mapped]);
      }
      setHasMore(dbThreads.length === PAGE_SIZE);
    } catch (err) {
      console.error("Failed to load more threads:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [activeAccountId, activeLabel, activeCategory, threads, loadingMore, hasMore, setThreads, mapDbThreads]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Stable thread ID key — only changes when the actual set of thread IDs changes, not on every array reference
  const threadIdKey = useMemo(() => threads.map((t) => t.id).join(","), [threads]);

  // Load all thread metadata (categories, unread counts, follow-ups, bundles) in one coordinated effect
  useEffect(() => {
    let cancelled = false;

    if (!activeAccountId) {
      setCategoryMap(new Map());
      setTabCounts(new Map());
      setFollowUpThreadIds(new Set());
      setBundleRules([]);
      setHeldThreadIds(new Set());
      setBundleSummaries(new Map());
      return;
    }

    const threadIds = threadIdKey ? threadIdKey.split(",") : [];
    const isInbox = activeLabel === "inbox";
    const isAllCategory = activeCategory === "All";

    const loadMetadata = async () => {
      try {
        // Build all promises based on current view
        const promises: Promise<void>[] = [];

        // Categories (only for inbox "All" tab with threads)
        if (isInbox && isAllCategory && threadIds.length > 0) {
          promises.push(
            getCategoriesForThreads(activeAccountId, threadIds).then((result) => {
              if (!cancelled) setCategoryMap(result);
            }),
          );
        } else {
          setCategoryMap(new Map());
        }

        // Per-tab counts — total (what "empty" means) and unread (the pill),
        // for the configured tabs only (SPEC-SIT REQ-2.4, 3.1); inbox only.
        if (isInbox && inboxViewMode === "split") {
          promises.push(
            getSplitTabCounts(activeAccountId, {
              categories: splitInboxTabs.filter((t) => t.kind === "category").map((t) => t.id),
              labelIds: splitInboxTabs.flatMap((t) => (t.kind === "label" && t.labelId ? [t.labelId] : [])),
              reminders: splitInboxTabs.some((t) => t.kind === "reminders"),
            }).then((result) => {
              if (!cancelled) setTabCounts(result);
            }).catch(() => {
              // Fail open on display: tabs stay, pills empty, nothing hides.
              if (!cancelled) setTabCounts(new Map());
            }),
          );
        } else {
          setTabCounts(new Map());
        }

        // Follow-up indicators
        if (threadIds.length > 0) {
          promises.push(
            getActiveFollowUpThreadIds(activeAccountId, threadIds).then((result) => {
              if (!cancelled) setFollowUpThreadIds(result);
            }).catch(() => {
              if (!cancelled) setFollowUpThreadIds(new Set());
            }),
          );
        } else {
          setFollowUpThreadIds(new Set());
        }

        // Bundle rules + held threads (only for inbox)
        if (isInbox) {
          promises.push(
            getBundleRules(activeAccountId).then(async (rules) => {
              if (cancelled) return;
              const bundled = rules.filter((r) => r.is_bundled);
              setBundleRules(bundled);
              // Batch-fetch all summaries in 2 queries instead of 2N
              if (bundled.length > 0) {
                const summaries = await getBundleSummaries(activeAccountId, bundled.map((r) => r.category)).catch(() => new Map());
                if (!cancelled) setBundleSummaries(summaries);
              } else {
                if (!cancelled) setBundleSummaries(new Map());
              }
            }).catch(() => {
              if (!cancelled) setBundleRules([]);
            }),
          );
          promises.push(
            getHeldThreadIds(activeAccountId).then((result) => {
              if (!cancelled) setHeldThreadIds(result);
            }).catch(() => {
              if (!cancelled) setHeldThreadIds(new Set());
            }),
          );
        } else {
          setBundleRules([]);
          setHeldThreadIds(new Set());
          setBundleSummaries(new Map());
        }

        await Promise.all(promises);
      } catch (err) {
        console.error("Failed to load thread metadata:", err);
      }
    };

    loadMetadata();
    return () => { cancelled = true; };
  }, [threadIdKey, activeLabel, activeCategory, activeAccountId, inboxViewMode, splitInboxTabs]);

  // Listen for sync completion to reload (debounced to avoid waterfall from multiple emitters)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadThreads(), 500);
    };
    window.addEventListener("velo-sync-done", handler);
    return () => {
      window.removeEventListener("velo-sync-done", handler);
      if (timer) clearTimeout(timer);
    };
  }, [loadThreads, activeAccountId, activeLabel]);

  // SPEC-SB SB-3: one flat item model for the scroller — bundle headers and
  // children, threads (with the pinned divider), footers — and a virtualizer
  // that renders only the rows in view (REQ-3.1).
  const showBundles = activeLabel === "inbox" && activeCategory === "All";
  const items = useMemo<ListItem[]>(
    () =>
      buildListItems({
        threads: visibleThreads,
        bundles: bundleRules.map((rule) => {
          const summary = bundleSummaries.get(rule.category);
          const expanded = expandedBundles.has(rule.category);
          return {
            category: rule.category,
            count: summary?.count ?? 0,
            latestSender: summary?.latestSender ?? null,
            latestSubject: summary?.latestSubject ?? null,
            expanded,
            threads: expanded ? filteredThreads.filter((t) => categoryMap.get(t.id) === rule.category) : [],
          };
        }),
        showBundles,
        loadingMore,
        allLoaded: !hasMore && threads.length > PAGE_SIZE,
        density: emailDensity,
      }),
    [visibleThreads, bundleRules, bundleSummaries, expandedBundles, filteredThreads, categoryMap, showBundles, loadingMore, hasMore, threads.length, emailDensity],
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => itemsRef.current[index]?.estimate ?? 72,
    getItemKey: (index) => itemsRef.current[index]?.key ?? index,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // REQ-3.3: the selected thread (a plain row or an expanded bundle child)
  // scrolls into view through the virtualizer, rendered or not. Keyed on the
  // selection and on whether it is present in the list — so a deep link or a
  // boot with a selection scrolls once the list has loaded (Gemini F-01), while
  // a reload that merely reorders items does not snap the user back.
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  const selectedPresent = !!selectedThreadId && items.some((it) => it.threadId !== undefined && it.threadId === selectedThreadId);
  // Scrolled once per selection *episode* — a new selection, or a selection
  // that was already set when this folder's rows arrived. Never twice for the
  // same selection in the same folder, so a reload that drops and re-adds the
  // row cannot snap a user who has scrolled away. `loadedFolder === folderKey`
  // keeps the whole thing off the frame where the previous folder's rows are
  // still mounted under the new folder's key (Gemini fourth pass F-01).
  // Re-picking the thread that is already selected changes nothing and scrolls
  // nothing, as before this commit. The reset effect is declared first so it
  // runs before the scroll effect in the same commit.
  const lastScrolledRef = useRef<string | null>(null);
  useEffect(() => {
    lastScrolledRef.current = null;
  }, [selectedThreadId]);
  useEffect(() => {
    if (!selectedThreadId || !selectedPresent) return;
    if (loadedFolder !== folderKey) return;
    const episode = `${folderKey}|${selectedThreadId}`;
    if (lastScrolledRef.current === episode) return;
    const index = itemsRef.current.findIndex((it) => it.threadId === selectedThreadId);
    if (index < 0) return;
    lastScrolledRef.current = episode;
    virtualizerRef.current.scrollToIndex(index, { align: "auto" });
  }, [selectedThreadId, selectedPresent, folderKey, loadedFolder]);

  // REQ-3.3: load more when the last rendered row is within five of the end.
  // `loadMore` guards on `hasMore`/`loadingMore` itself; the guard here just
  // keeps the effect quiet once everything is loaded.
  const lastRenderedIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    if (lastRenderedIndex >= 0 && lastRenderedIndex >= items.length - 5) loadMore();
  }, [lastRenderedIndex, items.length, hasMore, loadingMore, loadMore]);

  // REQ-3.4: stagger-in plays for the first rows of a folder's freshly loaded
  // list — not for rows that scroll into view later, not for the next page,
  // and not for the old list still on screen while the next folder loads. The
  // set is captured by `loadThreads` itself from the rows it just loaded, so
  // it is never the previous folder's, and it survives the virtualizer's
  // measure re-renders (Gemini follow-up F-02).
  const staggerIds = staggerSet?.folder === folderKey ? staggerSet.ids : null;

  const renderItem = (item: ListItem, index: number) => {
    switch (item.kind) {
      case "bundle": {
        const category = item.category!;
        const summary = bundleSummaries.get(category);
        const isExpanded = expandedBundles.has(category);
        return (
          <button
            onClick={() => {
              setExpandedBundles((prev) => {
                const next = new Set(prev);
                if (next.has(category)) next.delete(category);
                else next.add(category);
                return next;
              });
            }}
            className="w-full text-left px-4 py-3 border-b border-border-secondary hover:bg-bg-hover transition-colors flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
              <Package size={16} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary">
                  {category}
                </span>
                <span className="text-xs bg-accent/15 text-accent px-1.5 rounded-full">
                  {summary?.count ?? 0}
                </span>
              </div>
              <span className="text-xs text-text-tertiary truncate block mt-0.5">
                {summary?.latestSender && `${summary.latestSender}: `}{summary?.latestSubject ?? ""}
              </span>
            </div>
            <ChevronRight
              size={14}
              className={`text-text-tertiary transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`}
            />
          </button>
        );
      }
      case "bundle-child": {
        const thread = threadMap.get(item.threadId!);
        // Never an empty wrapper: it would be measured at 0 and corrupt the
        // layout (Gemini F-06). The store rebuilds threadMap with threads, so
        // this is defensive.
        if (!thread) return <div style={{ height: item.estimate }} />;
        return (
          <div className="pl-4">
            <ThreadCard
              thread={thread}
              isSelected={thread.id === selectedThreadId}
              onClick={handleThreadClick}
              onContextMenu={handleThreadContextMenu}
              category={item.category}
              hasFollowUp={followUpThreadIds.has(thread.id)}
            />
          </div>
        );
      }
      case "thread": {
        const thread = threadMap.get(item.threadId!);
        // Never an empty wrapper: it would be measured at 0 and corrupt the
        // layout (Gemini F-06). The store rebuilds threadMap with threads, so
        // this is defensive.
        if (!thread) return <div style={{ height: item.estimate }} />;
        const stagger = staggerIds?.has(thread.id) ?? false;
        return (
          <div
            data-thread-id={thread.id}
            className={stagger ? "stagger-in" : undefined}
            style={stagger ? { animationDelay: `${index * 30}ms` } : undefined}
          >
            {item.dividerBefore && (
              <div className="px-4 py-1.5 text-xs font-medium text-text-tertiary uppercase tracking-wider bg-bg-tertiary/50 border-b border-border-secondary">
                Other emails
              </div>
            )}
            <ThreadCard
              thread={thread}
              isSelected={thread.id === selectedThreadId}
              onClick={handleThreadClick}
              onContextMenu={handleThreadContextMenu}
              category={categoryMap.get(thread.id)}
              showCategoryBadge={showBundles}
              hasFollowUp={followUpThreadIds.has(thread.id)}
            />
          </div>
        );
      }
      case "loading":
        return (
          <div className="px-4 py-3 text-center text-xs text-text-tertiary">
            Loading more...
          </div>
        );
      case "all-loaded":
        return (
          <div className="px-4 py-3 text-center text-xs text-text-tertiary">
            All conversations loaded
          </div>
        );
    }
  };

  return (
    <div
      ref={listRef}
      className={`flex flex-col bg-bg-secondary/50 glass-panel ${
        readingPanePosition === "right"
          ? "min-w-[240px] shrink-0"
          : readingPanePosition === "bottom"
            ? "w-full border-b border-border-primary h-[40%] min-h-[200px]"
            : "w-full flex-1"
      }`}
      style={readingPanePosition === "right" && width ? { width } : undefined}
    >
      {/* Search */}
      <div className="px-3 py-2 border-b border-border-secondary">
        <SearchBar />
      </div>

      {/* Header */}
      <div className="px-4 py-2 border-b border-border-primary flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary capitalize flex items-center gap-1.5">
            {isSmartFolder && <FolderSearch size={14} className="text-accent shrink-0" />}
            {isSmartFolder
              ? activeSmartFolder?.name ?? "Smart Folder"
              : activeLabel === "inbox" && inboxViewMode === "split" && activeCategory !== "All"
                ? `Inbox — ${activeCategory}`
                : LABEL_MAP[activeLabel] !== undefined
                  ? activeLabel
                  : userLabels.find((l) => l.id === activeLabel)?.name ?? activeLabel}
          </h2>
          <span className="text-xs text-text-tertiary">
            {filteredThreads.length} conversation{filteredThreads.length !== 1 ? "s" : ""}
          </span>
        </div>
        <select
          value={readFilter}
          onChange={(e) => setReadFilter(e.target.value as "all" | "read" | "unread")}
          className="text-xs bg-bg-tertiary text-text-secondary px-2 py-1 rounded border border-border-primary"
        >
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
      </div>

      {/* Category tabs (inbox + split mode only) */}
      {activeLabel === "inbox" && inboxViewMode === "split" && (
        <CategoryTabs
          tabs={visibleTabs}
          activeTab={activeCategory}
          onTabChange={setActiveCategory}
        />
      )}

      {/* Multi-select action bar */}
      <CSSTransition nodeRef={multiSelectBarRef} in={multiSelectCount > 0} timeout={150} classNames="slide-down" unmountOnExit>
        <div ref={multiSelectBarRef} className="px-3 py-2 border-b border-border-primary bg-accent/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-primary">
              {multiSelectCount} selected
            </span>
            {multiSelectCount < filteredThreads.length && (
              <button
                onClick={selectAll}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                Select all
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleBulkArchive}
              title="Archive selected"
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            >
              <Archive size={14} />
            </button>
            <button
              onClick={handleBulkDelete}
              title="Delete selected"
              className="p-1.5 text-text-secondary hover:text-error hover:bg-bg-hover rounded transition-colors"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={handleBulkSpam}
              title={activeLabel === "spam" ? "Not spam" : "Report spam"}
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            >
              <Ban size={14} />
            </button>
            <button
              onClick={clearMultiSelect}
              title="Clear selection"
              className="p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </CSSTransition>

      {/* Thread list */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {isLoading && threads.length === 0 ? (
          <EmailListSkeleton />
        ) : filteredThreads.length === 0 && bundleRules.length === 0 ? (
          <EmptyStateForContext
            searchQuery={searchQuery}
            activeAccountId={activeAccountId}
            activeLabel={activeLabel}
            readFilter={readFilter}
            activeCategory={activeCategory}
          />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualItems.map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              return (
                <div
                  key={item.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {renderItem(item, virtualRow.index)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyStateForContext({
  searchQuery,
  activeAccountId,
  activeLabel,
  readFilter,
  activeCategory,
}: {
  searchQuery: string | null;
  activeAccountId: string | null;
  activeLabel: string;
  readFilter: string;
  activeCategory: string;
}) {
  if (searchQuery) {
    return <EmptyState illustration={NoSearchResultsIllustration} title="No results found" subtitle="Try a different search term" />;
  }
  if (readFilter !== "all") {
    return <EmptyState icon={Funnel} title={`No ${readFilter} emails`} subtitle="Try changing the filter" />;
  }
  if (!activeAccountId) {
    return <EmptyState illustration={NoAccountIllustration} title="No account connected" subtitle="Add a Gmail account to get started" />;
  }

  switch (activeLabel) {
    case "inbox":
      if (activeCategory !== "All") {
        const categoryMessages: Record<string, { title: string; subtitle: string }> = {
          Primary: { title: "Primary is clear", subtitle: "No important conversations" },
          Updates: { title: "No updates", subtitle: "Notifications and transactional emails appear here" },
          Promotions: { title: "No promotions", subtitle: "Marketing and promotional emails appear here" },
          Social: { title: "No social emails", subtitle: "Social network notifications appear here" },
          Newsletters: { title: "No newsletters", subtitle: "Newsletters and subscriptions appear here" },
        };
        const msg = categoryMessages[activeCategory];
        if (msg) return <EmptyState illustration={InboxClearIllustration} title={msg.title} subtitle={msg.subtitle} />;
      }
      return <EmptyState illustration={InboxClearIllustration} title="You're all caught up" subtitle="No new conversations" />;
    case "starred":
      return <EmptyState illustration={GenericEmptyIllustration} title="No starred conversations" subtitle="Star emails to find them here" />;
    case "snoozed":
      return <EmptyState illustration={GenericEmptyIllustration} title="No snoozed emails" subtitle="Snoozed emails will appear here" />;
    case "sent":
      return <EmptyState illustration={GenericEmptyIllustration} title="No sent messages" />;
    case "drafts":
      return <EmptyState illustration={GenericEmptyIllustration} title="No drafts" />;
    case "trash":
      return <EmptyState illustration={GenericEmptyIllustration} title="Trash is empty" />;
    case "spam":
      return <EmptyState illustration={GenericEmptyIllustration} title="No spam" subtitle="Looking good!" />;
    case "all":
      return <EmptyState illustration={GenericEmptyIllustration} title="No emails yet" />;
    default:
      if (activeLabel.startsWith("smart-folder:")) {
        return <EmptyState icon={FolderSearch} title="No matching emails" subtitle="Try adjusting the smart folder query" />;
      }
      return <EmptyState illustration={GenericEmptyIllustration} title="Nothing here" subtitle="No conversations with this label" />;
  }
}
