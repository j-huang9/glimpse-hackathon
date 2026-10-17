import { connection, type NextRequest } from "next/server";
import { errorResponse, HttpError, requireCycleMember, requireUser } from "@/lib/auth";
import { STICKER_IDS } from "@/lib/stickers";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/cycles/[id]/stickers">) {
  await connection();
  try {
    const { id } = await ctx.params;
    await requireCycleMember(id, await requireUser(req));
    const { data, error } = await supabaseAdmin()
      .from("board_stickers")
      .select("*")
      .eq("cycle_id", id)
      .order("created_at");
    if (error) throw error;
    return Response.json({ stickers: data });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/cycles/[id]/stickers">) {
  try {
    const { id } = await ctx.params;
    const me = await requireUser(req);
    const cycle = await requireCycleMember(id, me);
    if (cycle.status !== "revealed") throw new HttpError(409, "Stickers go on revealed boards");

    const body = await req.json();
    if (!STICKER_IDS.has(body.stickerId)) throw new HttpError(400, "Unknown sticker");
    const { data, error } = await supabaseAdmin()
      .from("board_stickers")
      .insert({
        cycle_id: id,
        user_id: me,
        sticker_id: body.stickerId,
        x: clamp(body.x ?? 0.5, 0, 1),
        y: clamp(body.y ?? 0.5, 0, 1),
        scale: clamp(body.scale ?? 0.22, 0.06, 0.8),
        rotation: Number(body.rotation ?? 0) || 0,
      })
      .select()
      .single();
    if (error) throw error;
    return Response.json({ sticker: data });
  } catch (err) {
    return errorResponse(err);
  }
}

function clamp(v: unknown, min: number, max: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
