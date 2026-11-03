import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface AppSettings {
  split: { companyBp: number; reserveBp: number };
  founder_advance: { mode: "equalizing" | "loan" };
  contribution: { method: "hours" | "task_points" | "manual_rating" | "mix" };
  extra_recovery: { mode: "one_time" | "installments" | "per_project"; count?: number; bp?: number };
  bond_compensation: { kind: "percent" | "fixed" | "per_missed"; bp?: number; paise?: number };
  tax: {
    gst: { enabled: boolean; rateBp: number };
    tds: { enabled: boolean; rateBp: number };
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  split: { companyBp: 5000, reserveBp: 8000 },
  founder_advance: { mode: "equalizing" },
  contribution: { method: "manual_rating" },
  extra_recovery: { mode: "installments", count: 3 },
  bond_compensation: { kind: "percent", bp: 1000 },
  tax: { gst: { enabled: false, rateBp: 1800 }, tds: { enabled: false, rateBp: 1000 } },
};

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase.from("settings").select("key,value");
      if (error) throw error;
      const merged: Record<string, unknown> = { ...DEFAULT_APP_SETTINGS };
      for (const row of data ?? []) merged[row.key] = row.value;
      return merged as unknown as AppSettings;
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: AppSettings) => {
      const rows = Object.entries(s).map(([key, value]) => ({
        key,
        value,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("settings").upsert(rows);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
