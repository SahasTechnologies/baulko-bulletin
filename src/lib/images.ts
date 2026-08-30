const COVER_W = 2000;
const COVER_H = 1000;

export function croppedCoverUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    const u = new URL(src);
    if (u.hostname.includes("imagekit.io")) {
      const extra = `w-${COVER_W},h-${COVER_H},fo-auto`;
      const current = u.searchParams.get("tr");
      u.searchParams.set("tr", current ? `${current},${extra}` : extra);
      return u.toString();
    }
    if (u.hostname.includes("sanity.io")) {
      u.searchParams.set("w", String(COVER_W));
      u.searchParams.set("h", String(COVER_H));
      u.searchParams.set("fit", "crop");
      u.searchParams.set("auto", "format");
      return u.toString();
    }
  } catch {
    return src;
  }
  return src;
}
