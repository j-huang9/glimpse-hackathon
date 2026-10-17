// Imports hand-drawn sticker PNGs into the app.
//
//   npm run stickers -- ~/Desktop/our-stickers            (a folder)
//   npm run stickers -- heart.png star.png               (or files)
//   npm run stickers -- ~/Desktop/our-stickers --replace  (also removes the placeholder art)
//
// Each image is trimmed to its drawn edges, shrunk to at most 600px, and saved as
// public/stickers/<name>.png. Filenames containing "stamp" land in the Stamps row.
// New stickers show up in the Decorate tray right away (no restart).

import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const inputs = args.filter((a) => a !== "--replace");
if (!inputs.length) {
  console.error("Usage: npm run stickers -- <folder or files…> [--replace]");
  process.exit(1);
}

const OUT = path.join(process.cwd(), "public/stickers");
const PLACEHOLDERS = ["heart", "star", "sparkle", "flower", "smiley", "stamp-miss-u", "stamp-besties", "stamp-ten", "stamp-iconic"];

const files = [];
for (const input of inputs) {
  const p = path.resolve(input.replace(/^~(?=$|\/)/, process.env.HOME));
  if ((await stat(p)).isDirectory()) {
    for (const f of (await readdir(p)).sort()) if (/\.(png|webp)$/i.test(f)) files.push(path.join(p, f));
  } else files.push(p);
}
if (!files.length) {
  console.error("No .png or .webp files found.");
  process.exit(1);
}

if (replace) {
  for (const id of PLACEHOLDERS) await rm(path.join(OUT, `${id}.svg`), { force: true });
  console.log("Removed placeholder stickers");
}

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/\.\w+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "sticker";

for (const file of files) {
  const id = slug(path.basename(file));
  const img = sharp(file).ensureAlpha();
  const meta = await img.metadata();
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .trim({ threshold: 1 })
    .resize(600, 600, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  await sharp(data).toFile(path.join(OUT, `${id}.png`));
  const opaque = (await sharp(data).stats()).isOpaque;
  console.log(
    `✓ ${id}.png  ${meta.width}×${meta.height} → ${info.width}×${info.height}${/stamp/.test(id) ? "  [stamp]" : ""}${
      opaque ? "  ⚠ no transparency: it will show as a rectangle" : ""
    }`,
  );
}
