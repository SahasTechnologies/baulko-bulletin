const COVER_W = 2000;
const COVER_H = 1000;

function withTransform(src: string, imagekit: string, sanity: Record<string, string>): string {
  try {
    const u = new URL(src);
    if (u.hostname.includes("imagekit.io")) {
      const current = u.searchParams.get("tr");
      u.searchParams.set("tr", current ? `${current},${imagekit}` : imagekit);
      return u.toString();
    }
    if (u.hostname.includes("sanity.io")) {
      for (const [k, v] of Object.entries(sanity)) u.searchParams.set(k, v);
      return u.toString();
    }
  } catch {
    return src;
  }
  return src;
}

export function croppedCoverUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  return withTransform(src, `w-${COVER_W},h-${COVER_H},fo-auto`, {
    w: String(COVER_W),
    h: String(COVER_H),
    fit: "crop",
    auto: "format",
  });
}

export function croppedSquareUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  return withTransform(src, "w-1000,h-1000,fo-auto", {
    w: "1000",
    h: "1000",
    fit: "crop",
    auto: "format",
  });
}
