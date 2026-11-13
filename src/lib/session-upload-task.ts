import type { ConvexReactClient } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { putToR2WithProgress } from "./r2-upload";
import type { UploadTask } from "./upload-manager";

/* One session file upload, captured whole when it is added: the booking, the
   artist, the file, whether it becomes a new song, and the Convex client to
   call. Nothing here reads a React hook, so the upload finishes after the
   panel that started it has closed (F2-20).

   Steps: prepare (signed PUT) -> PUT to R2 with progress -> commit -> confirm
   -> create the song (when asked) -> attach. The commit is the point of no
   return (F2-24): a cancel before it stops the upload and leaves only an
   unconfirmed upload, which the media-sweep-pending cron clears; a cancel
   after it is ignored and the row ends as Uploaded, so a cancel can never
   leave a confirmed file or a new empty song with nothing attached. */

type Calls = Pick<ConvexReactClient, "mutation" | "action">;

/** The server's own message for a refused step, else a plain fallback. */
export function uploadErrorText(err: unknown): string {
  let msg = "";
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (typeof data === "string") msg = data;
    else if (data && typeof data === "object" && "message" in data) msg = String((data as { message: unknown }).message);
  }
  if (!msg && err instanceof Error && err.message) {
    msg = err.message.replace(/^\[.*?\]\s*/, "").replace(/^Uncaught \w+:\s*/, "");
  }
  if (!msg) return "Upload failed.";
  return /R2 is not configured/i.test(msg) ? "File storage is not set up on this deployment yet." : msg;
}

export function sessionFileTask(
  client: Calls,
  job: {
    sessionId: Id<"sessions">;
    artistId: Id<"artists">;
    file: File;
    asSong: boolean;
    onDone?: () => void;
  },
): UploadTask {
  const { sessionId, artistId, file, asSong } = job;
  const fileName = file.name || "upload";
  return {
    name: fileName,
    size: file.size,
    errorText: uploadErrorText,
    onDone: job.onDone,
    run: async ({ signal, onProgress, commit }) => {
      const mimeType = file.type || "application/octet-stream";
      const prep = await client.mutation(api.sessionFiles.prepareUpload, { sessionId, fileName, mimeType, size: file.size });
      await putToR2WithProgress(file, prep, onProgress, signal);
      commit();
      const mediaId = prep.mediaId as Id<"mediaFiles">;
      await client.action(api.media.confirmUpload, { mediaId });
      let songId: Id<"songs"> | undefined;
      if (asSong) {
        const title = fileName.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || "Untitled";
        songId = (await client.mutation(api.songs.create, { title, artistId, kind: "single" })) as Id<"songs">;
      }
      await client.mutation(api.sessionFiles.attach, { sessionId, mediaId, songId });
    },
  };
}
