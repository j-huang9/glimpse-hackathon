"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Shell, Spinner } from "@/components/Shell";
import { api, useSession } from "@/lib/client";
import { supabaseBrowser } from "@/lib/supabase-browser";

type GroupLite = { id: string; name: string };

export default function Home() {
  return (
    <Shell>
      <Groups />
    </Shell>
  );
}

function Groups() {
  const session = useSession();
  const [groups, setGroups] = useState<GroupLite[] | null>(null);
  useEffect(() => {
    api<{ groups: GroupLite[] }>("/api/me/groups").then((r) => setGroups(r.groups)).catch(() => setGroups([]));
  }, []);

  if (!groups) return <Spinner />;
  const first = session?.user.user_metadata?.full_name?.split(" ")[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <span className="font-serif text-2xl">glimpse</span>
        <button onClick={() => supabaseBrowser().auth.signOut()} className="text-sm text-muted">Sign out</button>
      </div>
      <h1 className="font-serif text-4xl leading-tight">{first ? `Hi ${first},` : "Hi,"} who are we catching up with?</h1>

      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <Link key={g.id} href={`/g/${g.id}`}>
            <Card className="flex items-center justify-between transition active:scale-[0.99]">
              <span className="text-lg font-medium">{g.name}</span>
              <span className="text-muted">→</span>
            </Card>
          </Link>
        ))}
        {groups.length === 0 && <p className="text-muted">You&apos;re not in any groups yet.</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/groups/new" className="flex h-14 items-center justify-center rounded-2xl bg-ink font-medium text-white shadow-lg shadow-black/10">
          New group
        </Link>
        <Link href="/join" className="flex h-14 items-center justify-center rounded-2xl border border-line bg-white/70 font-medium backdrop-blur">
          Join with code
        </Link>
      </div>
    </div>
  );
}
