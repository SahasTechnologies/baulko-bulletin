import type { APIRoute } from "astro";
import { ENTITIES, isEntityKey } from "@/lib/admin-entities";
import { deleteRow, entityUsesSlug, getRow, isUuid, saveRow } from "@/lib/admin-db";
import { releaseReplacedMedia } from "@/lib/media-cleanup";
import {
  csrfOk,
  flashTo,
  jsonResponse,
  originAllowed,
  requireAdmin,
  resolvedSlug,
  validateEntityForm,
} from "@/lib/admin";

export const prerender = false;

/**
 * Create, update and delete for the three content types. One route instead of
 * three because the shape of every request is identical — the entity's declared
 * fields decide what is read, validated and written.
 *
 * Note that the middleware already rejected anonymous callers; the session and
 * CSRF checks below are the second and third layers, so a mistake in the
 * matcher still cannot expose a write.
 */
export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ ok: false, error: "Not signed in." }, 401);

  if (!originAllowed(request)) {
    console.warn("[admin] content write rejected: cross-origin request");
    return jsonResponse({ ok: false, error: "Cross-origin request rejected." }, 403);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return jsonResponse({ ok: false, error: "Malformed form submission." }, 400);

  if (!(await csrfOk(session, form))) {
    console.warn("[admin] content write rejected: bad CSRF token");
    return flashTo(
      "/admin",
      "error",
      "Your session check failed — sign in again, then resubmit the form."
    );
  }

  const entity = String(form.get("entity") ?? "");
  if (!isEntityKey(entity)) return flashTo("/admin", "error", "Unknown content type.");

  const def = ENTITIES[entity];
  const base = `/admin/${def.key}`;
  const action = String(form.get("action") ?? "create");
  const id = String(form.get("id") ?? "");
  const editing = action === "update" && isUuid(id);

  // Where a failed write sends the editor back to. Values are re-read from the
  // database there, so a rejected save loses in-progress edits — acceptable for
  // a one-operator tool, where the browser's own required/maxlength checks and
  // the puzzle editor's live validation catch almost everything before it
  // reaches here. The page it lands on renders the message, so a refusal that
  // does get this far is at least explained.
  const returnTo = editing ? `${base}/${id}` : action === "delete" ? base : `${base}/new`;

  try {
    if (action === "delete") {
      if (!isUuid(id)) return flashTo(base, "error", "Nothing to delete.");
      const removed = await deleteRow(def.key, id);
      return flashTo(
        base,
        removed ? "ok" : "error",
        removed ? `${def.singular} deleted.` : "That item was already gone."
      );
    }

    const { values, error, notes } = validateEntityForm(def, form);
    if (error) return flashTo(returnTo, "error", error);

    // Read the row before it is written, so the media it used to point at is
    // known. `saveRow` overwrites the URL and the old one is then unrecoverable
    // from the database.
    const before = editing ? await getRow(def.key, id) : null;

    const saved = await saveRow(def.key, editing ? id : null, {
      ...values,
      slug: entityUsesSlug(def.key) ? resolvedSlug(values) : "",
    });

    // The row is saved; from here on nothing may fail the request. A replaced
    // cover or PDF is removed from ImageKit unless something else still points
    // at it, and the editor is told when a file actually went, since that is
    // the one part of this they cannot undo.
    const released = await releaseReplacedMedia(before, values);
    const removed = released.deleted.length
      ? released.deleted.length === 1
        ? " The file it replaced was deleted from ImageKit."
        : ` The ${released.deleted.length} files it replaced were deleted from ImageKit.`
      : "";

    return flashTo(
      `${base}/${saved.id}`,
      "ok",
      `${editing ? `${def.singular} updated.` : `${def.singular} created.`}${notes.length ? ` ${notes.join(" ")}` : ""}${removed}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin] write failed:", err);
    return flashTo(returnTo, "error", `Could not save: ${message}`);
  }
};
