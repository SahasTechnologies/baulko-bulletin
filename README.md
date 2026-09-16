# Baulko Bulletin

Student newspaper of Baulkham Hills High School.
Visit [baulkobulletin.com](https://baulkobulletin.com).

A single Astro app serves the public site and the staff panel that fills it. All
copy — issues, extras, puzzles, page bodies and the footer — lives in Postgres,
and every picture and PDF lives on ImageKit. There is no CMS database, no
Markdown and no build step between typing in the panel and the page changing.

## Stack

| Piece | What it does |
| --- | --- |
| Astro 7 | Pages, routing and the server routes. Deployed to Vercel through `@astrojs/vercel`. |
| React 19 islands | The only interactive parts: the image uploader/cropper, the puzzle builder, the theme toggle, the contact form. |
| Tailwind CSS 4 | Styling, via `@tailwindcss/vite`. `src/styles/global.css` holds the hand-written pieces. |
| Neon Postgres | All content. Reached with `@neondatabase/serverless` over HTTP. |
| ImageKit | Every image and issue PDF, plus the URL transforms that crop covers. |
| Resend | Emails contact submissions to the addresses on the contact list. |
| pdf.js | Reads issue PDFs in the browser (`scripts/sync-pdfjs-assets.mjs` copies it into `public/pdfjs` on install and build). Both of its entry points are named in `astro.config.mjs`'s `optimizeDeps`, so a dev session never re-bundles it out from under a page that is already open — which used to fail the reader with a 504. |
| Cloudflare Turnstile | Optional CAPTCHA on the contact form. |

## Development

```bash
npm install
npm run dev        # http://localhost:4321
npm run check      # types, template diagnostics, the generated icons and the tests
npm test           # just the parser tests in src/lib/*.test.ts
npm run icons      # regenerate src/lib/icons.generated.ts after adding an icon
npm run logo:dark  # regenerate public/bulletin-dark.png after replacing the logo
npm run build      # production build
npm run preview    # serve the built output
```

`npm run dev` needs a reachable `DATABASE_URL`. Without one the public site still
builds and serves — `src/lib/db.ts` swallows query errors and falls back to empty
content rather than 500ing — but every listing will be empty and the admin panel
will say so.

## Routes

| Public | What it is |
| --- | --- |
| `/` | The latest issue (PDF viewer or HTML body), then the five most recent issues and the five most recent extras, each with a “View more” link. |
| `/posts` | Every issue, as cards, newest first, under a fuzzy search over titles, descriptions, authors and dates. |
| `/posts/<slug>` | One issue: cover, PDF viewer or HTML body, and the puzzles attached to it. |
| `/extras` | Every extra — stories, poetry, illustrations, with the same search. |
| `/extras/<slug>` | One extra, with its author byline. |
| `/puzzles` · `/puzzles/<slug>` | The puzzle list and one interactive puzzle. The route still accepts the position-in-the-list numbers puzzles were once addressed by and redirects to the slug. |
| `/about` · `/faq` · `/join` | The three editable pages, body HTML included. |
| `/contact` | The contact form, with the recipient list from the database. |
| `/admin` | The panel (see below). Everything under it is `noindex`, `no-store` and unframable. |

Server routes: `/api/contact` is the public form; `/api/admin/{login,logout,content,pages,settings,messages,contacts,upload-auth}` are the panel's writes, all session- and CSRF-gated.

## Data model

There is no migration tool in this repo — the schema lives in the Neon project,
and these are the tables the code reads and writes. A fresh database needs this
schema created before the panel will work. `posts.slug`, `extras.slug` and
`puzzles.slug` are each `text not null` with a unique index, since all three are
addressed by slug in the URL (`puzzles.slug` was added later: puzzles used to be
addressed by their position in the newest-first list).

| Table | Columns |
| --- | --- |
| `posts` | `id`, `title`, `slug`, `excerpt`, `content`, `cover_image_url`, `cover_image_alt`, `date`, `pdf_url`, `author_id` |
| `extras` | `id`, `title`, `slug`, `excerpt`, `content`, `cover_image_url`, `cover_image_alt`, `date`, `author_id` |
| `puzzles` | `id`, `title`, `slug`, `type`, `data`, `cover_image_url`, `date`, `author_id`, `post_id` |
| `authors` | `id`, `name`, `created_at` |
| `pages` | `slug` (`about`, `faq`, `join`), `title`, `body_html`, `og_image_url` |
| `settings` | one row, `id = 1`: `title`, `description`, `footer_html`, `og_image_url` |
| `contact_submissions` | `id`, `name`, `email`, `message`, `location`, `read`, `created_at` |
| `contact_recipients` | `id`, `email`, `name`, `active`, `created_at` |

Notable conventions:

- **`content` and `body_html` are HTML**, rendered with `set:html`. Paragraphs,
  headings, links, lists and `<figure>` pictures all work; nothing is Markdown.
- **Slugs are derived and de-duplicated.** Leave the slug blank and it is built
  from the title; a clash gets `-2`, `-3` … appended. New issues are attributed
  to the `Team Bulletin` author.
- **`author_id` is resolved by name**, case-insensitively, creating the author if
  the name is new — so the `authors` table stays a directory, not one row per
  save. A blank author shows as “Anonymous”.
- **Puzzle `data` is generated text.** The panel's builder writes the compact
  format the public components parse; the raw view exists to fix something by
  hand. `type` must match the data.
- **`location`** on a submission is resolved once, as the message arrives, from
  the sender's address (ip-api). It is where the message came from, not where
  the panel is read, so rows written before the column existed show a time only.

## Pictures, PDFs and where they live

Nothing binary is stored in Postgres, and nothing large passes through this app:
Vercel caps a function's request body at 4.5 MB, which an issue PDF exceeds. Every
upload goes **browser → ImageKit directly**, signed by
`/api/admin/upload-auth` with `IMAGEKIT_PRIVATE_KEY`; the private key never
leaves the server and each signature is scoped to one upload attempt.

| Kind | Where it goes | How the site shows it |
| --- | --- | --- |
| Issue cover | `bulletin/` | Cropped to the site's 2:1 shape through an ImageKit transform (`w-2000,h-1000,fo-auto`, see `src/lib/images.ts`). |
| Puzzle art | `bulletin/` | Square 1:1 tiles. A puzzle with no cover of its own falls back to its issue's cover, which is the picture it ran with — the puzzles of one issue share one file, so a page of them fetches it once. |
| Issue PDF | `bulletin/pdfs/` | Read in the pdf.js viewer on the issue's page. |
| A picture **inside** body copy | `bulletin/` | A plain `<figure><img src="…"><figcaption>…</figcaption></figure>` in the `content`/`body_html` HTML. |

An uploaded file always gets a fresh name (`stem-ab12.jpg`): re-uploading over an
existing name leaves ImageKit's CDN serving the old bytes at the same URL, which
looks like the change never happened.

### Writing an illustrated issue or story

The panel does this end to end, with no other tool:

1. **`/admin/posts/new`** (or `/admin/extras/new`): title, date, excerpt, author.
2. **Cover image** — pick a ratio (Cover 2:1 is the site's shape), drag to choose
   the part to keep, zoom, crop and upload. Add alt text.
3. **Content (HTML)** — type the piece. For every picture in it, press **“Add a
   picture to the text”**: the same crop step runs, with optional **caption** and
   **alt text** fields, and the finished `<figure>` is written into the body at
   the cursor. Upload as many as the piece needs; they are inserted in place.
4. **Issue PDF** — optional, for the printed-issue viewer. With no PDF the page
   renders the HTML body instead.
5. **Puzzles** — attach each one to the issue in `/admin/puzzles`, and they are
   listed at the foot of its page.

This is the answer to “how is something like *Bright World, Dark Room* stored?”:
as one row whose text is HTML and whose pictures are ImageKit URLs. The previous
build of the site served its pictures from Sanity's CDN; nothing here reads those
URLs, so an article brought across needs its cover and body pictures re-uploaded
through the panel so the URLs point at ImageKit.

Only the *cover* is a column (`cover_image_url`); pictures in the body are part
of the HTML, which is why they are uploaded and inserted rather than managed in a
gallery.

## Admin panel

Sign in at **`/admin/login`** with `ADMIN_PASSWORD`.

| Section | What it edits |
| --- | --- |
| `/admin` | Counts, plus links into everything below. |
| `/admin/posts` | Issues — title, slug, date, excerpt, PDF URL, cover, HTML content. |
| `/admin/extras` | Extras — stories, poetry, illustrations, with an author. |
| `/admin/puzzles` | Crosswords, find-a-words and unscrambles. |
| `/admin/pages` | The About, FAQ and Join page bodies. |
| `/admin/settings` | Site title, description, footer and the default social preview. |
| `/admin/messages` | Contact submissions: read/unread, where each came from, delete. |
| `/admin/contacts` | Who contact messages are emailed to, plus a test send. |

### HTML fields

Every field that stores HTML — an issue's or extra's content, a page body, the
footer — is edited in a source editor with **Edit** and **Preview** tabs.
Preview renders the markup the way the site will, in the same prose styles an
article uses, so a heading or a figure can be checked without saving first.
Edit colours the source after Visual Studio Code's own default themes (Light+
and Dark+, tracking the panel's theme), and Tab indents rather than moving focus
out of the field.

The colours come from `src/lib/html-highlight.ts`, a scanner rather than a
parser: half-written markup is the normal state of a field being typed into, so
anything it does not recognise is left as plain text rather than swallowing the
rest of the field. Adding a picture to the text still works — the uploader
inserts a `<figure>` at the cursor, into the same textarea.

### Puzzles

Puzzles are typed in with fields rather than in the stored format: one row per
answer with its grid position, direction and clue for a crossword; a grid plus a
word list for a find-a-word; scrambled/answer pairs for an unscramble. The panel
generates the compact text the public components parse, and a “raw data” view
stays available for fixing anything by hand. A puzzle can be attached to the
issue it appeared in.

### Contact messages

Submissions are saved whether or not mail is configured. Each one records the
address it was posted from, resolved to a city and country as it is stored, so
the panel says where a message came from rather than where it happens to be read.
A message whose address could not be placed shows its time alone.

With `RESEND_API_KEY` set, each submission is also emailed to every active address
in `contact_recipients`; **Send a test** on `/admin/contacts` emails them all from
the same code path the real form uses, so a passing test means the real thing
works. Resend's shared sender (`onboarding@resend.dev`) only delivers to the
Resend account owner — set `RESEND_EMAIL_FROM` to a verified address in
production.

### Security model

- **One shared password**, compared in constant time, exchanged for a signed
  (HMAC-SHA256) session cookie: `HttpOnly`, `SameSite=Strict`, `Secure` on https.
- **Sessions last 12 hours** and are renewed while you work, so an active editor
  is not signed out mid-sentence. The signing key is derived from
  `ADMIN_PASSWORD` unless `ADMIN_SESSION_SECRET` is set — setting or rotating it
  invalidates every existing session immediately.
- **Fail closed.** With no `ADMIN_PASSWORD`, the login endpoint rejects every
  attempt (and says so); an unset variable can never mean “empty password is
  fine”. A password shorter than 12 characters is accepted but flagged.
- **Three layers on every write:** the middleware gates `/admin` and
  `/api/admin`, the route itself re-checks the session, and the form must carry a
  CSRF token derived from that session. Cross-origin POSTs are rejected by an
  Origin check.
- **No caching, no indexing, no framing** for any admin response (`no-store`,
  `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`),
  and `/admin` is disallowed in `robots.txt`.
- **Login throttling:** 8 failures per IP per 10 minutes, with a 400 ms delay on
  every failure. The counter is in memory, so on serverless it is per instance
  rather than global.
- **Revoking access:** change `ADMIN_PASSWORD`, or set/rotate
  `ADMIN_SESSION_SECRET`.

## Environment

```
DATABASE_URL="postgres://…"     # required — Neon connection string
ADMIN_PASSWORD="…"              # required — the panel is off while this is unset
ADMIN_SESSION_SECRET="…"        # optional — set it to revoke all sessions by rotation
IMAGEKIT_PUBLIC_KEY="…"         # required for uploads from the panel
IMAGEKIT_PRIVATE_KEY="…"        # signs each upload; never leaves the server
IMAGEKIT_UPLOAD_ENDPOINT="…"    # optional — overrides ImageKit's upload URL
RESEND_API_KEY="…"              # optional — without it, messages are only stored
RESEND_EMAIL_FROM="…"           # optional — defaults to Resend's shared sender
TURNSTILE_SECRET="…"            # optional — switches the contact CAPTCHA on
TURNSTILE_SITE_KEY="…"          # with PUBLIC_TURNSTILE_SITE_KEY, renders the widget
TURNSTILE_HOSTNAMES="…"         # optional — comma-separated hostnames to accept
```

Add them to the Vercel project's environment variables as well as your local
`.env`. Locally, `.env.local` is loaded on top of `.env`, which is the safe place
to override a value you would rather not edit in place.

`ADMIN_PASSWORD` must never be renamed to `PUBLIC_ADMIN_PASSWORD`: `PUBLIC_*`
values are inlined into the client bundle. The same goes for the ImageKit keys —
the *public* key is meant to be seen, the private key is not.

The ImageKit key only needs upload permission. Its media-management API is
refused for a restricted key, which is why deleting a file (or the panel's own
occasional test upload) happens in the ImageKit dashboard.

## Checks, CI and deploys

`npm run check` runs `astro check`, verifies that the generated icons are still in
step with the source, and runs the parser tests in `src/lib/*.test.ts`.
`vercel.json` puts that in front of the build, so a type error — or an icon
somebody forgot to generate, or a parser case that regressed — fails the
deployment rather than reaching the live site.

The tests cover `src/lib/puzzle-data.ts`, which is the one place stored puzzle
text is interpreted: the three public readers and the admin's validator all run
through it, so a wrong answer there is a wrong answer everywhere. They need no
test framework — Node strips the types, and the module has no imports.

The install command is pinned to `npm ci --include=dev`: the checker and
TypeScript are devDependencies, and Vercel skips those when `NODE_ENV=production`
is set in the project's environment variables. `npm ci` also installs strictly
from the lockfile, so editing `package.json` without updating the lock fails the
build instead of deploying a different dependency tree than the one that was
tested.

`.github/workflows/checks.yml` runs the same commands plus a build on every push
and pull request, which reports faster than waiting on the deploy.

## Icons

Icons are inlined into the page instead of loaded from a CDN: `Icon.astro` and
`Icon.tsx` render the SVG out of `src/lib/icons.generated.ts`, so an icon is part
of the HTML the server sends and of the island bundle. Nothing is fetched, and
nothing upgrades the DOM after load — which is what used to log a React
hydration mismatch for every icon on every page.

That file is generated from the icons the source asks for:

```bash
npm run icons
```

The generator scans `src/` for icon names — `<Icon name="…" />`, literals inside
a `name={…}` expression, and the `icon:` keys in the nav arrays — and fails
loudly on a name that is not a real ionicon. It also reports icons that are
generated but no longer used, which is a hint to regenerate after deleting a
section from the panel. `npm run check` fails when the two disagree, so adding an
icon and forgetting to regenerate is a failed deploy rather than an icon that
quietly renders as nothing. It reads the SVG from the `ionicons` package when
installed, otherwise from unpkg, so regenerating on a fresh checkout wants a
network connection; the committed file is what builds.

## Tools

- `scripts/sync-pdfjs-assets.mjs` — copies pdf.js's assets into `public/pdfjs`
  (runs on `npm install` and before the build).
- `scripts/sync-icons.mjs` — the icon generator above.
- `tools/trim-cover-borders.mjs <slug>` — removes the even border a cover that was
  photographed against a light backdrop leaves behind. Add `--write` to upload
  the result and repoint the row, `--index` to survey every cover.
- `tools/make-logo-dark.mjs` — derives `public/bulletin-dark.png` from
  `public/bulletin.png`, for the dark page: the black outline becomes a light
  orange, the orange the artwork is drawn in becomes a brighter one, and the
  transparent cut-outs the drawing encloses become white. `--color` and
  `--orange` set those two oranges. `Logo.astro` shows one file or the other
  through the `dark` class on `<html>`; re-run the tool after replacing the
  light logo.
