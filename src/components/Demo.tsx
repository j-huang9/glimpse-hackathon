/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { getDemoUser, setDemoUser, type DemoUser } from "@/lib/client";

function useDemoUsers() {
  const [users, setUsers] = useState<DemoUser[] | null>(null);
  const reload = () =>
    fetch("/api/demo/users")
      .then((r) => r.json())
      .then((r) => setUsers(r.users ?? []))
      .catch(() => setUsers([]));
  useEffect(() => {
    reload();
  }, []);
  return { users, reload };
}

async function resetDemo() {
  const res = await fetch("/api/demo/reset", { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Reset failed");
}

function Face({ user, size = 40 }: { user: DemoUser; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="inline-block shrink-0 overflow-hidden rounded-full border-2 border-white shadow-sm">
      {user.avatar_url ? <img src={user.avatar_url} alt="" className="size-full" /> : null}
    </span>
  );
}

/** Replaces Google sign-in in demo mode: pick which friend you are. */
export function DemoSignIn() {
  const { users, reload } = useDemoUsers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setup() {
    setBusy(true);
    setError(null);
    try {
      await resetDemo();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!users) return null;
  if (users.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <button
          onClick={setup}
          disabled={busy}
          className="h-14 rounded-2xl bg-ink text-[16px] font-medium text-white shadow-lg shadow-black/10 disabled:opacity-60"
        >
          {busy ? "Making boards for your demo group…" : "Set up demo"}
        </button>
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Who are you?</p>
      <div className="grid grid-cols-2 gap-2">
        {users.map((u) => (
          <button
            key={u.id}
            onClick={() => setDemoUser(u)}
            className="flex items-center gap-3 rounded-2xl border border-line bg-white/75 p-3 text-left font-medium backdrop-blur transition active:scale-[0.98]"
          >
            <Face user={u} size={36} />
            {u.display_name}
          </button>
        ))}
      </div>
      <button onClick={setup} disabled={busy} className="mt-2 text-sm text-muted underline-offset-2 hover:underline">
        {busy ? "Resetting…" : "Reset demo data"}
      </button>
    </div>
  );
}

/** Small floating avatar: tap to switch which friend you're viewing as, or reset the demo. */
export function DemoSwitcher() {
  const { users } = useDemoUsers();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<DemoUser | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setMe(getDemoUser()), 0);
    return () => clearTimeout(t);
  }, []);

  function switchTo(u: DemoUser) {
    setDemoUser(u);
    window.location.reload();
  }

  async function reset() {
    if (!confirm("Reset all demo data? Uploads and stickers will be cleared.")) return;
    setBusy(true);
    await resetDemo().catch(() => {});
    setDemoUser(null);
    // Full reload on purpose: every page's cached state belongs to the wiped data.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }

  if (!me) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="w-56 rounded-3xl border border-line bg-white/95 p-2 shadow-2xl backdrop-blur-xl">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Demo · view as</p>
          {users?.map((u) => (
            <button
              key={u.id}
              onClick={() => switchTo(u)}
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm ${u.id === me.id ? "bg-stone-100 font-semibold" : ""}`}
            >
              <Face user={u} size={28} />
              {u.display_name}
            </button>
          ))}
          <button onClick={reset} disabled={busy} className="mt-1 w-full rounded-2xl px-3 py-2 text-left text-sm text-red-600">
            {busy ? "Resetting…" : "Reset demo data"}
          </button>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-label="Switch demo user" className="rounded-full shadow-lg transition active:scale-95">
        <Face user={me} size={44} />
      </button>
    </div>
  );
}
