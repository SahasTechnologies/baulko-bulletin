# Baulko Bulletin

Student newspaper of Baulkham Hills High School.

Astro + React islands, Neon Postgres, ImageKit/Filebase URLs for media.

## Run locally

```powershell
git clone https://github.com/SahasTechnologies/baulko-bulletin.git
cd baulko-bulletin
npm install
copy .env.example .env
# paste your Neon DATABASE_URL into .env
npm run dev
```

Then open the URL Astro prints (usually `http://localhost:4321`).

`npm run dev` works **without** `DATABASE_URL` — the chrome and pages load, content is empty until Neon is connected.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | Local server |
| `npm run build` | Production build (Vercel adapter) |
| `npm run preview` | Preview the production build |

## Database

Run these in the Neon SQL editor, in order:

1. `neon-schema.sql` — tables
2. `neon-schema-v2.sql` — drop author profiles, add `author_name` + puzzle→issue link
3. `neon-contact-table.sql` — contact form inbox

Env var name: **`DATABASE_URL`**

## Contact form

Posts to `/api/contact` and stores rows in `contact_submissions`. Includes a honeypot field (`website`).
