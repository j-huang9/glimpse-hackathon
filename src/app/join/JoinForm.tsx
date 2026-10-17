"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/Shell";
import { api } from "@/lib/client";

export function JoinForm({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  async function join(c = code) {
    setBusy(true);
    setError(null);
    try {
      const { group } = await api<{ group: { id: string } }>("/api/groups/join", {
        method: "POST",
        body: JSON.stringify({ code: c }),
      });
      router.push(`/g/${group.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialCode && !autoTried.current) {
      autoTried.current = true;
      join(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  return (
    <>
      <Link href="/" className="text-sm text-muted">← Back</Link>
      <h1 className="mt-4 font-serif text-4xl">Join your friends</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          join();
        }}
        className="mt-6 flex flex-col gap-4"
      >
        <Card>
          <label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Invite code</label>
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            autoCapitalize="characters"
            className="mt-2 w-full bg-transparent font-mono text-4xl tracking-[0.3em] outline-none placeholder:text-stone-300"
          />
        </Card>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || code.length < 6} className="h-14 rounded-2xl bg-ink font-medium text-white disabled:opacity-50">
          {busy ? "Joining…" : "Join group"}
        </button>
      </form>
    </>
  );
}
