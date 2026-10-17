import { connection } from "next/server";
import { errorResponse, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: Request) {
  await connection();
  try {
    const me = await requireUser(req);
    const { data, error } = await supabaseAdmin()
      .from("group_members")
      .select("joined_at, groups(id, name, invite_code)")
      .eq("user_id", me)
      .order("joined_at", { ascending: false });
    if (error) throw error;
    return Response.json({ groups: (data ?? []).map((r) => r.groups) });
  } catch (err) {
    return errorResponse(err);
  }
}
