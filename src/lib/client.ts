"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { IS_DEMO } from "./demo-flag";
import { supabaseBrowser } from "./supabase-browser";

export type DemoUser = { id: string; display_name: string; avatar_url: string | null };
const DEMO_USER_KEY = "glimpse:demo-user";
const DEMO_EVENT = "glimpse:demo-user-changed";

export function getDemoUser(): DemoUser | null {
  try {
    return JSON.parse(localStorage.getItem(DEMO_USER_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function setDemoUser(user: DemoUser | null) {
  try {
    if (user) localStorage.setItem(DEMO_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(DEMO_USER_KEY);
  } catch {}
  window.dispatchEvent(new Event(DEMO_EVENT));
}

function demoSession(u: DemoUser | null): Session | null {
  if (!u) return null;
  return {
    access_token: u.id,
    user: { id: u.id, user_metadata: { full_name: u.display_name, avatar_url: u.avatar_url } },
  } as unknown as Session;
}

/** undefined = still loading, null = signed out */
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (IS_DEMO) {
      const sync = () => setSession(demoSession(getDemoUser()));
      const first = setTimeout(sync, 0);
      window.addEventListener(DEMO_EVENT, sync);
      return () => {
        clearTimeout(first);
        window.removeEventListener(DEMO_EVENT, sync);
      };
    }
    const sb = supabaseBrowser();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export function signInWithGoogle() {
  return supabaseBrowser().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href },
  });
}

export function signOut() {
  if (IS_DEMO) setDemoUser(null);
  else supabaseBrowser().auth.signOut();
}

async function accessToken() {
  if (IS_DEMO) return getDemoUser()?.id ?? null;
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers });
  // Demo data was reset and this friend no longer exists: back to "Who are you?".
  if (res.status === 401 && IS_DEMO && token) setDemoUser(null);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

/** Downscale on-device so phone photos (3–8 MB) upload fast. Falls back to the original file. */
export async function shrinkImage(file: File, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * s);
    canvas.height = Math.round(bmp.height * s);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Sets the page's accent + background blobs from a board palette (light → dark). */
export function paletteVars(palette: string[] | null | undefined): React.CSSProperties {
  if (!palette?.length) return {};
  return {
    "--bg-from": palette[1] ?? palette[0],
    "--bg-to": palette[2] ?? palette[0],
    "--accent": palette[3] ?? palette[palette.length - 1],
  } as React.CSSProperties;
}

export function formatRange(start: string, end: string) {
  const f = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${f(start)} – ${f(end)}`;
}
