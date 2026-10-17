/* eslint-disable @next/next/no-img-element */
import type { Profile } from "@/lib/types";

export function Avatar({ profile, size = 40, dim = false }: { profile: Profile; size?: number; dim?: boolean }) {
  const name = profile.display_name ?? "?";
  return (
    <div
      title={name}
      style={{ width: size, height: size }}
      className={`relative shrink-0 overflow-hidden rounded-full border-2 border-white bg-stone-200 shadow-sm transition ${
        dim ? "opacity-45 grayscale" : "animate-pop"
      }`}
    >
      {profile.avatar_url ? (
        <img src={profile.avatar_url} alt={name} className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex size-full items-center justify-center text-sm font-semibold text-stone-600">
          {name[0]?.toUpperCase()}
        </div>
      )}
    </div>
  );
}
