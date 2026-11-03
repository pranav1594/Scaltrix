import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface FounderRow {
  id: string;
  name: string;
  email: string | null;
  weight_bp: number;
  is_active: boolean;
}

export function useFounders() {
  return useQuery({
    queryKey: ["founders"],
    queryFn: async (): Promise<FounderRow[]> => {
      const { data, error } = await supabase
        .from("founders")
        .select("id,name,email,weight_bp,is_active")
        .order("weight_bp", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveFounders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: Partial<FounderRow>[]) => {
      const { error } = await supabase.from("founders").upsert(rows);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["founders"] }),
  });
}
