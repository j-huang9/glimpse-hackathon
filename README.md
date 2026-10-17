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

**For the video:** everything is set in `seed/config.json`. After editing it, tap **Reset demo data** (avatar menu, bottom right) to rebuild.

```jsonc
{
  "members": ["Maya", "Jordan", "Priya", "Sam", "Alex"],   // friend names, in display order
  "presenter": "Sam",                                       // uploads live on camera; starts with no photos
  "groups": [
    {
      "name": "The Roommates",                              // group name
      "theme": "scrapbook",                                 // "scrapbook" or "film"
      "cycles": [
        { "prompt": "…", "dir": "seed/photos/past-1", "past": true, "vibeLabel": "…" },  // becomes a Scrapbook board
        { "prompt": "the prettiest thing you saw this week",                            // the live prompt
          "dir": "seed/photos/current", "vibeLabel": "Cottage Brunch Girl Core" }        // label revealed on camera
      ]
    }
  ]
}
```

- **Photos:** a subfolder named after a friend holds that friend's photos (`seed/photos/current/Maya/*.jpg`). Loose photos in the folder are shared out among everyone except the presenter.
- **Profile pictures:** `seed/avatars/<Name>.jpg` (or .png). Friends without one get a pastel initial. These photos stay out of git.
- **The presenter's photos:** keep them on the device you're recording with and upload them on camera. They're added to the same board. Suggested flow:
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
The Decorate tray shows every image in `public/stickers/`. You don't need to edit any code.

**Easiest way:** put your PNGs in a folder and run:
```
npm run stickers -- ~/Desktop/our-stickers            # add them
npm run stickers -- ~/Desktop/our-stickers --replace  # add them and remove the placeholder art
```
Each image is trimmed to its drawn edges, shrunk to at most 600px, and saved as `public/stickers/<name>.png`. Refresh the Decorate page and they appear.

**Manual way:** copy transparent PNGs straight into `public/stickers/`.

Naming and order:
- **Tray order** comes from `public/stickers/order.json`: a list of filenames without the extension. Files that aren't listed go at the end, alphabetically. Names listed without a file yet (like `heart`, `drink`) are skipped until the file shows up.
- The tray label comes from the filename: `stamp-best-friends.png` shows as "Best Friends". Filenames starting with `stamp` only get a larger default size when placed.
- Renaming or deleting a file removes it from boards where someone already placed it.

Use transparent backgrounds. The import command warns you if an image has none.

## Deploy (Vercel)
Import the repo, add the same env vars (with `APP_URL` = your Vercel URL), and add the Vercel URL to Supabase redirect URLs. Optional: enable `pg_cron` + `pg_net` and run the commented cron block at the bottom of `supabase/schema.sql` so boards reveal on time even if nobody opens the app. Otherwise the reveal happens the first time anyone opens the group after the timer ends.
