import type { NextRequest } from "next/server";
import sharp from "sharp";
import { errorResponse, HttpError, requireCycleMember, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/cycles/[id]/photos">) {
  try {
    const { id } = await ctx.params;
    const me = await requireUser(req);
    const cycle = await requireCycleMember(id, me);
    if (cycle.status !== "active" || new Date(cycle.ends_at) < new Date()) {
      throw new HttpError(409, "This cycle has closed");
    }

    const files = (await req.formData()).getAll("photos").filter((f): f is File => f instanceof File);
    if (!files.length) throw new HttpError(400, "No photos attached");

    const db = supabaseAdmin();
    let saved = 0;
    for (const file of files.slice(0, 20)) {
      const jpg = await sharp(Buffer.from(await file.arrayBuffer()))
        .rotate()
        .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
        .catch(() => {
          throw new HttpError(415, "Couldn't read that photo. Try a JPG or PNG (or a screenshot of it).");
        });
      const path = `${id}/${crypto.randomUUID()}.jpg`;
      const { error } = await db.storage.from("photos").upload(path, jpg, { contentType: "image/jpeg" });
      if (error) throw error;
      await db.from("photos").insert({ cycle_id: id, user_id: me, storage_path: path });
      saved++;
    }
    return Response.json({ saved });
  } catch (err) {
    return errorResponse(err);
  }
}
