import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import sharp from "sharp";
import { renderBoard, type Orientation } from "@/lib/board";

/**
 * Dev-only layout preview, no keys needed:
 *   /api/dev/board-preview?n=8&orientation=landscape&theme=film&label=Cottage%20Brunch%20Girl%20Core
 * Uses photos from seed/photos/current when present, otherwise synthetic gradients.
 */
export async function GET(req: Request) {
  await connection();
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });

  const params = new URL(req.url).searchParams;
  const n = Math.min(40, Math.max(1, Number(params.get("n") ?? 8)));
  const orientation: Orientation = params.get("orientation") === "landscape" ? "landscape" : "portrait";

  const dir = path.join(process.cwd(), "seed/photos/current");
  const files = (await readdir(dir).catch(() => [])).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  const hues = ["#f4a261", "#e76f51", "#2a9d8f", "#e9c46a", "#8ab17d", "#b5838d", "#6d6875", "#ffb4a2"];
  const photos = await Promise.all(
    Array.from({ length: Math.min(n, 16) }, async (_, i) => {
      if (files.length) return readFile(path.join(dir, files[i % files.length]));
      const [w, h] = [[1200, 1600], [1600, 1200], [1200, 1200], [1000, 1800]][i % 4];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${hues[i % 8]}"/></svg>`;
      return sharp(Buffer.from(svg)).jpeg().toBuffer();
    }),
  );

  const png = await renderBoard(
    {
      seed: params.get("seed") ?? "preview",
      theme: params.get("theme") === "film" ? "film" : "scrapbook",
      groupName: "The Roommates",
      startsAt: new Date(Date.now() - 7 * 864e5).toISOString(),
      endsAt: new Date().toISOString(),
      vibeLabel: params.get("label") ?? "Cottage Brunch Girl Core",
      palette: ["#fbf3ea", "#f6dcc8", "#e59f86", "#9c6b6e", "#4b3a4f"],
      photos,
      hiddenCount: Math.max(0, n - 16),
    },
    orientation,
  );
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
}
