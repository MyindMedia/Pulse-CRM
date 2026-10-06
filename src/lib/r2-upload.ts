/* Browser side of an R2 upload. The server hands back a one-time signed URL
   (mutation), this PUTs the file straight to R2, and the caller then confirms
   the upload (action) before attaching it. Bytes never pass through Convex. */

export type PreparedUpload = { mediaId: string; url: string; headers: Record<string, string> };

export async function putToR2(file: Blob, prep: PreparedUpload, signal?: AbortSignal): Promise<void> {
  const res = await fetch(prep.url, { method: "PUT", headers: prep.headers, body: file, signal });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
}

/** True when the deployment has no R2 settings yet, so the caller can use the
 *  older Convex-storage upload instead of failing. */
export function r2NotConfigured(err: unknown): boolean {
  return err instanceof Error && /R2 is not configured/i.test(err.message);
}
