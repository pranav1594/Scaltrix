import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anon && !url.includes("your-project-id"));

// Placeholder values keep the app from crashing before .env is filled in;
// App.tsx shows a setup screen whenever isConfigured is false.
export const supabase = createClient(
  isConfigured ? url! : "https://placeholder.supabase.co",
  isConfigured ? anon! : "placeholder-key",
);

/** Bucket names come from .env so they can be renamed without touching code. */
export const BUCKETS = {
  reserve: import.meta.env.VITE_BUCKET_RESERVE ?? "reserve-expenses",
  projectInvoices: import.meta.env.VITE_BUCKET_PROJECT_INVOICES ?? "project-invoices",
  clientPayments: import.meta.env.VITE_BUCKET_CLIENT_PAYMENTS ?? "client-payments",
  products: import.meta.env.VITE_BUCKET_PRODUCTS ?? "product-invoices",
  bondsClients: import.meta.env.VITE_BUCKET_BONDS_CLIENTS ?? "bonds-clients",
  bondsFounders: import.meta.env.VITE_BUCKET_BONDS_FOUNDERS ?? "bonds-founders",
  bondsEmployees: import.meta.env.VITE_BUCKET_BONDS_EMPLOYEES ?? "bonds-employees",
  exports: import.meta.env.VITE_BUCKET_EXPORTS ?? "exports",
} as const;

/** Short-lived link for the "View Bill" buttons (valid for 5 minutes). */
export async function signedUrl(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data) throw error ?? new Error("Could not create link");
  return data.signedUrl;
}
