"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type GroupLite = { id: string; name: string };

/** Top bar with a group switcher (native select = free mobile picker) and section links. */
export function GroupHeader({ groupId, active }: { groupId: string; active: "home" | "archive" | "settings" | "board" }) {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupLite[]>([]);
  useEffect(() => {
    api<{ groups: GroupLite[] }>("/api/me/groups").then((r) => setGroups(r.groups)).catch(() => {});
  }, []);

  const tab = (href: string, label: string, key: typeof active) => (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm transition ${active === key ? "bg-ink text-white" : "text-muted hover:text-ink"}`}
    >
      {label}
    </Link>
  );

  return (
    <header className="mb-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link href="/" className="font-serif text-2xl">glimpse</Link>
        <select
          value={groupId}
          onChange={(e) => (e.target.value === "+" ? router.push("/") : router.push(`/g/${e.target.value}`))}
          className="max-w-[60%] truncate rounded-full border border-line bg-white/70 px-3 py-1.5 text-sm font-medium backdrop-blur"
        >
          {groups.length === 0 && <option value={groupId}>Loading…</option>}
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
          <option value="+">+ New or join group</option>
        </select>
      </div>
      <nav className="flex gap-1">
        {tab(`/g/${groupId}`, "Now", "home")}
        {tab(`/g/${groupId}/archive`, "Scrapbook", "archive")}
        {tab(`/g/${groupId}/settings`, "Group", "settings")}
      </nav>
    </header>
  );
}
