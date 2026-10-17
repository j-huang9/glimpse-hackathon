import { connection } from "next/server";
import sharp from "sharp";
import { renderBoard } from "@/lib/board";

/** Dev-only: GET /api/dev/board-preview?n=12 renders a board from synthetic photos, for tweaking the layout. */
export async function GET(req: Request) {
  await connection();
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });

  const n = Math.min(40, Math.max(1, Number(new URL(req.url).searchParams.get("n") ?? 12)));
  const hues = ["#f4a261", "#e76f51", "#2a9d8f", "#e9c46a", "#8ab17d", "#b5838d", "#6d6875", "#ffb4a2"];
  const photos = await Promise.all(
    Array.from({ length: Math.min(n, 30) }, (_, i) => {
      const [w, h] = [[1200, 1600], [1600, 1200], [1200, 1200], [1000, 1800]][i % 4];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hues[i % 8]}"/><stop offset="1" stop-color="${hues[(i + 3) % 8]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" font-size="220" text-anchor="middle" fill="white" font-family="sans-serif">${i + 1}</text></svg>`;
      return sharp(Buffer.from(svg)).jpeg().toBuffer();
    }),
  );
  const png = await renderBoard({
    groupName: "The Roommates",
    startsAt: new Date(Date.now() - 7 * 864e5).toISOString(),
    endsAt: new Date().toISOString(),
    vibeLabel: new URL(req.url).searchParams.get("label") ?? "Cozy Cottagecore Brunch Club",
    palette: ["#fbefe3", "#f3c9a5", "#e59f86", "#9c6b6e", "#4b3a4f"],
    photos,
    hiddenCount: Math.max(0, n - 30),
  });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
}
