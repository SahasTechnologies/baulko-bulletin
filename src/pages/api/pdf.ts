import type { APIRoute } from "astro";

export const prerender = false;

function allowed(src: string) {
  try {
    const host = new URL(src).hostname;
    return (
      host === "cdn.sanity.io" ||
      host.endsWith(".sanity.io") ||
      host === "s3.filebase.com" ||
      host.endsWith(".filebase.com") ||
      host === "ik.imagekit.io" ||
      host.endsWith(".imagekit.io")
    );
  } catch {
    return false;
  }
}

export const GET: APIRoute = async ({ url }) => {
  const src = url.searchParams.get("src") || "";
  if (!src || !allowed(src)) {
    return new Response("Forbidden", { status: 403 });
  }
  const res = await fetch(src);
  if (!res.ok) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/pdf",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
