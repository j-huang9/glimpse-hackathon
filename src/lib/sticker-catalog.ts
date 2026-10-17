import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { StickerDef } from "./stickers";

const DIR = path.join(process.cwd(), "public/stickers");

function labelFor(id: string) {
  const words = id.replace(/^stamp[-_ ]?/i, "").replace(/[-_]+/g, " ").trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : id;
}

/** Tray order from public/stickers/order.json (ids = filenames without extension). Unlisted files go last. */
async function readOrder(): Promise<string[]> {
  try {
    const order = JSON.parse(await readFile(path.join(DIR, "order.json"), "utf8"));
    return Array.isArray(order) ? order.map(String) : [];
  } catch {
    return [];
  }
}

/** Reads public/stickers/ on each call, so new files appear without a restart. */
export async function listStickers(): Promise<StickerDef[]> {
  const files = (await readdir(DIR).catch(() => [])).filter((f) => /\.(png|svg|webp)$/i.test(f)).sort();
  const defs = await Promise.all(
    files.map(async (file): Promise<StickerDef | null> => {
      try {
        const meta = await sharp(path.join(DIR, file)).metadata();
        if (!meta.width || !meta.height) return null;
        const id = file.replace(/\.\w+$/, "");
        return {
          id,
          src: `/stickers/${encodeURIComponent(file)}`,
          label: labelFor(id),
          aspect: meta.height / meta.width,
          kind: /^stamp/i.test(id) ? "stamp" : "sticker",
        };
      } catch {
        return null;
      }
    }),
  );
  const order = await readOrder();
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  return defs.filter((d): d is StickerDef => d !== null).sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
