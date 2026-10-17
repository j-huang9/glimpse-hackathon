import "server-only";
import sharp from "sharp";
import { analyzeVibe, generatePrompt } from "./ai";
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

function lightness(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
}

/** Used when the AI call fails: dominant colors of a few photos, light → dark. */
async function fallbackPalette(images: Buffer[]): Promise<string[]> {
  const colors = await Promise.all(
    images.slice(0, 8).map(async (img) => {
      const { dominant } = await sharp(img).stats();
      return toHex(dominant.r, dominant.g, dominant.b);
    }),
  );
  const unique = [...new Set(colors)];
  const defaults = ["#fdf2e9", "#f6c9a8", "#e8998d", "#a26769", "#582c4d"];
  while (unique.length < 5) unique.push(defaults[unique.length]);
  return unique.slice(0, 5).sort((a, b) => lightness(b) - lightness(a));
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
        vibe_label: "Main Character Energy",
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
