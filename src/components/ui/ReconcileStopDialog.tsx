import { useState } from "react";
import { useUIStore } from "@/stores/uiStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { deleteConfirmedAfterUserApproval } from "@/services/imap/reconcilePass";

/**
 * SPEC-F-4 REQ-3.1's hard stop, rendered.
 *
 * Sync found that more than half of a folder's local messages are gone from
 * the server, confirmed on two separate passes. That is either a bulk clean-up
 * done elsewhere (empty Trash, an archive sweep) or something wrong, and the
 * spec makes it a human decision: nothing in that folder is deleted until the
 * user answers here. One folder at a time; further stops queue behind.
 *
 * "Delete them" removes every confirmed message in the folder now (a person
 * has just approved a mass removal, so the per-pass cap that rate-limits
 * unattended passes does not apply). "Keep them" leaves the folder frozen;
 * the next pass asks again if the mismatch persists.
 */
export function ReconcileStopDialog() {
  const stops = useUIStore((s) => s.reconcileStops);
  const clearStop = useUIStore((s) => s.clearReconcileStop);
  const addNotice = useUIStore((s) => s.addNotice);
  const [busy, setBusy] = useState(false);
  const stop = stops[0];
  if (!stop) return null;

  const dismiss = () => clearStop(stop.accountId, stop.folder);

  const confirm = async () => {
    setBusy(true);
    try {
      const n = await deleteConfirmedAfterUserApproval(stop.accountId, stop.folder, stop.uidvalidity);
      addNotice({ text: `Removed ${n} message${n === 1 ? "" : "s"} from ${stop.folder} that no longer exist on the server` });
      window.dispatchEvent(new Event("velo-sync-done"));
      dismiss();
    } catch (err) {
      // Stay open so the user can retry; nothing was changed.
      console.error("[ReconcileStopDialog] deletion failed:", err);
      addNotice({ text: `Could not remove messages from ${stop.folder} — nothing was changed. You can try again.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      isOpen
      onClose={dismiss}
      onConfirm={confirm}
      loading={busy}
      title={`${stop.folder}: ${stop.confirmed} of ${stop.localRows} messages are gone from the server`}
      message={
        <>
          <p>
            Two syncs in a row found these messages missing from <strong>{stop.folder}</strong> on
            the mail server — more than half of what Velo has for that folder. That usually means
            they were deleted or moved from another device or the web.
          </p>
          <p className="mt-2">
            Remove them from Velo too? Nothing on the server changes either way. Choosing to keep
            them leaves the folder as it is; Velo will ask again if the mismatch persists.
          </p>
        </>
      }
      confirmLabel="Delete them"
      cancelLabel="Keep them"
      variant="danger"
    />
  );
}
