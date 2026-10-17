/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { BoardEditor } from "@/components/BoardEditor";
import { Countdown } from "@/components/Countdown";
import { GroupHeader } from "@/components/GroupHeader";
import { Card, Shell, Spinner } from "@/components/Shell";
import { useGroup } from "@/components/useGroup";
import { api, formatRange, paletteVars, shrinkImage } from "@/lib/client";
import type { Cycle, GroupView } from "@/lib/types";

const SEEN_KEY = "glimpse:seen-boards";

function isRecent(iso: string, days = 2) {
  return Date.now() - new Date(iso).getTime() < days * 86_400_000;
}

function seenBoards(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function GroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { view, error, refresh } = useGroup(groupId);

  return (
    <Shell style={paletteVars(view?.latest?.palette)}>
      <GroupHeader groupId={groupId} active="home" />
      {error && !view ? <p className="text-red-600">{error}</p> : !view ? <Spinner /> : <GroupHome view={view} refresh={refresh} />}
    </Shell>
  );
}

function GroupHome({ view, refresh }: { view: GroupView; refresh: () => Promise<void> }) {
  const { current, latest } = view;
  const [dismissed, setDismissed] = useState<string[]>([]);
  const revealing =
    latest?.status === "revealed" && !dismissed.includes(latest.id) && !seenBoards().includes(latest.id) ? latest : null;

  function dismissReveal() {
    if (!revealing) return;
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seenBoards(), revealing.id].slice(-50)));
    } catch {}
    setDismissed((d) => [...d, revealing.id]);
  }

  const recent = latest && isRecent(latest.ends_at);
  const board = latest?.status === "revealed" && <LatestBoard cycle={latest} me={view.me} groupName={view.group.name} />;
  const quiet = latest?.status === "empty" && recent && (
    <Card className="text-center">
      <p className="font-serif text-3xl">Quiet week, we missed you all 💌</p>
      <p className="mt-2 text-sm text-muted">No photos last cycle. Fresh prompt below. Make this one count!</p>
    </Card>
  );

  return (
    <div className="flex flex-col gap-5">
      {revealing && <RevealOverlay cycle={revealing} onClose={dismissReveal} />}
      {recent && (board || quiet)}
      {current?.status === "finalizing" ? (
        <Card className="text-center">
          <Spinner label="Developing your board…" />
        </Card>
      ) : (
        current && <PromptCard view={view} refresh={refresh} />
      )}
      {!recent && board && (
        <>
          <h2 className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Last board</h2>
          {board}
        </>
      )}
    </div>
  );
}

function PromptCard({ view, refresh }: { view: GroupView; refresh: () => Promise<void> }) {
  const cycle = view.current!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [sealedAt, setSealedAt] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const postedSet = new Set(cycle.posted_user_ids);
  const iPosted = postedSet.has(view.me);
  const members = [...view.members].sort((a, b) => Number(postedSet.has(b.id)) - Number(postedSet.has(a.id)));

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMessage(null);
    // One photo per request keeps each body well under Vercel's ~4.5 MB limit.
    const list = Array.from(files);
    let saved = 0;
    const failures: string[] = [];
    for (const [i, f] of list.entries()) {
      setUploading(list.length > 1 ? `Sealing ${i + 1} of ${list.length}…` : "Sealing…");
      try {
        const form = new FormData();
        form.append("photos", await shrinkImage(f), f.name.replace(/\.\w+$/, ".jpg"));
        await api(`/api/cycles/${cycle.id}/photos`, { method: "POST", body: form });
        saved++;
      } catch (err) {
        failures.push((err as Error).message);
      }
    }
    if (saved) {
      setSealedAt(Date.now());
      setMessage(`Sealed ${saved} photo${saved === 1 ? "" : "s"}. Nobody sees them until the reveal.`);
    }
    if (failures.length) setMessage((m) => [m, `${failures.length} didn't upload: ${failures[0]}`].filter(Boolean).join(" "));
    try {
      await refresh();
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function report() {
    if (!confirm("Report this prompt as inappropriate? It'll be logged for review.")) return;
    await api(`/api/cycles/${cycle.id}/report`, { method: "POST", body: "{}" }).catch(() => {});
    setReported(true);
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        <span>This cycle&apos;s prompt</span>
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-ink normal-case tracking-normal">
          ⏳ <Countdown to={cycle.ends_at} />
        </span>
      </div>
      <p className="mt-4 font-serif text-[40px] leading-[1.05]">{cycle.prompt}</p>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex -space-x-2">
          {members.slice(0, 8).map((m) => (
            <Avatar key={`${m.id}-${postedSet.has(m.id)}`} profile={m} size={38} dim={!postedSet.has(m.id)} />
          ))}
        </div>
        <span className="text-sm text-muted">
          {cycle.count} photo{cycle.count === 1 ? "" : "s"} sealed
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">
        {postedSet.size} of {view.members.length} friends have posted
      </p>

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={!!uploading}
        className="mt-5 h-14 w-full rounded-2xl bg-accent font-medium text-white shadow-lg shadow-black/10 transition active:scale-[0.98] disabled:opacity-60"
      >
        {uploading ?? (iPosted ? "Add more photos" : "Add your photos")}
      </button>
      {message && (
        <div className="mt-4 flex flex-col items-center gap-1 text-center text-sm">
          {sealedAt > 0 && (
            <span key={sealedAt} className="animate-seal text-4xl" aria-hidden>
              ✉️
            </span>
          )}
          <p>{message}</p>
        </div>
      )}

      <div className="mt-4 text-center">
        {reported ? (
          <span className="text-xs text-muted">Thanks, we logged it.</span>
        ) : (
          <button onClick={report} className="text-xs text-muted underline-offset-2 hover:underline">
            Report prompt
          </button>
        )}
      </div>
    </Card>
  );
}

function LatestBoard({ cycle, me, groupName }: { cycle: Cycle; me: string; groupName: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{formatRange(cycle.starts_at, cycle.ends_at)}</p>
          <p className="font-serif text-3xl leading-tight">{cycle.vibe_label}</p>
        </div>
        <Link
          href={`/g/${cycle.group_id}/board/${cycle.id}`}
          className="shrink-0 rounded-full border border-line bg-white/80 px-4 py-2 text-sm font-medium"
        >
          ✨ Decorate
        </Link>
      </div>
      <BoardEditor cycleId={cycle.id} boardUrl={cycle.board_url!} boardUrlLandscape={cycle.board_url_landscape} me={me} shareName={slug(groupName)} />
    </div>
  );
}

function RevealOverlay({ cycle, onClose }: { cycle: Cycle; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 overflow-y-auto p-6"
      style={{ background: `linear-gradient(170deg, ${cycle.palette?.[0] ?? "#fff"}, ${cycle.palette?.[1] ?? "#eee"})` }}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">Your board is ready</p>
      <img
        src={cycle.board_url!}
        alt={cycle.vibe_label ?? "Moodboard"}
        className="animate-reveal max-h-[70dvh] rounded-3xl shadow-2xl shadow-black/25"
      />
      <div className="flex w-full max-w-xs gap-3">
        <button onClick={onClose} className="h-12 flex-1 rounded-2xl bg-white/80 font-medium">Close</button>
        <Link
          href={`/g/${cycle.group_id}/board/${cycle.id}`}
          onClick={onClose}
          className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-ink font-medium text-white"
        >
          ✨ Decorate
        </Link>
      </div>
    </div>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "glimpse";
}
