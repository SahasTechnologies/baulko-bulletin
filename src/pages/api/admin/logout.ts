import type { APIRoute } from "astro";
import { clearSessionCookie, isSecureRequest } from "@/lib/auth";
import { csrfOk, flashTo, jsonResponse, originAllowed, redirectTo, requireAdmin } from "@/lib/admin";

export const prerender = false;

function signOut(request: Request): Response {
  return redirectTo("/admin/login", { "Set-Cookie": clearSessionCookie(isSecureRequest(request)) });
}

export const POST: APIRoute = async ({ request }) => {
  if (!originAllowed(request)) return jsonResponse({ ok: false, error: "Cross-origin request." }, 403);

  const session = await requireAdmin(request);
  if (!session) return signOut(request);

  // A forged logout is harmless but annoying; require the form token like any
  // other authenticated write.
  const form = await request.formData().catch(() => null);
  if (form && !(await csrfOk(session, form))) {
    console.warn("[admin] logout rejected: bad CSRF token");
    return flashTo("/admin", "error", "Session check failed — reload the page and try again.");
  }

  return signOut(request);
};
