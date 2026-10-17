/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { GroupHeader } from "@/components/GroupHeader";
import { Shell, Spinner } from "@/components/Shell";
import { api, formatRange, paletteVars } from "@/lib/client";
import type { Cycle } from "@/lib/types";

export default function ArchivePage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [cycles, setCycles] = useState<Cycle[] | null>(null);

  useEffect(() => {
    api<{ cycles: Cycle[] }>(`/api/groups/${groupId}/archive`).then((r) => setCycles(r.cycles)).catch(() => setCycles([]));
  }, [groupId]);

  const latest = cycles?.find((c) => c.status === "revealed");

  return (
    <Shell style={paletteVars(latest?.palette)}>
      <GroupHeader groupId={groupId} active="archive" />
      <h1 className="font-serif text-4xl">Scrapbook</h1>
      <p className="mt-1 text-muted">Every cycle, one page of your friendship.</p>
      {!cycles ? (
        <Spinner />
      ) : cycles.length === 0 ? (
        <p className="mt-10 text-center text-muted">Your first board shows up here when this cycle ends.</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {cycles.map((c) =>
            c.status === "revealed" ? (
              <Link key={c.id} href={`/g/${groupId}/board/${c.id}`} className="group flex flex-col gap-1.5">
                <img
                  src={c.board_url!}
                  alt={c.vibe_label ?? ""}
                  className="aspect-[9/16] w-full rounded-2xl object-cover shadow-lg shadow-black/10 transition group-active:scale-[0.98]"
                />
                <p className="font-serif text-lg leading-tight">{c.vibe_label}</p>
                <p className="text-xs text-muted">{formatRange(c.starts_at, c.ends_at)}</p>
              </Link>
            ) : (
              <div key={c.id} className="flex flex-col gap-1.5">
                <div className="flex aspect-[9/16] items-center justify-center rounded-2xl border border-dashed border-stone-300 p-4 text-center font-serif text-xl text-muted">
                  Quiet week 💌
                </div>
                <p className="text-xs text-muted">{formatRange(c.starts_at, c.ends_at)}</p>
              </div>
            ),
          )}
        </div>
      )}
    </Shell>
  );
}
