/* Browser side of an R2 upload. The server hands back a one-time signed URL
   (mutation), this PUTs the file straight to R2, and the caller then confirms
   the upload (action) before attaching it. Bytes never pass through Convex. */

export type PreparedUpload = { mediaId: string; url: string; headers: Record<string, string> };

export async function putToR2(file: Blob, prep: PreparedUpload, signal?: AbortSignal): Promise<void> {
  const res = await fetch(prep.url, { method: "PUT", headers: prep.headers, body: file, signal });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
}

/** Same PUT as putToR2, over XMLHttpRequest so the browser reports how many
 *  bytes have gone out (fetch cannot). Aborting rejects with a DOMException
 *  named "AbortError". */
export function putToR2WithProgress(
  file: Blob,
  prep: PreparedUpload,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload canceled.", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const finish = () => signal?.removeEventListener("abort", onAbort);
    xhr.open("PUT", prep.url);
    for (const [name, value] of Object.entries(prep.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      onProgress(e.lengthComputable ? e.loaded : Math.min(e.loaded, file.size), e.lengthComputable ? e.total : file.size);
    };
    xhr.onload = () => {
      finish();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size, file.size);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => {
      finish();
      reject(new Error("Upload failed. Check your connection and try again."));
    };
    xhr.onabort = () => {
      finish();
      reject(new DOMException("Upload canceled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(file);
  });
}

/** True when the deployment has no R2 settings yet, so the caller can use the
 *  older Convex-storage upload instead of failing. */
export function r2NotConfigured(err: unknown): boolean {
  return err instanceof Error && /R2 is not configured/i.test(err.message);
}
