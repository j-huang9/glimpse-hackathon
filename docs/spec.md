# Friend Group Moodboard App: Spec

**Working name:** Glimpse (placeholder)
**Hackathon prompt:** "Build something AI cannot do"
**Builder:** solo, JS/React
**Build budget:** 2 hours (hard)

---

## 1. Pitch

Friend groups drift apart after college. Glimpse gives each group one AI-generated photo prompt per cycle, such as "show us the best thing you ate this week." Everyone uploads as many photos as they like. Photos stay hidden until the cycle ends. Then the group gets one shareable **moodboard**: a collage of everyone's real photos, a Spotify Wrapped–style vibe label (e.g. *"Cozy Cottagecore Brunch Club"*), and a color palette.

**Theme angle: AI as glue, humans as content.** AI cannot make real memories or keep a friendship alive. In Glimpse, AI only nudges (prompts) and packages (vibe label + palette). Every pixel on the board comes from a real photo a real friend took. The AI never generates imagery.

**Tone:** cute and wholesome. No roasting, ever.

---

## 2. Core loop

1. Sign in with Google, then create a group or join one with an invite code.
2. The group has an **active cycle**: one AI prompt, a countdown, and the group's chosen length in days.
3. Members upload unlimited photos (camera or camera roll) during the cycle.
4. During the cycle, **nobody sees anyone's photos**. The home screen shows only the prompt, the countdown, which friends have posted (avatars light up), and the total photo count.
5. At cycle end, the board is generated automatically: one Claude vision call, then a server-rendered PNG. Everyone sees it at the same time.
6. The next cycle starts right away with a fresh random prompt.
7. Past boards collect in a scrollable **scrapbook** (archive).

---

## 3. Product decisions (from the interview)

| Area | Decision |
|---|---|
| Platform | Mobile-first responsive web app (Next.js). Judges open a URL on their phones. |
| Capture | `<input type="file" accept="image/*">`, so camera or camera roll. No timestamp checks. |
| Cycle length | Group creator sets it at creation (1–7 days). Editable; changes apply to the **next** cycle only. |
| Prompts per cycle | Exactly one. Unlimited photos per person. |
| Prompt generation | AI-generated and random. Ranges from generic to niche, but must always be answerable by an ordinary person in ordinary life. Users get **no** say in the prompt. |
| Bad prompts | A "Report" button only **logs** the report (`prompt_reports` table). The prompt is not replaced. |
| Visibility | All photos hidden until the board is revealed. Users can't see their own past uploads in a gallery either. An upload toast confirms each one. |
| Board format | **One single image.** No extra stat pages. |
| Board contents | Collage of real photos, vibe label (big), group name + cycle dates, palette swatches. No prompt text, no captions, no names. |
| Collage layout | Masonry that fits all photos up to ~30. Above 30, sample evenly with at least 1 photo per contributor. |
| Vibe label style | Wrapped-style aesthetic label, 2–5 words. E.g. "Main Character Golden Hour", "Soft Chaos Picnic Era". |
| Reveal | Automatic at cycle end. During the demo, a manual "Generate now" button does the same thing. |
| 0 photos | No board. Show a gentle "Quiet week, we missed you all 💌" card and start the next cycle. 1+ photos: make a board. |
| Sharing | Download/share the PNG through the Web Share API (`navigator.share({ files })`), falling back to a download link. |
| Multi-group | Yes, with a group switcher. |
| Notifications | None for MVP (future work: web push). |
| Captions | None. |
| Aesthetic | Neutral app chrome inspired by **Luma / Partiful**: clean, airy, soft gradients, rounded cards, nice type. Each revealed board **themes the page** with its AI palette (background gradient and accent color). |
| AI provider | Claude Sonnet 5.5 (`claude-sonnet-5-5`) for both prompt generation and vibe analysis. |

---

## 4. Tech stack

- **Next.js (App Router) + TypeScript + Tailwind**, deployed on Vercel
- **Supabase**: Postgres, Auth (Google provider), Storage (`photos` and `boards` buckets), pg_cron
- **Anthropic SDK** (`@anthropic-ai/sdk`)
- **sharp**: downscale photos before the AI call, and composite the collage PNG
- **@vercel/og / Satori** (optional): text overlay. Or draw text into an SVG and composite it with sharp, which needs only one library.

---

## 5. Data model

```sql
profiles (
  id uuid pk references auth.users,
  display_name text,
  avatar_url text
)

groups (
  id uuid pk,
  name text not null,
  invite_code text unique not null,   -- 6 chars, uppercase
  cycle_length_days int not null default 7 check (between 1 and 7),
  next_cycle_length_days int,          -- pending change; applied at next cycle start
  created_by uuid references profiles,
  created_at timestamptz default now()
)

group_members (
  group_id uuid references groups,
  user_id uuid references profiles,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
)

cycles (
  id uuid pk,
  group_id uuid references groups,
  prompt text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active',  -- active | finalizing | revealed | empty
  vibe_label text,
  palette jsonb,                           -- ["#F4C7A1", ...] 5 hex colors
  board_url text,
  created_at timestamptz default now()
)

photos (
  id uuid pk,
  cycle_id uuid references cycles,
  user_id uuid references profiles,
  storage_path text not null,
  created_at timestamptz default now()
)

prompt_reports (
  id uuid pk,
  cycle_id uuid references cycles,
  user_id uuid references profiles,
  reason text,
  created_at timestamptz default now()
)
```

**RLS (keep it minimal):** members can read their own groups, cycles, and members. `photos`: a user can insert their own rows. Select is allowed only when the parent cycle's status is `revealed`, or the row is the user's own (used for the count only). Who-has-posted and the total count come from a server route that uses the service role and returns only `{user_ids_posted, count}`.

> 2-hour shortcut: do all reads and writes through server routes with the service role key, check membership in code, and skip RLS. Note it as tech debt.

---

## 6. Routes and screens

| Route | Purpose |
|---|---|
| `/` | Sign in with Google, or redirect to the last-used group |
| `/groups/new` | Name + cycle length, then creates the group and its first cycle (AI prompt) |
| `/join` | Enter invite code (also `/join/[code]` deep link) |
| `/g/[groupId]` | **Home**: group switcher (top), prompt card, countdown, posted-avatars row, photo count, big "Add photos" button, small "Report prompt" link. If the latest cycle was revealed in the last 24h, show the board on top. |
| `/g/[groupId]/archive` | Scrapbook: grid of past board PNGs with vibe labels and dates. Tap to open full size and share. |
| `/g/[groupId]/settings` | Invite code + copy link, cycle length (next cycle), members list. Includes the **"Generate now"** demo button. |

### API routes
- `POST /api/groups`: create group + first cycle
- `POST /api/groups/join`: join by code
- `POST /api/cycles/[id]/photos`: upload (multipart). Store in `photos/{cycleId}/{uuid}.jpg`.
- `GET /api/cycles/[id]/status`: `{prompt, ends_at, posted_user_ids, count}`
- `POST /api/cycles/[id]/report`: log a prompt report
- `POST /api/cycles/[id]/finalize`: generate the board (cron + demo button)
- `POST /api/cron/finalize-expired`: called by pg_cron every 5 min; finalizes every `active` cycle where `ends_at < now()`

---

## 7. AI

### 7a. Prompt generation
Called at group creation and at each cycle rollover.

System prompt (sketch):
> You write one photo prompt for a group of friends who live in different cities and want to stay close. The prompt should be cute, warm, and doable by anyone in everyday life within a few days. Vary between generic ("your view right now") and niche-but-answerable ("something you own that's older than you", "the most chaotic thing in your fridge"). Never ask for faces of strangers, anything unsafe, private, embarrassing, or requiring money or travel. Return only the prompt, under 12 words, lowercase casual voice.

To improve variety, pass the group's last ~10 prompts and tell the model "don't repeat these themes."

Fallback: a hard-coded list of 20 prompts, used if the API call fails.

### 7b. Vibe analysis (at cycle end)
- Load all cycle photos. Downscale each to ~512px on the long edge with sharp (JPEG q70). Use at most 30, sampled the same way as the collage.
- One `messages.create` call to `claude-sonnet-5-5` with all images plus the text instruction:

> These are photos a friend group shared this week for the prompt "{prompt}". Describe the group's collective vibe like Spotify Wrapped would. Be cute and wholesome, never teasing or negative, and never comment on people's bodies or appearance. Return JSON:
> `{"vibe_label": "2–5 word aesthetic label, Title Case", "palette": ["#hex", x5 colors drawn from the photos, ordered light→dark]}`

- Parse JSON. On failure, retry once. If it still fails, use `vibe_label: "Main Character Energy"` and a palette pulled from the photos with sharp's `stats().dominant`.

---

## 8. Board rendering (server, sharp)

- Canvas: **1080 × 1920** (story-size, ideal for IG Stories / group chat).
- Background: vertical gradient of `palette[0]` → `palette[1]`.
- Top band (~260px): group name (small caps) and cycle dates, e.g. "OCT 10 – OCT 17".
- Middle: masonry collage of photos. Example: 3 columns for ≤12 photos, 4 for 13–30. Rounded corners 24px, 12px gutters, slight drop shadow. Center-crop each photo to the column width at a height that matches its aspect ratio, clamped to between 0.75 and 1.5. If the column heights don't end up even, crop the bottom so the edge is flush.
- Bottom band (~380px): vibe label in a big bold display font (~96px, wrapping to 2 lines), then a row of 5 circular palette swatches with hex codes underneath.
- Text is drawn as an SVG overlay (embed the font as a base64 `@font-face`) and composited with sharp.
- Upload to `boards/{cycleId}.png`, then set `cycles.board_url`, `status='revealed'`, `vibe_label`, `palette`.

### Finalize sequence
1. `UPDATE cycles SET status='finalizing' WHERE id=$1 AND status='active'`. If 0 rows change, return; this prevents double runs from cron + button.
2. Count photos. If 0, set `status='empty'` and go to step 5.
3. AI vibe call (7b).
4. Render and upload the PNG, then update the cycle.
5. Insert the next cycle: new AI prompt, `starts_at=now()`, `ends_at=now()+coalesce(next_cycle_length_days, cycle_length_days) days`. Promote the pending length to the current length.

---

## 9. UI notes

- **Luma/Partiful feel:** off-white background, generous whitespace, rounded-2xl cards, soft blurred gradient blobs behind the prompt card, an expressive display font (e.g. "Instrument Serif" or "Fraunces" for prompts and labels) paired with Inter for UI text.
- **Palette theming:** after a reveal, store the palette on the cycle. The group page sets CSS vars `--accent` and `--bg-from/--bg-to` from the latest revealed cycle, so the whole group's home screen takes on that board's mood until the next reveal.
- **Posted avatars:** grayscale until the user posts, then full color with a little ✓ pop.
- **Upload:** multi-select is allowed. Show optimistic thumbnails only in the upload sheet; once it closes they're "sealed" (an envelope animation is a nice touch if there's time).
- **Reveal moment:** the board fades in from the palette gradient, with a Share button and a Save button.

---

## 9b. Sticker decorating (added after interview)

After a board is revealed, members can decorate it with **hand-drawn stickers and stamps** made by the team.

- **Shared, scrapbook-style:** stickers are saved to the group's board (`board_stickers` table), so everyone sees everyone's decorations. You can only move, resize, rotate, or remove stickers **you** placed.
- **Editor** (`/g/[groupId]/board/[cycleId]`, also reachable via "✨ Decorate" on the home board and the reveal overlay): tap a sticker in the tray to drop it near the center with a small random tilt. Drag to move; −/+/↺/↻/✕ buttons act on the selected sticker. Positions are stored as fractions of board width/height, so they're resolution-independent. The editor polls every 6s to pick up friends' stickers.
- **Share** flattens the server-rendered board PNG plus stickers into a single 1080×1920 PNG in the browser (canvas), then opens the native share sheet, or downloads if sharing isn't available.
- **Art:** drawings live in `public/stickers/` and are listed in `src/lib/stickers.ts` (`id`, `src`, `label`, `aspect`, `kind: sticker | stamp`). Placeholder SVGs ship until the team's drawings are ready.
- The base board PNG is never modified, so the AI output stays the clean original.

---

## 10. Demo plan

- **Seed:** before judging, create the group "The Roommates" with 4–5 real friend accounts (or seeded profiles). Load a cycle with ~15–20 real photos from friends, all matching one prompt (e.g. "your favorite meal this week").
- **On stage:** show the home screen (prompt, countdown, lit avatars, "18 photos sealed"). Judge scans the invite QR, joins, and uploads one photo live. Tap **Generate now**. The board is revealed and the page re-themes to its palette. Share it to a phone.
- **Close:** open the archive with 2–3 pre-generated past boards, which shows the scrapbook-of-a-friendship idea.
- **Line for judges:** "AI wrote one sentence and picked five colors. Everything you're looking at is real, taken by real friends. AI can't do that part."

---

## 11. 2-hour build plan

Total budget: 120 minutes. **Must-have** first; stop and polish the demo by minute 105.

| Min | Task | Tier |
|---|---|---|
| 0–15 | `create-next-app`, Tailwind, Supabase project, tables (SQL above), storage buckets, env vars | Must |
| 15–30 | Google auth via Supabase, `profiles` upsert on login | Must (fallback: name-only, see cuts) |
| 30–45 | Create group (+ AI prompt), join by code, group home with prompt + countdown | Must |
| 45–60 | Photo upload to storage + `photos` row; status route (posted avatars + count) | Must |
| 60–85 | Finalize route: AI vibe call + sharp collage render + upload; "Generate now" button | Must |
| 85–95 | Reveal UI + palette theming + Web Share / download | Must |
| 95–105 | Seed demo group with real photos; generate 2–3 past boards | Must |
| 105–120 | Archive page, group switcher, polish | Should |
| — | pg_cron auto-finalize, cycle-length editing, report button | Could |

### Cut order (if behind)
1. pg_cron (the demo uses the button). Fallback: finalize lazily when the group page loads after `ends_at`.
2. Cycle-length editing (set it at creation only).
3. Group switcher (a plain list on `/`).
4. Archive page (show the latest board only, and mention the scrapbook in the pitch).
5. Google auth, replaced by display name + invite code with the user id in localStorage.

**Never cut:** hidden-until-reveal, the real-photo collage, the vibe label, sharing.

---

## 12. Risks

- **sharp on Vercel:** works on the Node runtime; set `export const runtime = 'nodejs'` and keep the route's maxDuration ≥ 60s.
- **Large uploads:** resize on the client to ≤1600px with a canvas before upload. Phone photos are 3–8 MB.
- **HEIC from iPhones:** the browser file input usually converts to JPEG with `accept="image/*"`; otherwise sharp can read HEIC, but only with libheif. Test with an iPhone early.
- **AI latency with 30 images:** about 10–20s. Show a "developing your board…" state.
- **Wholesome guarantee:** the system prompt forbids appearance or body comments. Label-only output (no long text) keeps the risk surface tiny.

---

## 13. Future work (mention in pitch)
Web push when a prompt drops or a board is ready · streaks and participation nudges · yearly "Friendship Wrapped" built from all boards · printable scrapbook export.
