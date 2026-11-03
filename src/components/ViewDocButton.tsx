import { useState } from "react";
import { openDocument } from "../lib/files";

/** The "View Bill / View proof" button. Shows a dash when nothing is attached. */
export default function ViewDocButton({
  documentId,
  label = "View",
}: {
  documentId: string | null | undefined;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  if (!documentId) return <span className="text-xs text-slate-400">No file</span>;
  return (
    <button
      className={`text-sm hover:underline ${err ? "text-red-600" : "text-brand-600"}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setErr(false);
        try {
          await openDocument(documentId);
        } catch {
          setErr(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {err ? "Could not open" : busy ? "Opening..." : label}
    </button>
  );
}
