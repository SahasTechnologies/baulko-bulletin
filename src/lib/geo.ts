/**
 * Turning the address a contact message arrived on into a place.
 *
 * This is deliberately not a route and not called from the browser. ip-api's
 * free endpoint is HTTP-only, so a fetch from an HTTPS page is blocked as mixed
 * content — and a lookup made when the panel is opened would answer "where is
 * the operator", which is the wrong question. The address is the one the
 * submission itself carried (`x-forwarded-for` on Vercel), resolved once, as
 * the message is stored.
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
 * `"Sydney, Australia"`, or null when the address cannot be placed.
 *
 * Never throws. A message has to be stored whether or not a third party can say
 * where it came from, so every failure here is a missing label rather than a
 * lost submission — the row keeps its place in the panel either way. The free
 * tier allows 45 lookups a minute per source address and answers 429 past that.
 */
export async function placeFor(ip: string | null): Promise<string | null> {
  if (!ip) return null;

  try {
    // Long enough for a slow lookup, short enough that somebody filling in the
    // form is not left waiting on a service they never asked for.
    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${FIELDS}`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`ip-api responded ${response.status}`);

    const geo = (await response.json()) as Record<string, unknown>;
    if (geo.status !== "success") throw new Error(String(geo.message || "lookup failed"));

    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const city = text(geo.city);
    const region = text(geo.regionName);
    const countryCode = text(geo.countryCode).toUpperCase();
    const country = COUNTRY_NAMES[countryCode] || text(geo.country);
    // "Sydney, Australia" — a lookup with no city still has a country, and one
    // with neither leaves the panel showing the time on its own.
    return [city || region, country].filter(Boolean).join(", ") || null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[geo] could not place ${ip}: ${reason}`);
    return null;
  }
}
