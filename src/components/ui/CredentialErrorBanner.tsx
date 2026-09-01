import { useUIStore } from "@/stores/uiStore";
import { KeyRound } from "lucide-react";

/**
 * Shown when stored credentials could not be decrypted (audit P5).
 *
 * Before this, a decryption failure was swallowed with a `console.warn` and the
 * ciphertext was used as the password — so the user saw their mail server reject
 * them and concluded they had the wrong password. They would then re-enter
 * correct credentials, which were re-encrypted with the same unusable key, and
 * fail again.
 *
 * The point of this banner is to name the actual cause. It deliberately does not
 * offer a one-click "fix": the resolution is either restoring `velo.key` from a
 * backup or re-adding the account, and silently re-encrypting over unreadable
 * data would destroy any chance of the former.
 */
export function CredentialErrorBanner() {
  const credentialError = useUIStore((s) => s.credentialError);
  const setCredentialError = useUIStore((s) => s.setCredentialError);

  if (!credentialError) return null;

  return (
    <div
      role="alert"
      className="fixed top-8 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-danger/90 text-white text-xs px-4 py-1.5 backdrop-blur-sm"
    >
      <KeyRound size={14} className="shrink-0" />
      <span>{credentialError}</span>
      <button
        type="button"
        onClick={() => setCredentialError(null)}
        className="ml-2 underline underline-offset-2 hover:no-underline"
      >
        Dismiss
      </button>
    </div>
  );
}
