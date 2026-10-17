// Seeds a demo group with real photos so the on-stage demo doesn't depend on a live week.
//
//   1. Put photos in folders, e.g. seed/photos/past-1, seed/photos/past-2, seed/photos/current
//   2. Edit seed/config.json (group name, friend names, prompt per folder)
//   3. Start the app (npm run dev), then: npm run seed
//
// Past cycles get finalized into boards (they show up in the Scrapbook). The last
// non-past cycle stays open with its photos sealed, ready for "Generate board now".
// Photos are dealt round-robin to the seeded friends. Join the group yourself with the printed invite code.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, APP_URL = "http://localhost:3000" } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CRON_SECRET) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or CRON_SECRET in .env.local");
  process.exit(1);
}

const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const config = JSON.parse(await readFile("seed/config.json", "utf8"));
const DAY = 86_400_000;

async function ensureUser(name) {
  const email = `seed+${name.toLowerCase().replace(/\W+/g, "")}@glimpse.test`;
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  let user = created?.user;
  if (error) {
    const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
    user = data.users.find((u) => u.email === email);
    if (!user) throw error;
  }
  await db.from("profiles").upsert({ id: user.id, display_name: name, avatar_url: null });
  return user.id;
}

async function listPhotos(dir) {
  const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png|heic|webp)$/i.test(f)).sort();
  return files.map((f) => path.join(dir, f));
}

const members = [];
for (const name of config.members) members.push(await ensureUser(name));
console.log(`✓ ${members.length} friends`);

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const inviteCode = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
const { data: group, error: gErr } = await db
  .from("groups")
  .insert({ name: config.groupName, invite_code: inviteCode, cycle_length_days: 7, created_by: members[0] })
  .select()
  .single();
if (gErr) throw gErr;
await db.from("group_members").insert(members.map((user_id) => ({ group_id: group.id, user_id })));
console.log(`✓ group "${group.name}"`);

const past = config.cycles.filter((c) => c.past);
for (const [i, c] of config.cycles.entries()) {
  const pastIndex = past.indexOf(c);
  const startsAt = c.past ? Date.now() - (past.length - pastIndex + 1) * 7 * DAY : Date.now() - 5 * DAY;
  const endsAt = c.past ? startsAt + 7 * DAY : Date.now() + 2 * DAY;

  const { data: cycle, error } = await db
    .from("cycles")
    .insert({
      group_id: group.id,
      prompt: c.prompt,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  const files = await listPhotos(c.dir);
  for (const [j, file] of files.entries()) {
    const jpg = await sharp(await readFile(file))
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const storagePath = `${cycle.id}/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await db.storage.from("photos").upload(storagePath, jpg, { contentType: "image/jpeg" });
    if (upErr) throw upErr;
    await db.from("photos").insert({
      cycle_id: cycle.id,
      user_id: members[j % members.length],
      storage_path: storagePath,
      created_at: new Date(startsAt + ((j + 1) / (files.length + 1)) * (Math.min(endsAt, Date.now()) - startsAt)).toISOString(),
    });
  }
  console.log(`✓ cycle ${i + 1}: "${c.prompt}" (${files.length} photos)`);

  if (c.past) {
    process.stdout.write("  generating board… ");
    const res = await fetch(`${APP_URL}/api/cycles/${cycle.id}/finalize`, {
      method: "POST",
      headers: { "x-cron-secret": CRON_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ startNext: false }),
    });
    if (!res.ok) throw new Error(`finalize failed: ${res.status} ${await res.text()}`);
    console.log("done");
  }
}

console.log(`\nInvite code: ${inviteCode}   →   ${APP_URL}/join/${inviteCode}`);
