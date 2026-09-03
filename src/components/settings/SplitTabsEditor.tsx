import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, X, Plus } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useLabelStore, isSystemLabel } from "@/stores/labelStore";
import { useAccountStore } from "@/stores/accountStore";
import { getSmartLabelRulesForAccount } from "@/services/db/smartLabelRules";
import { ALL_CATEGORIES } from "@/services/db/threadCategories";
import {
  addTab,
  removeTab,
  moveTab,
  setHideWhenEmpty,
  categoryTabId,
  labelTabId,
  REMINDERS_TAB_ID,
  MAX_TABS,
  type SplitTab,
} from "@/services/inbox/splitTabs";

/**
 * SPEC-SIT REQ-4 — the split inbox's tabs: reorder, remove, hide-when-empty,
 * and add a category, any of the active account's labels (smart-labelled ones
 * marked), or Reminders. Every change persists through the store at once.
 */
export function SplitTabsEditor() {
  const tabs = useUIStore((s) => s.splitInboxTabs);
  const setTabs = useUIStore((s) => s.setSplitInboxTabs);
  const labels = useLabelStore((s) => s.labels);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const [smartLabelIds, setSmartLabelIds] = useState<Set<string>>(() => new Set());
  const [candidate, setCandidate] = useState("");

  useEffect(() => {
    let cancelled = false;
    // A candidate chosen under one account means nothing under another (Gemini M3).
    setCandidate("");
    if (!activeAccountId) {
      setSmartLabelIds(new Set());
      return;
    }
    getSmartLabelRulesForAccount(activeAccountId)
      .then((rules) => {
        if (!cancelled) setSmartLabelIds(new Set(rules.map((r) => r.label_id)));
      })
      .catch(() => {
        if (!cancelled) setSmartLabelIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId]);

  const accountLabels = useMemo(
    () => labels.filter((l) => l.accountId === activeAccountId && !isSystemLabel(l.id)),
    [labels, activeAccountId],
  );
  // A label tab configured under another account still reads as a name here
  // (Gemini L1); in the inbox it is simply not shown (REQ-2.5).
  const labelName = (labelId: string): string => {
    const own = accountLabels.find((l) => l.id === labelId);
    if (own) return own.name;
    const other = labels.find((l) => l.id === labelId);
    return other ? `${other.name} (another account)` : `${labelId} (label not found)`;
  };

  const tabName = (tab: SplitTab): string => {
    if (tab.kind === "category") return tab.category ?? tab.id;
    if (tab.kind === "reminders") return "Reminders";
    return labelName(tab.labelId ?? "");
  };

  const present = new Set(tabs.map((t) => t.id));
  const candidates: { id: string; name: string; tab: SplitTab }[] = [
    ...ALL_CATEGORIES.filter((c) => !present.has(categoryTabId(c))).map((c) => ({
      id: categoryTabId(c),
      name: `${c} (category)`,
      tab: { id: categoryTabId(c), kind: "category" as const, category: c, hideWhenEmpty: false },
    })),
    ...(present.has(REMINDERS_TAB_ID)
      ? []
      : [{ id: REMINDERS_TAB_ID, name: "Reminders", tab: { id: REMINDERS_TAB_ID, kind: "reminders" as const, hideWhenEmpty: false } }]),
    ...accountLabels
      .filter((l) => !present.has(labelTabId(l.id)))
      .map((l) => ({
        id: labelTabId(l.id),
        name: smartLabelIds.has(l.id) ? `${l.name} (smart label)` : l.name,
        tab: { id: labelTabId(l.id), kind: "label" as const, labelId: l.id, hideWhenEmpty: false },
      })),
  ];

  const onAdd = () => {
    const chosen = candidates.find((c) => c.id === candidate);
    if (!chosen) return;
    setTabs(addTab(tabs, chosen.tab));
    setCandidate("");
  };

  return (
    <div className="space-y-2" data-testid="split-tabs-editor">
      <ul className="space-y-1">
        {tabs.map((tab, index) => (
          <li
            key={tab.id}
            className="flex items-center gap-2 text-sm text-text-primary bg-bg-tertiary rounded-md px-2 py-1"
          >
            <button
              type="button"
              onClick={() => setTabs(moveTab(tabs, tab.id, -1))}
              disabled={index === 0}
              className="p-0.5 text-text-tertiary hover:text-text-primary disabled:opacity-30"
              aria-label={`Move ${tabName(tab)} up`}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => setTabs(moveTab(tabs, tab.id, 1))}
              disabled={index === tabs.length - 1}
              className="p-0.5 text-text-tertiary hover:text-text-primary disabled:opacity-30"
              aria-label={`Move ${tabName(tab)} down`}
            >
              <ArrowDown size={14} />
            </button>
            <span className="flex-1 truncate">{tabName(tab)}</span>
            <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-accent"
                checked={tab.hideWhenEmpty}
                onChange={(e) => setTabs(setHideWhenEmpty(tabs, tab.id, e.target.checked))}
                aria-label={`Hide ${tabName(tab)} when empty`}
              />
              {/* Announced once, by the aria-label above, which also names the tab (Grok L2). */}
              <span aria-hidden="true">Hide when empty</span>
            </label>
            <button
              type="button"
              onClick={() => setTabs(removeTab(tabs, tab.id))}
              disabled={tabs.length <= 1}
              className="p-0.5 text-text-tertiary hover:text-danger disabled:opacity-30"
              aria-label={`Remove ${tabName(tab)}`}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <select
          value={candidate}
          onChange={(e) => setCandidate(e.target.value)}
          aria-label="Tab to add"
          className="flex-1 bg-bg-tertiary text-text-primary text-sm px-3 py-1.5 rounded-md border border-border-primary focus:border-accent outline-none"
        >
          <option value="">Add a tab…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onAdd}
          disabled={!candidate || tabs.length >= MAX_TABS}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-md disabled:opacity-50"
        >
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  );
}
