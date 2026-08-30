import type { APIRoute } from "astro";
import { neon } from "@neondatabase/serverless";

export const prerender = false;

function getSql() {
  const url = import.meta.env.DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get("content-type") || "";
    let name = "";
    let email = "";
    let message = "";
    let website = "";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      name = String(body.name || "").trim();
      email = String(body.email || "").trim();
      message = String(body.message || "").trim();
      website = String(body.website || "").trim();
    } else {
      const form = await request.formData();
      name = String(form.get("name") || "").trim();
      email = String(form.get("email") || "").trim();
      message = String(form.get("message") || "").trim();
      website = String(form.get("website") || "").trim();
    }

    if (website) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ ok: false, error: "Name, email and message are required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (name.length > 200 || email.length > 320 || message.length > 5000) {
      return new Response(
        JSON.stringify({ ok: false, error: "Input too long." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid email address." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const sql = getSql();
    await sql`
      INSERT INTO contact_submissions (name, email, message)
      VALUES (${name}, ${email}, ${message})
    `;

    const accept = request.headers.get("accept") || "";
    if (accept.includes("text/html")) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/contact?sent=1" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("contact form error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "Something went wrong. Please try again." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
