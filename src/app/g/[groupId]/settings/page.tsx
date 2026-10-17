"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { GroupHeader } from "@/components/GroupHeader";
import { Card, Shell, Spinner } from "@/components/Shell";
import { useGroup } from "@/components/useGroup";
import { api, paletteVars } from "@/lib/client";
import type { GroupView } from "@/lib/types";

export default function SettingsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { view, refresh } = useGroup(groupId, 30_000);
  return (
    <Shell style={paletteVars(view?.latest?.palette)}>
      <GroupHeader groupId={groupId} active="settings" />
      {!view ? (
        <Spinner />
      ) : (
        <Suspense>
          <Settings view={view} refresh={refresh} />
        </Suspense>
      )}
    </Shell>
  );
}

function Settings({ view, refresh }: { view: GroupView; refresh: () => Promise<void> }) {
  const router = useRouter();
  const isNew = useSearchParams().get("new") === "1";
  const { group } = view;
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isCreator = group.created_by === view.me;
  const link = typeof window !== "undefined" ? `${window.location.origin}/join/${group.invite_code}` : "";
  const pendingDays = group.next_cycle_length_days ?? group.cycle_length_days;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    QRCode.toString(link, { type: "svg", margin: 0, color: { dark: "#1c1917", light: "#0000" } })
      .then(setQr)
      .catch(() => {});
  }, [link]);

  async function copy() {
    if (navigator.share) {
      await navigator.share({ title: `Join ${group.name} on glimpse`, url: link }).catch(() => {});
      return;
    }
    // navigator.clipboard only exists on https/localhost; phones on the LAN demo use plain http.
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const input = document.createElement("textarea");
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function setDays(days: number) {
    await api(`/api/groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ nextCycleLengthDays: days }) });
    await refresh();
  }

  async function generateNow() {
    if (!view.current) return;
    setGenerating(true);
    setMsg(null);
    try {
      await api(`/api/cycles/${view.current.id}/finalize`, { method: "POST", body: "{}" });
      router.push(`/g/${group.id}`);
    } catch (err) {
      setMsg((err as Error).message);
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-4xl">{group.name}</h1>
      {isNew && <p className="text-muted">Your group is ready! Send the code to your friends 👇</p>}

      <Card>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Invite code</p>
        <p className="mt-2 font-mono text-5xl tracking-[0.25em]">{group.invite_code}</p>
        {qr && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <div
              className="size-44 rounded-2xl bg-white p-4 shadow-sm [&>svg]:size-full"
              aria-label="QR code for the invite link"
              dangerouslySetInnerHTML={{ __html: qr }}
            />
            <p className="text-xs text-muted">Scan to join</p>
          </div>
        )}
        <button onClick={copy} className="mt-4 h-12 w-full rounded-2xl bg-ink font-medium text-white">
          {copied ? "Link copied!" : "Share invite link"}
        </button>
      </Card>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Prompt length</p>
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <button
              key={d}
              disabled={!isCreator}
              onClick={() => setDays(d)}
              className={`h-11 rounded-xl text-sm font-medium transition disabled:opacity-60 ${pendingDays === d ? "bg-ink text-white" : "bg-white/70"}`}
            >
              {d}d
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          {isCreator ? "Changes apply starting next cycle." : "Only the group creator can change this."}
          {group.next_cycle_length_days && group.next_cycle_length_days !== group.cycle_length_days
            ? ` This cycle is ${group.cycle_length_days}d; next will be ${group.next_cycle_length_days}d.`
            : ""}
        </p>
      </Card>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{view.members.length} friends</p>
        <div className="mt-3 flex flex-col gap-3">
          {view.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar profile={m} size={36} />
              <span>{m.display_name}</span>
              {m.id === group.created_by && <span className="text-xs text-muted">creator</span>}
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-dashed">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Demo</p>
        <p className="mt-1 text-sm text-muted">End this cycle now and reveal the board. Takes ~20 seconds.</p>
        <button
          onClick={generateNow}
          disabled={generating || view.current?.status !== "active"}
          className="mt-3 h-12 w-full rounded-2xl border border-line bg-white/80 font-medium disabled:opacity-50"
        >
          {generating ? "Developing your board…" : "✨ Generate board now"}
        </button>
        {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      </Card>
    </div>
  );
}
