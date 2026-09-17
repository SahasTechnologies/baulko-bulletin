/**
 * Deleting the media a save has stopped pointing at.
 *
 * The panel uploads straight to ImageKit and stores only the URL, so replacing
 * a cover or an issue PDF used to leave the old file in the bucket forever.
 * Nothing cleaned them up: `rename-media.mjs` re-uploads under a new name and
 * orphans the original too, so the bucket only ever grew.
 *
 * Two things make this safe enough to run automatically.
 *
 * It only ever touches our own files. `filePathFromImageKitUrl` returns null
 * for anything not served from this account's ImageKit endpoint, so a cover
 * that was pasted in from somewhere else is never a deletion candidate.
 *
 * And it checks whether the file is still used before removing it. The same
 * picture can be two rows' cover, or embedded in an article's body HTML, and
 * the reference check looks at every column that can hold a media URL — the
 * path is unique, so finding it anywhere means the file stays.
 *
 * It is best-effort by design. The row is already saved by the time this runs,
 * so a failure here is logged and reported, never thrown: a save must not fail
 * because a bucket would not answer.
 */

import type { ContentRow } from "@/lib/admin-entities";
import { countMediaReferences } from "@/lib/admin-db";
import { deleteImageKitFile, filePathFromImageKitUrl } from "@/lib/imagekit";

/** The columns media lives in, across all three content types. */
const MEDIA_FIELDS = ["cover_image_url", "pdf_url"] as const;

export interface ReleaseOutcome {
  /** Paths removed from ImageKit. */
  deleted: string[];
  /** Paths left alone because something else still points at them. */
  kept: string[];
  /** Paths that could not be removed — already gone, or ImageKit refused. */
  skipped: string[];
}

/**
 * Releases the files a save has replaced or cleared.
 *
 * Takes the row as it was and the values that were just written, so the
 * comparison is between what the database held and what it holds now. A field
 * whose path is unchanged is left alone even if its URL differs — the same file
 * requested with a different `?tr=` transform is not a replacement.
 */
export async function releaseReplacedMedia(
  before: ContentRow | null,
  after: Record<string, string>
): Promise<ReleaseOutcome> {
  const outcome: ReleaseOutcome = { deleted: [], kept: [], skipped: [] };
  if (!before) return outcome;

  for (const field of MEDIA_FIELDS) {
    const previous = filePathFromImageKitUrl(before[field] ?? "");
    if (!previous) continue;
    if (previous === filePathFromImageKitUrl(after[field] ?? "")) continue;

    try {
      if ((await countMediaReferences(previous)) > 0) {
        outcome.kept.push(previous);
        continue;
      }
      const result = await deleteImageKitFile(previous);
      if (result === "deleted") outcome.deleted.push(previous);
      else if (result !== "missing") outcome.skipped.push(previous);
    } catch (err) {
      console.error(`[media] could not release ${previous}:`, err);
      outcome.skipped.push(previous);
    }
  }

  return outcome;
}
