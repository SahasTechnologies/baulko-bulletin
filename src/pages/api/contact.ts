import type { APIRoute } from "astro";
import { neon } from "@neondatabase/serverless";
import { getContactRecipients } from "@/lib/db";

export const prerender = false;

// Resend's shared sender works without a verified domain, but it only delivers
// to the Resend account owner — fine for testing, replace it via RESEND_FROM.
const DEFAULT_FROM = "Baulko Bulletin <onboarding@resend.dev>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function getSql() {
  const url = import.meta.env.DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

/**
 * Emails the submission to everyone on the contact list.
 * Never throws: a mail failure must not lose a submission that's already saved.
 */
async function notifyRecipients(input: { name: string; email: string; message: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[contact] RESEND_API_KEY is not set — saved without emailing");
    return;
  }

  const recipients = await getContactRecipients();
  if (!recipients.length) {
    console.warn("[contact] no active contact_recipients rows — saved without emailing");
    return;
  }

  const to = recipients.map((r) => r.email);
  const safe = {
    name: escapeHtml(input.name),
    email: escapeHtml(input.email),
    message: escapeHtml(input.message).replace(/\n/g, "<br>"),
  };

  const text = [
    `New message via the Baulko Bulletin contact form.`,
    ``,
    `Name:    ${input.name}`,
    `Email:   ${input.email}`,
    ``,
    input.message,
  ].join("\n");

  const html = `
    <h2 style="margin:0 0 16px">New contact form message</h2>
    <p style="margin:0 0 4px"><strong>Name:</strong> ${safe.name}</p>
    <p style="margin:0 0 16px"><strong>Email:</strong> ${safe.email}</p>
    <div style="padding:16px;border-radius:12px;background:#f4f4f5">${safe.message}</div>
  `;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || DEFAULT_FROM,
        to,
        reply_to: input.email,
        subject: `Contact form: ${input.name}`,
        text,
        html,
      }),
    });

    if (!res.ok) {
      console.error("[contact] Resend rejected the send:", res.status, await res.text());
      return;
    }
    console.log(`[contact] emailed ${to.length} recipient(s)`);
  } catch (err) {
    console.error("[contact] Resend request failed:", err);
  }
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

    // Awaited: a serverless function can be frozen as soon as we respond.
    await notifyRecipients({ name, email, message });

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
