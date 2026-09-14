# Baulko Bulletin

Student newspaper of Baulkham Hills High School.

Visit [baulkobulletin.com](https://baulkobulletin.com).

## Development

```bash
npm install
npm run dev        # http://localhost:4321
npm run check      # astro check (types + template diagnostics)
npm run build      # production build
```

Content lives in Postgres (Neon); `DATABASE_URL` is required. All copy is served
from the `posts`, `extras`, `puzzles`, `pages`, `authors` and `settings` tables.

## Admin panel

Everything published on the site is edited at **`/admin`** — sign in with the
password in `ADMIN_PASSWORD`.

| Section | What it edits |
| --- | --- |
| `/admin/posts` | Issues (title, slug, date, excerpt, PDF URL, cover, HTML content) |
| `/admin/extras` | Extras — stories, poetry, illustrations |
| `/admin/puzzles` | Crosswords, find-a-words and unscrambles |
| `/admin/pages` | The About, FAQ and Join page bodies |
| `/admin/settings` | Site title, description, footer and social preview |
| `/admin/messages` | Contact form submissions, with read/unread and delete |

### Environment

```
ADMIN_PASSWORD="…"          # required — the panel is off while this is unset
ADMIN_SESSION_SECRET="…"    # optional — set it to revoke all sessions by rotation
```

Add both to the Vercel project's environment variables as well as your local
`.env`. `ADMIN_PASSWORD` must never be renamed to `PUBLIC_ADMIN_PASSWORD`:
`PUBLIC_*` values are inlined into the client bundle.

Covers and issue PDFs are stored on ImageKit, so the forms take URLs rather than
file uploads. Upload via the ImageKit dashboard (or `rename-media.mjs`) and paste
the resulting URL. Existing PDFs live under `bulletin/pdfs` and covers at the
bucket root.

### Security model

- **One shared password**, compared in constant time, exchanged for a signed
  (HMAC-SHA256) session cookie: `HttpOnly`, `SameSite=Strict`, `Secure` on https,
  12-hour expiry with sliding renewal.
- **Fail closed.** With no `ADMIN_PASSWORD`, the login endpoint rejects every
  attempt and says so. An unset variable can never mean "empty password is fine".
- **Three layers on every write:** middleware gates `/admin` and `/api/admin`,
  the route itself re-checks the session, and the form must carry a CSRF token
  derived from that session. Cross-origin POSTs are rejected by an Origin check.
- **No caching, no indexing, no framing** for any admin response
  (`no-store`, `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, plus
  `frame-ancestors 'none'`), and `/admin` is disallowed in `robots.txt`.
- **Login throttling:** 8 failures per IP per 10 minutes, with a 400 ms delay on
  each failure. The counter is in memory, so on serverless it is per instance
  rather than global.
- **Revoking access:** change `ADMIN_PASSWORD`, or set/rotate
  `ADMIN_SESSION_SECRET` to invalidate every existing session immediately.
