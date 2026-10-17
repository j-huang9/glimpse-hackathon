# glimpse

One AI prompt per cycle. Friends share real photos, hidden until the end. Then the group gets one moodboard: a collage of everyone's photos, a Wrapped-style vibe label, and a palette. Members can decorate it with hand-drawn stickers and share it.

Spec: [`docs/spec.md`](docs/spec.md)

## Setup (≈10 min)

### 1. Supabase
1. Create a project at https://supabase.com/dashboard (free tier is fine).
2. **SQL Editor** → paste all of `supabase/schema.sql` → **Run**. This creates the tables and the `photos` and `boards` storage buckets.
3. **Authentication → Sign In / Providers → Google** → enable. It needs a Google OAuth Client ID and Secret:
   - https://console.cloud.google.com/apis/credentials → *Create credentials → OAuth client ID → Web application*
   - Authorized redirect URI: the callback URL Supabase shows on the Google provider page (`https://<project>.supabase.co/auth/v1/callback`)
   - Paste the Client ID + Secret back into Supabase.
4. **Authentication → URL Configuration**: Site URL `http://localhost:3000`; add `http://localhost:3000/**` (and your Vercel URL + `/**` later) to Redirect URLs.
5. **Project Settings → API Keys**: copy the project URL, the anon/publishable key, and the service_role/secret key.

### 2. Anthropic
Create a key at https://console.anthropic.com/settings/keys.

### 3. `.env.local`
Fill in `.env.local` (template: `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role / secret key>   # server only, never commit
ANTHROPIC_API_KEY=sk-ant-...
CRON_SECRET=<any random string>
APP_URL=http://localhost:3000
```

### 4. Run
```
npm install
npm run dev     # http://localhost:3000
```
> The folder name contains `:`, which breaks npm's PATH handling, so the scripts call Next's binary directly. Use `npm run …`, not `npx next …`.

Dev-only layout preview, no keys needed: http://localhost:3000/api/dev/board-preview?n=12

## Demo seed
1. Drop real photos into `seed/photos/past-1`, `past-2`, `current` (and edit prompts/names in `seed/config.json`).
2. With `npm run dev` running: `npm run seed`. Past folders become boards in the Scrapbook; `current` stays open.
3. Open the printed invite link, join, then go to **Group → ✨ Generate board now** on stage.

## Your own stickers
1. Export each drawing as a transparent PNG (≈400–800px wide) into `public/stickers/`.
2. Add a line to `src/lib/stickers.ts`: `{ id, src, label, aspect: height/width, kind: "sticker" | "stamp" }`.
3. Delete placeholder entries you don't want. Don't rename ids of stickers already placed on boards.

## Deploy (Vercel)
Import the repo, add the same env vars (with `APP_URL` = your Vercel URL), and add the Vercel URL to Supabase redirect URLs. Optional: enable `pg_cron` + `pg_net` and run the commented cron block at the bottom of `supabase/schema.sql` so boards reveal on time even if nobody opens the app. Otherwise the reveal happens the first time anyone opens the group after the timer ends.
