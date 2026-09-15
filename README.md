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
| `/admin/contacts` | Who contact messages are emailed to, plus a test send |

### Environment

```
ADMIN_PASSWORD="…"          # required — the panel is off while this is unset
ADMIN_SESSION_SECRET="…"    # optional — set it to revoke all sessions by rotation
IMAGEKIT_PUBLIC_KEY="…"     # required for uploads from the panel
IMAGEKIT_PRIVATE_KEY="…"    # signs each upload; never leaves the server
```

Add them to the Vercel project's environment variables as well as your local
`.env`. `ADMIN_PASSWORD` must never be renamed to `PUBLIC_ADMIN_PASSWORD`:
`PUBLIC_*` values are inlined into the client bundle.

The ImageKit key only needs upload permission. Its media-management API is
refused for a restricted key, which is why deleting a file (or the panel's own
occasional test upload) happens in the ImageKit dashboard.

### Uploading covers and PDFs

Covers and issue PDFs are stored on ImageKit, and the panel uploads them for you:
choosing a file gets a short-lived signature from `/api/admin/upload-auth` and
sends it straight to ImageKit from the browser. Nothing large passes through the
app, which is what makes 9 MB issue PDFs possible — a Vercel function only
accepts a 4.5 MB request body.

Images get a crop step first. Covers are shown edge to edge at a fixed ratio, so
pick a ratio (Cover 2:1 matches the site), drag the picture to choose which part
to keep, zoom if you need to, then upload. The crop is rendered from the original
file at full resolution, not from the on-screen preview. Uploaded files are
placed at `bulletin/` for images and `bulletin/pdfs/` for PDFs, and each upload
gets a fresh name — re-uploading over an existing name leaves ImageKit's CDN
serving the old bytes.

`rename-media.mjs` still tidies names in bulk, and
`node tools/trim-cover-borders.mjs <slug>` removes the even border a cover that
was photographed against a light backdrop leaves behind (add `--write` to upload
and repoint the row, `--index` to survey every cover).

### Puzzles

Puzzles are typed in with fields rather than in the stored format: one row per
answer with its grid position, direction and clue for a crossword; a grid plus a
word list for a find-a-word; scrambled/answer pairs for an unscramble. The panel
generates the compact text the public components parse, and a “raw data” view
stays available for fixing anything by hand. A puzzle can be attached to the
issue it appeared in, and those puzzles are then listed at the foot of that
issue's page.

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
