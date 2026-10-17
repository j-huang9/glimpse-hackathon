import { connection } from "next/server";
import { IS_DEMO } from "@/lib/demo-flag";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Demo mode: the people you can "sign in" as. */
export async function GET() {
  await connection();
  if (!IS_DEMO) return Response.json({ error: "Not in demo mode" }, { status: 404 });
  const { data } = await supabaseAdmin().from("profiles").select("id, display_name, avatar_url").order("created_at");
  return Response.json({ users: data ?? [] });
}
