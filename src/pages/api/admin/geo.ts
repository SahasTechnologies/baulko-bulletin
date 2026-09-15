import type { APIRoute } from "astro";
import { jsonResponse, requireAdmin } from "@/lib/admin";
import { clientIp } from "@/lib/auth";

export const prerender = false;

/**
 * Where the signed-in operator is reading from, for the timestamps in the
 * panel.
 *
 * The browser cannot ask ip-api.com itself: the free endpoint is HTTP-only, so
 * a fetch from an HTTPS page is blocked as mixed content. The lookup therefore
 * happens here, and the panel asks its own origin instead.
 *
 * The address is the caller's own, taken from the proxy headers, so this only
 * ever reports a requester's location back to that requester — it is not a
 * general-purpose geolocation proxy.
 */

const FIELDS = "status,message,country,countryCode,regionName,city";

/**
 * ip-api spells these as countries of their own; they are not, so they are
 * named the way the rest of the site names them.
 */
const COUNTRY_NAMES: Record<string, string> = {
  TW: "Taiwan, China",
  HK: "Hong Kong, China",
  MO: "Macao, China",
};

/**
 * One lookup. An empty `query` asks about the server's own address. ip-api
 * answers `status: "fail"` rather than an HTTP error for anything it cannot
 * place, so both shapes have to be treated as a failure.
 */
async function lookup(query: string): Promise<Record<string, unknown>> {
  // The free tier allows 45 lookups a minute per source address and answers
  // 429 past that; the panel treats any failure here as "no place", so a
  // throttled lookup costs a label rather than the page.
  const response = await fetch(`http://ip-api.com/json/${query}?fields=${FIELDS}`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`ip-api responded ${response.status}`);
  const geo = (await response.json()) as Record<string, unknown>;
  if (geo.status !== "success") throw new Error(String(geo.message || "lookup failed"));
  return geo;
}

/** Places the caller, falling back to the server's own address. */
async function locate(ip: string): Promise<Record<string, unknown>> {
  if (ip !== "unknown") {
    try {
      return await lookup(encodeURIComponent(ip));
    } catch (err) {
      // A loopback or private address — every request `astro dev` serves — is
      // not something ip-api will place; it answers "reserved range". Asking
      // about the server's own address instead is wrong in principle and
      // usually right in practice, since the operator and the server tend to
      // be in the same country.
      const reason = err instanceof Error ? err.message : String(err);
      console.info(`[geo] could not place ${ip} (${reason}) — asking about the server instead`);
    }
  }
  return lookup("");
}

export const GET: APIRoute = async ({ request, clientAddress }) => {
  // The middleware gates /api/admin/* already; this is defence in depth.
  const session = await requireAdmin(request);
  if (!session) return jsonResponse({ ok: false, error: "Not signed in." }, 401);

  try {
    const geo = await locate(clientIp(request, clientAddress));

    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const city = text(geo.city);
    const region = text(geo.regionName);
    const countryCode = text(geo.countryCode).toUpperCase();
    const country = COUNTRY_NAMES[countryCode] || text(geo.country);
    // "Sydney, Australia" — a lookup with no city still has a country, and one
    // with neither leaves the panel on its timezone-derived label.
    const place = [city || region, country].filter(Boolean).join(", ");

    return jsonResponse({ ok: true, place });
  } catch (err) {
    console.error("[geo] lookup failed:", err);
    return jsonResponse({ ok: false, error: "Location lookup failed." }, 502);
  }
};
