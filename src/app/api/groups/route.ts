import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { makeInviteCode, startCycle } from "@/lib/cycles";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const body = await req.json();
    const name = String(body.name ?? "").trim().slice(0, 40);
    const days = Math.round(Number(body.cycleLengthDays ?? 7));
    if (!name) throw new HttpError(400, "Give your group a name");
    if (!(days >= 1 && days <= 7)) throw new HttpError(400, "Cycle length must be 1–7 days");

    const db = supabaseAdmin();
    let group = null;
    for (let i = 0; i < 5 && !group; i++) {
      const { data, error } = await db
        .from("groups")
        .insert({ name, cycle_length_days: days, invite_code: makeInviteCode(), created_by: me })
        .select()
        .single();
      if (!error) group = data;
      else if (error.code !== "23505") throw error; // retry only on invite-code collision
    }
    if (!group) throw new HttpError(500, "Couldn't create group");

    await db.from("group_members").insert({ group_id: group.id, user_id: me });
    await startCycle(group);
    return Response.json({ group });
  } catch (err) {
    return errorResponse(err);
  }
}
