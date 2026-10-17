import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const { code } = await req.json();
    const db = supabaseAdmin();
    const { data: group } = await db
      .from("groups")
      .select("id, name")
      .eq("invite_code", String(code ?? "").trim().toUpperCase())
      .maybeSingle();
    if (!group) throw new HttpError(404, "No group with that code");
    await db.from("group_members").upsert({ group_id: group.id, user_id: me }, { onConflict: "group_id,user_id" });
    return Response.json({ group });
  } catch (err) {
    return errorResponse(err);
  }
}
