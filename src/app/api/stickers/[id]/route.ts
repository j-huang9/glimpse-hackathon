import type { NextRequest } from "next/server";
import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Members can only move/resize/remove stickers they placed themselves. */
async function requireOwnSticker(req: NextRequest, id: string) {
  const me = await requireUser(req);
  const { data } = await supabaseAdmin().from("board_stickers").select("user_id").eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "Sticker not found");
  if (data.user_id !== me) throw new HttpError(403, "That's someone else's sticker");
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/stickers/[id]">) {
  try {
    const { id } = await ctx.params;
    await requireOwnSticker(req, id);
    const body = await req.json();
    const patch: Record<string, number> = {};
    for (const [key, [min, max]] of Object.entries({
      x: [0, 1],
      y: [0, 1],
      scale: [0.06, 0.8],
      rotation: [-360, 360],
    })) {
      const n = Number(body[key]);
      if (body[key] !== undefined && Number.isFinite(n)) patch[key] = Math.min(max, Math.max(min, n));
    }
    const { data, error } = await supabaseAdmin().from("board_stickers").update(patch).eq("id", id).select().single();
    if (error) throw error;
    return Response.json({ sticker: data });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/stickers/[id]">) {
  try {
    const { id } = await ctx.params;
    await requireOwnSticker(req, id);
    await supabaseAdmin().from("board_stickers").delete().eq("id", id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
