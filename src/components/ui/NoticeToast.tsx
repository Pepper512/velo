import { useRef } from "react";
import { CSSTransition } from "react-transition-group";
import { X } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";

/**
 * A small, reusable notice toast fed by `uiStore.notices` (SPEC-F-2 design §3b).
 * Shows the newest notice; notices auto-dismiss from the store. Same visual
 * pattern as `UpdateToast`, one level up so any window can mount it.
 */
export function NoticeToast() {
  const notices = useUIStore((s) => s.notices);
  const dismissNotice = useUIStore((s) => s.dismissNotice);
  const toastRef = useRef<HTMLDivElement>(null);

  const notice = notices[notices.length - 1];

  return (
    <CSSTransition
      nodeRef={toastRef}
      in={notice !== undefined}
      timeout={200}
      classNames="toast"
      unmountOnExit
    >
      <div
        ref={toastRef}
        role="status"
        className="fixed bottom-4 right-4 z-50 glass-panel rounded-lg shadow-lg overflow-hidden max-w-xs"
      >
        {notice && (
          <div className="px-4 py-3 flex items-start gap-3">
            <p className="text-sm text-text-primary flex-1">{notice.text}</p>
            {notice.action && (
              <button
                onClick={() => {
                  void notice.action?.onClick();
                }}
                className="text-xs font-medium text-accent hover:text-accent-hover transition-colors shrink-0"
              >
                {notice.action.label}
              </button>
            )}
            <button
              onClick={() => dismissNotice(notice.id)}
              aria-label="Dismiss"
              className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </CSSTransition>
  );
}
