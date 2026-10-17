import { readFile } from "node:fs/promises";
import { connection, type NextRequest } from "next/server";
import { IS_DEMO } from "@/lib/demo-flag";
import { demoStorageFile } from "@/lib/demo/store";

/** Demo mode: serves rendered boards (the only public bucket). Photos stay private. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/demo/storage/[...path]">) {
  await connection();
  const { path } = await ctx.params;
  const [bucket, file] = path;
  if (!IS_DEMO || bucket !== "boards" || path.length !== 2 || !/^[\w-]+\.png$/.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const png = await readFile(demoStorageFile(bucket, file));
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
