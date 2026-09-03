import { useEffect, useLayoutEffect, useCallback, useRef, useState } from "react";
import { Inbox, Bell, Tag, Users, Newspaper, AlarmClock, type LucideIcon } from "lucide-react";
import type { VisibleTab } from "@/services/inbox/splitTabs";

export interface CategoryTabsProps {
  /** The tabs to draw, already filtered for hide-when-empty and missing labels (SPEC-SIT). */
  tabs: VisibleTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Primary: Inbox,
  Updates: Bell,
  Promotions: Tag,
  Social: Users,
  Newsletters: Newspaper,
};

function iconFor(tab: VisibleTab): LucideIcon | null {
  if (tab.kind === "reminders") return AlarmClock;
  if (tab.kind === "category") return CATEGORY_ICONS[tab.id] ?? null;
  return null;
}

export function CategoryTabs({ tabs, activeTab, onTabChange }: CategoryTabsProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkOverflow();
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    el.addEventListener("scroll", checkOverflow, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", checkOverflow);
    };
  }, [checkOverflow]);

  // Update sliding indicator position when the active tab (or the set of tabs)
  // changes — useLayoutEffect prevents flicker
  useLayoutEffect(() => {
    const el = tabRefs.current.get(activeTab);
    if (el) {
      setIndicatorStyle({ left: el.offsetLeft, width: el.offsetWidth });
    } else {
      setIndicatorStyle(null);
    }
  }, [activeTab, tabs]);

  return (
    <div className="relative border-b border-border-secondary shrink-0">
      {/* Left fade */}
      {canScrollLeft && (
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-bg-secondary to-transparent z-10 pointer-events-none" />
      )}
      {/* Right fade */}
      {canScrollRight && (
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-bg-secondary to-transparent z-10 pointer-events-none" />
      )}
      <div
        ref={scrollRef}
        className="flex px-2 overflow-x-auto hide-scrollbar relative"
        role="tablist"
      >
        {tabs.map((tab) => {
          const Icon = iconFor(tab);
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              ref={(el) => { if (el) tabRefs.current.set(tab.id, el); else tabRefs.current.delete(tab.id); }}
              onClick={(e) => {
                onTabChange(tab.id);
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors relative whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? "text-accent"
                  : "text-text-tertiary hover:text-text-primary"
              }`}
            >
              {Icon && <Icon size={13} />}
              {tab.kind === "label" && (
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-full bg-text-tertiary"
                  style={tab.color ? { backgroundColor: tab.color } : undefined}
                />
              )}
              {tab.name}
              {tab.unread > 0 && (
                <span className="text-[0.625rem] bg-accent/15 text-accent px-1.5 rounded-full leading-normal">
                  {tab.unread}
                </span>
              )}
            </button>
          );
        })}
        {/* Sliding indicator */}
        {indicatorStyle && (
          <span
            className="absolute bottom-0 h-0.5 bg-accent rounded-full transition-all duration-200 ease-out pointer-events-none"
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        )}
      </div>
    </div>
  );
}
