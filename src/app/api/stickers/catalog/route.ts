import { connection } from "next/server";
import { listStickers } from "@/lib/sticker-catalog";

export async function GET() {
  await connection();
  return Response.json({ stickers: await listStickers() });
}
