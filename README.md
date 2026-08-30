# Baulko Bulletin

Student newspaper of Baulkham Hills High School.

**Stack:** Astro + React islands, Neon Postgres, ImageKit (images), Filebase (PDFs).

## Run locally

```powershell
git clone https://github.com/SahasTechnologies/baulko-bulletin.git
cd baulko-bulletin
npm install
copy .env.example .env
npm run dev
```

Paste your Neon `DATABASE_URL` into `.env`. Open the URL Astro prints (usually `http://localhost:4321`).

The site starts without `DATABASE_URL`; content pages stay empty until it is set.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | Local server |
| `npm run build` | Production build (Vercel adapter) |
| `npm run preview` | Preview the production build |
| `npm run migrate:media` | Copy Sanity CDN files in Neon to ImageKit + Filebase |

## Database

Run these in the Neon SQL editor, in order:

1. `neon-schema.sql` — tables
2. `neon-schema-v2.sql` — drop author profiles, add `author_name` + puzzle→issue link
3. `neon-contact-table.sql` — contact form inbox

Env var name: **`DATABASE_URL`**

## Media

- **Images** → ImageKit (cover photos, auto-cropped 2:1)
- **PDFs** → Filebase (issue downloads)

`npm run migrate:media` needs ImageKit and Filebase keys in `.env`. It only rewrites URLs that still point at `cdn.sanity.io`.

## Contact form

Posts to `/api/contact` and stores rows in `contact_submissions`. Includes a honeypot field (`website`).
