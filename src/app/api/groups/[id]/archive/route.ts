import { connection, type NextRequest } from "next/server";
import { errorResponse, requireMember, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/groups/[id]/archive">) {
  await connection();
  try {
    const { id } = await ctx.params;
    const me = await requireUser(req);
    await requireMember(id, me);
    const { data, error } = await supabaseAdmin()
      .from("cycles")
      .select("*")
      .eq("group_id", id)
      .in("status", ["revealed", "empty"])
      .order("ends_at", { ascending: false });
    if (error) throw error;
    return Response.json({ cycles: data });
  } catch (err) {
    return errorResponse(err);
  }
}
