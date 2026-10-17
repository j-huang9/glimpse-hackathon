import "server-only";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { finalizeCycle, makeInviteCode, startCycle } from "../cycles";
import { supabaseAdmin } from "../supabase-admin";
import type { Group } from "../types";
import { wipeDemoStore } from "./store";

const DAY = 86_400_000;
const AVATAR_COLORS = ["#ffc8b4", "#c9b8ff", "#b8e3c9", "#ffe29a", "#a9d4ff", "#ffb3c7"];

function avatar(name: string, i: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${AVATAR_COLORS[i % AVATAR_COLORS.length]}"/><text x="48" y="62" text-anchor="middle" font-family="Georgia, serif" font-size="44" fill="#1c1917">${name[0]}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Same name → same id on every reset, so a browser's remembered demo user stays signed in. */
function stableId(name: string) {
  const h = createHash("sha256").update(`glimpse-demo:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type SeedCycle = { prompt: string; dir: string; past?: boolean; vibeLabel?: string };
type SeedGroup = { name: string; theme?: "scrapbook" | "film"; cycles: SeedCycle[] };
type SeedConfig = { members: string[]; groups?: SeedGroup[]; groupName?: string; cycles?: SeedCycle[] };

async function listPhotos(dir: string) {
  try {
    return (await readdir(dir))
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Wipes demo data and rebuilds it from seed/config.json + seed/photos/*. For each group:
 * past cycles become boards in the Scrapbook; the open cycle has photos sealed from everyone
 * except the last two friends (so you can show avatars lighting up). A group's `theme` presets
 * the board style for all its cycles.
 */
export async function seedDemo() {
  wipeDemoStore();
  const db = supabaseAdmin();
  const config: SeedConfig = JSON.parse(await readFile(path.join(process.cwd(), "seed/config.json"), "utf8"));
  const groups: SeedGroup[] = config.groups ?? [{ name: config.groupName ?? "The Roommates", cycles: config.cycles ?? [] }];

  const members = config.members.map((name, i) => ({ id: stableId(name), display_name: name, avatar_url: avatar(name, i) }));
  await db.from("profiles").insert(members);
  const posters = members.slice(0, Math.max(1, members.length - 2));
  const created: string[] = [];

  // Reverse so the first group in the config is the most recently joined (shown first).
  for (const [gi, g] of [...groups].reverse().entries()) {
    const { data: group } = await db
      .from("groups")
      .insert({ id: stableId(`group:${g.name}`), name: g.name, invite_code: makeInviteCode(), cycle_length_days: 7, created_by: members[0].id })
      .select()
      .single<Group>();
    if (!group) throw new Error("Couldn't create demo group");
    created.unshift(group.id);
    await db.from("group_members").insert(
      members.map((m, i) => ({
        group_id: group.id,
        user_id: m.id,
        joined_at: new Date(Date.now() - (60 - gi) * DAY + i * 1000).toISOString(),
      })),
    );

    const past = g.cycles.filter((c) => c.past);
    let hasOpenCycle = false;
    for (const c of g.cycles) {
      const pastIndex = past.indexOf(c);
      const startsAt = c.past ? Date.now() - (past.length - pastIndex) * 7 * DAY - DAY : Date.now() - 5 * DAY;
      const endsAt = c.past ? startsAt + 7 * DAY : Date.now() + 2 * DAY;

      const { data: cycle } = await db
        .from("cycles")
        .insert({
          group_id: group.id,
          prompt: c.prompt,
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
          created_at: new Date(startsAt).toISOString(),
          theme: g.theme ?? null,
          demo_vibe_label: c.vibeLabel ?? null,
        })
        .select()
        .single();

      const files = await listPhotos(path.join(process.cwd(), c.dir));
      const who = c.past ? members : posters;
      for (const [j, file] of files.entries()) {
        const jpg = await sharp(await readFile(file))
          .rotate()
          .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        const storagePath = `${cycle.id}/${crypto.randomUUID()}.jpg`;
        await db.storage.from("photos").upload(storagePath, jpg, { contentType: "image/jpeg" });
        const t = startsAt + ((j + 1) / (files.length + 1)) * (Math.min(endsAt, Date.now()) - startsAt);
        await db.from("photos").insert({
          cycle_id: cycle.id,
          user_id: who[j % who.length].id,
          storage_path: storagePath,
          created_at: new Date(t).toISOString(),
        });
      }

      if (c.past) await finalizeCycle(cycle.id, { startNext: false });
      else hasOpenCycle = true;
    }
    if (!hasOpenCycle) await startCycle(group);
  }
  return { groupIds: created, members };
}
