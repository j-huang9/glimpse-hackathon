import "server-only";
import sharp from "sharp";
import { analyzeVibe, fallbackVibeLabel, generatePrompt } from "./ai";
import { renderBoard } from "./board";
import { supabaseAdmin } from "./supabase-admin";
import type { Cycle, Group } from "./types";

const MAX_BOARD_PHOTOS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function startCycle(group: Group): Promise<Cycle> {
  const db = supabaseAdmin();
  const { data: recent } = await db
    .from("cycles")
    .select("prompt")
    .eq("group_id", group.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const prompt = await generatePrompt((recent ?? []).map((r) => r.prompt));
  const days = group.next_cycle_length_days ?? group.cycle_length_days;
  const now = Date.now();

  const { data: cycle, error } = await db
    .from("cycles")
    .insert({
      group_id: group.id,
      prompt,
      starts_at: new Date(now).toISOString(),
      ends_at: new Date(now + days * DAY_MS).toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  if (group.next_cycle_length_days) {
    await db
      .from("groups")
      .update({ cycle_length_days: group.next_cycle_length_days, next_cycle_length_days: null })
      .eq("id", group.id);
  }
  return cycle;
}

type PhotoRow = { id: string; user_id: string; storage_path: string; created_at: string };

/** Up to `max` photos, at least one per contributor, the rest spread evenly across the cycle. */
export function samplePhotos(photos: PhotoRow[], max = MAX_BOARD_PHOTOS): PhotoRow[] {
  if (photos.length <= max) return photos;
  const picked = new Set<string>();
  const firstByUser = new Map<string, PhotoRow>();
  for (const p of photos) if (!firstByUser.has(p.user_id)) firstByUser.set(p.user_id, p);
  for (const p of [...firstByUser.values()].slice(0, max)) picked.add(p.id);

  const rest = photos.filter((p) => !picked.has(p.id));
  const need = max - picked.size;
  for (let i = 0; i < need; i++) picked.add(rest[Math.floor((i * rest.length) / need)].id);

  return photos.filter((p) => picked.has(p.id));
}

function toHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}


type RGB = [number, number, number];

function saturation([r, g, b]: RGB) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

const mix = (c: RGB, t: number): RGB => c.map((v) => v + (255 - v) * t) as RGB;
const distance = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Used when there's no AI (demo mode) or the call fails: sample a grid of colors from the photos,
 * keep the colorful mid-tones, pick 5 that are far apart, order light → dark, and soften the
 * two lightest so the board background stays airy.
 */
async function fallbackPalette(images: Buffer[]): Promise<string[]> {
  const pool: RGB[] = [];
  for (const img of images.slice(0, 16)) {
    const { data } = await sharp(img).resize(4, 4, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 3) pool.push([data[i], data[i + 1], data[i + 2]]);
  }
  const lum = ([r, g, b]: RGB) => r * 0.299 + g * 0.587 + b * 0.114;
  const colorful = pool.filter((c) => lum(c) > 45 && lum(c) < 235 && saturation(c) > 0.18);
  const candidates = colorful.length >= 5 ? colorful : pool;

  // Farthest-point sampling, starting from the most saturated color.
  const picked: RGB[] = [candidates.reduce((a, b) => (saturation(b) > saturation(a) ? b : a))];
  while (picked.length < 5 && picked.length < candidates.length) {
    picked.push(candidates.reduce((best, c) =>
      Math.min(...picked.map((p) => distance(p, c))) > Math.min(...picked.map((p) => distance(p, best))) ? c : best,
    ));
  }
  const defaults: RGB[] = [[253, 242, 233], [246, 201, 168], [232, 153, 141], [162, 103, 105], [88, 44, 77]];
  while (picked.length < 5) picked.push(defaults[picked.length]);

  const sorted = picked.sort((a, b) => lum(b) - lum(a));
  sorted[0] = mix(sorted[0], 0.75);
  sorted[1] = mix(sorted[1], 0.5);
  return sorted.map(([r, g, b]) => toHex(r, g, b));
}

/**
 * Closes a cycle: AI vibe + palette, render the board PNG, reveal it, and (optionally) start the next cycle.
 * Safe to call concurrently — only the caller that flips status active → finalizing does the work.
 */
export async function finalizeCycle(cycleId: string, { startNext = true } = {}) {
  const db = supabaseAdmin();
  const { data: claimed } = await db
    .from("cycles")
    .update({ status: "finalizing" })
    .eq("id", cycleId)
    .eq("status", "active")
    .select("*, groups(*)")
    .maybeSingle();
  if (!claimed) return { skipped: true };

  const { groups: group, ...cycle } = claimed as Cycle & { groups: Group };

  try {
    const { data: photos } = await db
      .from("photos")
      .select("id, user_id, storage_path, created_at")
      .eq("cycle_id", cycleId)
      .order("created_at");

    const all = photos ?? [];
    const endsAt = new Date(Math.min(Date.now(), new Date(cycle.ends_at).getTime())).toISOString();

    if (all.length === 0) {
      await db.from("cycles").update({ status: "empty", photo_count: 0, ends_at: endsAt }).eq("id", cycleId);
    } else {
      const sample = samplePhotos(all);
      const buffers = await Promise.all(
        sample.map(async (p) => {
          const { data, error } = await db.storage.from("photos").download(p.storage_path);
          if (error) throw error;
          return Buffer.from(await data.arrayBuffer());
        }),
      );
      const small = await Promise.all(
        buffers.map((b) =>
          sharp(b).resize(512, 512, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer(),
        ),
      );

      const vibe = (await analyzeVibe(small, cycle.prompt)) ?? {
        vibe_label: cycle.demo_vibe_label ?? fallbackVibeLabel(),
        palette: await fallbackPalette(small),
      };

      const png = await renderBoard({
        groupName: group.name,
        startsAt: cycle.starts_at,
        endsAt,
        vibeLabel: vibe.vibe_label,
        palette: vibe.palette,
        photos: buffers,
        hiddenCount: all.length - sample.length,
      });

      const path = `${cycleId}.png`;
      const { error: upErr } = await db.storage
        .from("boards")
        .upload(path, png, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = db.storage.from("boards").getPublicUrl(path);

      await db
        .from("cycles")
        .update({
          status: "revealed",
          vibe_label: vibe.vibe_label,
          palette: vibe.palette,
          board_url: `${pub.publicUrl}?v=${Date.now()}`,
          photo_count: all.length,
          ends_at: endsAt,
        })
        .eq("id", cycleId);
    }
  } catch (err) {
    await db.from("cycles").update({ status: "active" }).eq("id", cycleId);
    throw err;
  }

  if (startNext) await startCycle(group);
  return { skipped: false };
}

export async function finalizeExpired() {
  const { data } = await supabaseAdmin()
    .from("cycles")
    .select("id")
    .eq("status", "active")
    .lt("ends_at", new Date().toISOString());
  const results = [];
  for (const c of data ?? []) {
    try {
      results.push({ id: c.id, ...(await finalizeCycle(c.id)) });
    } catch (err) {
      console.error("finalize failed", c.id, err);
      results.push({ id: c.id, error: true });
    }
  }
  return results;
}

export function makeInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
