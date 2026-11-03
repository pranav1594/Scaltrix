import { useMemo } from "react";
import type { ProjectDetailRow, ProjectSnapshot } from "./data";
import { useSettings } from "./settings";
import { useFounders } from "./useFounders";
import { assertBpTotal, type SplitSettings } from "../engine";

export type Rules = Omit<SplitSettings, "employees">;

export function toSnapshot(r: Rules): ProjectSnapshot {
  return { companyBp: r.companyBp, reserveBp: r.reserveBp, gst: r.gst, tds: r.tds, founders: r.founders };
}

/**
 * The rules for a project: the snapshot saved on it (if it has had a payment),
 * otherwise today's Settings and active founders. Pass undefined for the free
 * calculator (current Settings only).
 */
export function useRules(project: ProjectDetailRow | undefined | null): {
  rules: Rules | null;
  error: string | null;
  fromSnapshot: boolean;
} {
  const settingsQ = useSettings();
  const foundersQ = useFounders();
  return useMemo(() => {
    const snap = project?.settings_snapshot;
    if (snap && snap.founders) {
      return {
        rules: { companyBp: snap.companyBp, reserveBp: snap.reserveBp, gst: snap.gst, tds: snap.tds, founders: snap.founders },
        error: null,
        fromSnapshot: true,
      };
    }
    if (!settingsQ.data || !foundersQ.data) return { rules: null, error: null, fromSnapshot: false };
    const founders = foundersQ.data
      .filter((f) => f.is_active)
      .map((f) => ({ id: f.id, name: f.name, weightBp: f.weight_bp }));
    try {
      if (founders.length === 0) throw new Error("Add your founders in Settings first.");
      assertBpTotal(founders.map((f) => f.weightBp), "Founder weights");
    } catch (e) {
      return { rules: null, error: e instanceof Error ? e.message : "Check founder settings", fromSnapshot: false };
    }
    const s = settingsQ.data;
    return {
      rules: { companyBp: s.split.companyBp, reserveBp: s.split.reserveBp, gst: s.tax.gst, tds: s.tax.tds, founders },
      error: null,
      fromSnapshot: false,
    };
  }, [project, settingsQ.data, foundersQ.data]);
}
