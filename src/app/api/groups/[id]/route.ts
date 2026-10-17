import { connection, type NextRequest } from "next/server";
import { errorResponse, HttpError, requireMember, requireUser } from "@/lib/auth";
import { finalizeCycle, startCycle } from "@/lib/cycles";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Cycle, Group, GroupView, Profile } from "@/lib/types";

export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/groups/[id]">) {
  await connection();
  try {
    const { id } = await ctx.params;
    const me = await requireUser(req);
    await requireMember(id, me);
    const db = supabaseAdmin();

    const { data: group } = await db.from("groups").select("*").eq("id", id).single<Group>();
    if (!group) throw new HttpError(404, "Group not found");

    const loadCurrent = () =>
      db
        .from("cycles")
        .select("*")
        .eq("group_id", id)
        .in("status", ["active", "finalizing"])
        .maybeSingle<Cycle>();

    let { data: current } = await loadCurrent();
    // Lazy finalize: whoever opens the group after the timer runs out triggers the reveal.
    if (current?.status === "active" && new Date(current.ends_at) < new Date()) {
      await finalizeCycle(current.id);
      ({ data: current } = await loadCurrent());
    }
    if (!current) current = await startCycle(group);

    const [{ data: memberRows }, { data: posted }, { data: latest }] = await Promise.all([
      db.from("group_members").select("profiles(id, display_name, avatar_url)").eq("group_id", id).order("joined_at"),
      db.from("photos").select("user_id").eq("cycle_id", current.id),
      db
        .from("cycles")
        .select("*")
        .eq("group_id", id)
        .in("status", ["revealed", "empty"])
        .order("ends_at", { ascending: false })
        .limit(1)
        .maybeSingle<Cycle>(),
    ]);

    const view: GroupView = {
      group,
      members: (memberRows ?? []).map((r) => r.profiles as unknown as Profile),
      current: {
        ...current,
        posted_user_ids: [...new Set((posted ?? []).map((p) => p.user_id))],
        count: posted?.length ?? 0,
      },
      latest: latest ?? null,
      me,
    };
    return Response.json(view);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/groups/[id]">) {
  try {
    const { id } = await ctx.params;
    const me = await requireUser(req);
    await requireMember(id, me);
    const db = supabaseAdmin();
    const { data: group } = await db.from("groups").select("created_by").eq("id", id).single();
    if (group?.created_by !== me) throw new HttpError(403, "Only the group creator can change this");

    const days = Math.round(Number((await req.json()).nextCycleLengthDays));
    if (!(days >= 1 && days <= 7)) throw new HttpError(400, "Cycle length must be 1–7 days");
    await db.from("groups").update({ next_cycle_length_days: days }).eq("id", id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
