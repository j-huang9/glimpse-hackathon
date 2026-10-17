import type { NextRequest } from "next/server";
import { errorResponse, requireCycleMember, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/cycles/[id]/report">) {
  try {
    const { id } = await ctx.params;
    const me = await requireUser(req);
    await requireCycleMember(id, me);
    const { reason } = await req.json().catch(() => ({}));
    await supabaseAdmin()
      .from("prompt_reports")
      .insert({ cycle_id: id, user_id: me, reason: reason ? String(reason).slice(0, 500) : null });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
