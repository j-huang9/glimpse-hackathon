"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { GroupView } from "@/lib/types";

/** Group state, polled so avatars light up and reveals land without a refresh. */
export function useGroup(groupId: string, pollMs = 10_000) {
  const [view, setView] = useState<GroupView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await api<GroupView>(`/api/groups/${groupId}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [groupId]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, pollMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh, pollMs]);

  return { view, error, refresh };
}
