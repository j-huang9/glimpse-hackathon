# glimpse

One AI prompt per cycle. Friends share real photos, hidden until the end. Then the group gets one moodboard: a collage of everyone's photos, a Wrapped-style vibe label, and a palette. Members can decorate it with hand-drawn stickers and share it.

Spec: [`docs/spec.md`](docs/spec.md)

## Demo mode (no keys needed)

```
npm install
npm run dev     # http://localhost:3000
```

While `.env.local` has no real Supabase URL, the app runs in **demo mode**:
- Data and photos are stored on this machine in `.demo/` instead of Supabase.
- Google sign-in becomes **"Who are you?"**: pick a demo friend. The floating avatar (bottom right) switches friends or resets the demo.
- With no `ANTHROPIC_API_KEY`, vibe labels come from `seed/config.json` (`vibeLabel` per cycle) or a built-in list, and the palette is pulled from the photos. Add a key and the real AI takes over.
- **Set up demo** / **Reset demo data** builds two groups from `seed/config.json`, each with a preset board style:
  - **The Roommates** uses the `scrapbook` style (cream paper, polaroids, buttons, stars, tape). It has 2 past boards in its Scrapbook, and its open cycle uses `seed/photos/current`.
  - **Prom Night** uses the `film` style (edge-to-edge photos, white paint, yellow marker). Its open cycle uses `seed/photos/night/current`.
  - In each open cycle, every friend except the last two has already posted.

**For the video:** put your real photos in those folders, and edit group names, prompts and vibe labels in `seed/config.json`. Then tap Reset demo data. Suggested flow:
1. Pick **Sam** (hasn't posted). In The Roommates, upload a photo and watch the avatar light up.
2. Open the Group tab to show the invite QR, then tap **✨ Generate board now**. The scrapbook board is revealed.
3. Tap **✨ Decorate**, add stickers, and try the Portrait/Landscape toggle.
4. Switch to **Prom Night** with the group switcher and repeat. This time the film board is revealed.
5. Switch to **Maya** to see Sam's stickers. Then **Share board**, then the Scrapbook tab.

**Phone demo:**
- On your laptop: open http://localhost:3000/phone for the app inside an iPhone frame. Good for screen recording.
- On a real phone: connect it to the same Wi-Fi as the laptop and open `http://<laptop-ip>:3000`. Find the IP with `ipconfig getifaddr en0`.

Board layout preview, no data needed: `/api/dev/board-preview?n=8&theme=film&orientation=landscape&label=Main%20Character%20Night%20Out` (`theme` is `scrapbook` or `film`)

Demo mode is for local recording. On Vercel the filesystem isn't persistent, so use real keys there.

## Setup with real services (≈10 min)

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

Dev-only layout preview, no keys needed: http://localhost:3000/api/dev/board-preview?n=8 (add `&orientation=landscape`)

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
