"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BoardEditor } from "@/components/BoardEditor";
import { GroupHeader } from "@/components/GroupHeader";
import { Shell, Spinner } from "@/components/Shell";
import { api, formatRange, paletteVars, useSession } from "@/lib/client";
import type { Cycle } from "@/lib/types";

export default function BoardPage() {
  const { groupId, cycleId } = useParams<{ groupId: string; cycleId: string }>();
  const session = useSession();
  const [cycle, setCycle] = useState<Cycle | null | undefined>(undefined);

  useEffect(() => {
    api<{ cycles: Cycle[] }>(`/api/groups/${groupId}/archive`)
      .then((r) => setCycle(r.cycles.find((c) => c.id === cycleId && c.status === "revealed") ?? null))
      .catch(() => setCycle(null));
  }, [groupId, cycleId]);

  return (
    <Shell style={paletteVars(cycle?.palette)}>
      <GroupHeader groupId={groupId} active="board" />
      {cycle === undefined || !session ? (
        <Spinner />
      ) : cycle === null ? (
        <p className="text-muted">Board not found. <Link href={`/g/${groupId}`} className="underline">Go back</Link></p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{formatRange(cycle.starts_at, cycle.ends_at)}</p>
            <h1 className="font-serif text-4xl leading-tight">{cycle.vibe_label}</h1>
          </div>
          <BoardEditor cycleId={cycle.id} boardUrl={cycle.board_url!} boardUrlLandscape={cycle.board_url_landscape} me={session.user.id} editable shareName="glimpse-board" />
        </div>
      )}
    </Shell>
  );
}
