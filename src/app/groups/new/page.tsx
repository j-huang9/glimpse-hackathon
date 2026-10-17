"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, Shell } from "@/components/Shell";
import { api } from "@/lib/client";

export default function NewGroup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { group } = await api<{ group: { id: string } }>("/api/groups", {
        method: "POST",
        body: JSON.stringify({ name, cycleLengthDays: days }),
      });
      router.push(`/g/${group.id}/settings?new=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Link href="/" className="text-sm text-muted">← Back</Link>
      <h1 className="mt-4 font-serif text-4xl">Start a group</h1>
      <form onSubmit={create} className="mt-6 flex flex-col gap-4">
        <Card>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Group name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Roommates"
            maxLength={40}
            className="mt-2 w-full bg-transparent font-serif text-3xl outline-none placeholder:text-stone-300"
          />
        </Card>
        <Card>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Each prompt lasts</label>
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => setDays(d)}
                className={`h-11 rounded-xl text-sm font-medium transition ${days === d ? "bg-ink text-white" : "bg-white/70 text-ink"}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">The board is revealed when time runs out. You can change this later.</p>
        </Card>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={busy || !name.trim()}
          className="h-14 rounded-2xl bg-ink font-medium text-white shadow-lg shadow-black/10 disabled:opacity-50"
        >
          {busy ? "Writing your first prompt…" : "Create group"}
        </button>
      </form>
    </Shell>
  );
}
