import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BUCKETS, supabase } from "../lib/supabase";
import { ACCEPTED_FILES, uploadDocument } from "../lib/files";
import { useFounderBonds } from "../lib/data";
import ViewDocButton from "./ViewDocButton";

/**
 * Per-founder bond: "View bond" when one has been uploaded, otherwise "Upload bond".
 * A new upload never overwrites the old one (the old file stays in storage); the newest is shown.
 */
export default function FounderBond({ founderId, founderName }: { founderId: string; founderName: string }) {
  const qc = useQueryClient();
  const bondsQ = useFounderBonds();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const current = (bondsQ.data ?? []).find((b) => b.founder_id === founderId);

  async function onPick(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const bondId = crypto.randomUUID();
      const docId = await uploadDocument({
        bucket: BUCKETS.bondsFounders,
        file,
        folder: founderId,
        linkedTable: "bonds",
        linkedId: bondId,
      });
      const { error } = await supabase.from("bonds").insert({
        id: bondId,
        party_type: "founder",
        party_name: founderName,
        founder_id: founderId,
        title: "Founder bond",
        document_id: docId,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["founder-bonds"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept={ACCEPTED_FILES}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPick(f);
        }}
      />
      {bondsQ.isLoading ? (
        <span className="text-xs text-slate-400">Checking...</span>
      ) : bondsQ.isError ? (
        <span className="text-xs text-red-600">Bond status unavailable</span>
      ) : current ? (
        <>
          <ViewDocButton documentId={current.document_id} label="View bond" />
          <button
            type="button"
            className="text-xs text-slate-500 hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            title="Upload a newer version. The old file is kept."
          >
            {busy ? "Uploading..." : "Replace"}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn-ghost !px-3 !py-1.5 text-xs"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "Uploading..." : "Upload bond"}
        </button>
      )}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
