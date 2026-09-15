import type { APIRoute } from "astro";
import { jsonResponse, requireAdmin } from "@/lib/admin";
import { imageKitConfigured, uploadAuth, uploadEndpoint, uploadFolder, type UploadKind } from "@/lib/imagekit";

export const prerender = false;

/**
 * Hands an authenticated editor a short-lived ImageKit signature so the browser
 * can upload a file directly to ImageKit. Middleware already rejects anonymous
 * callers on `/api/admin/*`; the session check here is the second layer.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ ok: false, error: "Not signed in." }, 401);

  if (!imageKitConfigured()) {
    return jsonResponse(
      {
        ok: false,
        error:
          "ImageKit is not configured. Set IMAGEKIT_PUBLIC_KEY and IMAGEKIT_PRIVATE_KEY in the environment.",
      },
      503
    );
  }

  const requested = url.searchParams.get("kind");
  const kind: UploadKind = requested === "pdf" ? "pdf" : "image";

  const auth = uploadAuth();
  if (!auth) return jsonResponse({ ok: false, error: "ImageKit is not configured." }, 503);

  return jsonResponse({
    ok: true,
    kind,
    endpoint: uploadEndpoint(),
    folder: uploadFolder(kind),
    publicKey: auth.publicKey,
    token: auth.token,
    expire: auth.expire,
    signature: auth.signature,
  });
};
