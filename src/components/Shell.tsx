"use client";

import Link from "next/link";
import { signInWithGoogle, useSession } from "@/lib/client";

/** Page frame: palette-tinted background blobs, mobile-width column, and a sign-in gate. */
export function Shell({
  children,
  style,
  requireAuth = true,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  requireAuth?: boolean;
}) {
  const session = useSession();
  return (
    <div style={style} className="min-h-dvh">
      <div className="blobs" />
      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-5">
        {!requireAuth ? children : session === undefined ? <Spinner /> : session ? children : <SignIn />}
      </main>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-muted">
      <div className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

function SignIn() {
  return (
    <div className="flex min-h-[80dvh] flex-col justify-center gap-8">
      <div>
        <Link href="/" className="font-serif text-3xl">glimpse</Link>
        <h1 className="mt-6 font-serif text-5xl leading-[1.02]">
          Stay close to the friends who <em>moved away.</em>
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-muted">
          One prompt each cycle. Everyone shares real photos, hidden until the end. Then your group gets a moodboard
          of what you were all up to.
        </p>
      </div>
      <button
        onClick={() => signInWithGoogle()}
        className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-ink text-[16px] font-medium text-white shadow-lg shadow-black/10 transition active:scale-[0.98]"
      >
        <GoogleIcon /> Continue with Google
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-line bg-card p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl ${className}`}>
      {children}
    </div>
  );
}
