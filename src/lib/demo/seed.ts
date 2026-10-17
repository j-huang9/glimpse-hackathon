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

/** seed/avatars/<Name>.jpg|png|webp if present (any case), otherwise a pastel initial. */
async function avatar(name: string, i: number) {
  const dir = path.join(process.cwd(), "seed/avatars");
  const file = (await readdir(dir).catch(() => [] as string[])).find(
    (f) => /\.(jpe?g|png|webp|heic)$/i.test(f) && f.replace(/\.\w+$/, "").toLowerCase() === name.toLowerCase(),
  );
  if (file) {
    try {
      const jpg = await sharp(path.join(dir, file)).rotate().resize(192, 192, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 82 }).toBuffer();
      return `data:image/jpeg;base64,${jpg.toString("base64")}`;
    } catch {
      /* unreadable file: fall through to initials */
    }
  }
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
type SeedConfig = {
  members: string[];
  /** Who uploads live on camera: starts with no photos in open cycles. Defaults to the last two members. */
  presenter?: string;
  groups?: SeedGroup[];
  groupName?: string;
  cycles?: SeedCycle[];
};
type Member = { id: string; display_name: string; avatar_url: string };

const isPhoto = (f: string) => /\.(jpe?g|png|webp)$/i.test(f);

/**
 * Photos in a cycle folder, each paired with who posted it:
 *   <dir>/Maya/*.jpg → Maya's photos;  loose files in <dir> → dealt round-robin to `fallback`.
 * Returned in an interleaved order so posting times mix across friends.
 */
async function assignPhotos(dir: string, members: Member[], fallback: Member[], skip: Set<string>) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const byPerson: { member: Member; file: string }[][] = [];
  const loose = entries.filter((e) => e.isFile() && isPhoto(e.name)).map((e) => path.join(dir, e.name)).sort();
  loose.forEach((file, j) => {
    const member = fallback[j % fallback.length];
    (byPerson[j % fallback.length] ??= []).push({ member, file });
  });
  for (const e of entries.filter((e) => e.isDirectory())) {
    const member = members.find((m) => m.display_name.toLowerCase() === e.name.toLowerCase());
    if (!member || skip.has(member.id)) continue;
    const files = (await readdir(path.join(dir, e.name))).filter(isPhoto).sort();
    byPerson.push(files.map((f) => ({ member, file: path.join(dir, e.name, f) })));
  }
  const out: { member: Member; file: string }[] = [];
  for (let k = 0; byPerson.some((list) => list && k < list.length); k++) {
    for (const list of byPerson) if (list?.[k]) out.push(list[k]);
  }
  return out;
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

  const members: Member[] = await Promise.all(
    config.members.map(async (name, i) => ({ id: stableId(name), display_name: name, avatar_url: await avatar(name, i) })),
  );
  await db.from("profiles").insert(members);
  const presenter = members.find((m) => m.display_name.toLowerCase() === config.presenter?.toLowerCase());
  const posters = presenter ? members.filter((m) => m !== presenter) : members.slice(0, Math.max(1, members.length - 2));
  const notYetPosted = new Set(members.filter((m) => !posters.includes(m)).map((m) => m.id));
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

      // In the open cycle, whoever uploads live on camera hasn't posted yet.
      const files = await assignPhotos(path.join(process.cwd(), c.dir), members, c.past ? members : posters, c.past ? new Set() : notYetPosted);
      for (const [j, { member, file }] of files.entries()) {
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
          user_id: member.id,
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
