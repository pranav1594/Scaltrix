import { signedUrl, supabase } from "./supabase";

export const ACCEPTED_FILES = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx";
export const MAX_FILE_MB = 25;

/**
 * Upload a file to a private bucket and record it in the `documents` table.
 * Returns the new document id, which other tables point to (e.g. payments.document_id).
 */
export async function uploadDocument(opts: {
  bucket: string;
  file: File;
  folder: string; // e.g. the project id
  linkedTable?: string;
  linkedId?: string;
}): Promise<string> {
  const { bucket, file, folder, linkedTable, linkedId } = opts;
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`File is larger than ${MAX_FILE_MB} MB`);
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${folder}/${Date.now()}-${safeName}`;

  const up = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (up.error) throw up.error;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      bucket,
      path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      linked_table: linkedTable ?? null,
      linked_id: linkedId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Open a stored document in a new window using a short-lived signed link. */
export async function openDocument(documentId: string): Promise<void> {
  const { data, error } = await supabase
    .from("documents")
    .select("bucket,path")
    .eq("id", documentId)
    .single();
  if (error || !data) throw error ?? new Error("Document not found");
  const url = await signedUrl(data.bucket, data.path);
  window.open(url, "_blank", "noopener");
}
