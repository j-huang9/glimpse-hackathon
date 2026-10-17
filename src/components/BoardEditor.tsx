/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { shareBoard } from "@/lib/share";
import { STICKERS, stickerById, type PlacedSticker } from "@/lib/stickers";

type Props = {
  cycleId: string;
  boardUrl: string;
  me: string;
  editable?: boolean;
  shareName?: string;
};

type Point = { x: number; y: number };
type Gesture =
  | { kind: "drag"; id: string; dx: number; dy: number }
  | { kind: "pinch"; id: string; dist: number; angle: number; scale: number; rotation: number };

const MIN_SCALE = 0.06;
const MAX_SCALE = 0.8;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** New stickers land near the middle with a little jitter and tilt, like they were slapped on. */
function randomPlacement(kind: "sticker" | "stamp") {
  return {
    x: 0.5 + (Math.random() - 0.5) * 0.3,
    y: 0.45 + (Math.random() - 0.5) * 0.3,
    scale: kind === "stamp" ? 0.34 : 0.2,
    rotation: Math.round((Math.random() - 0.5) * 24),
  };
}

function twoFingers(points: Map<number, Point>) {
  const [a, b] = [...points.values()];
  return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
}

/**
 * The revealed board with members' hand-drawn stickers on top.
 * Everyone sees every sticker; you can only move/resize/remove the ones you placed.
 * Gestures: drag to move; with a sticker selected, pinch to resize and twist to rotate.
 */
export function BoardEditor({ cycleId, boardUrl, me, editable = false, shareName }: Props) {
  const [stickers, setStickers] = useState<PlacedSticker[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const emptyTap = useRef(false);
  const pending = useRef(0);
  const latest = useRef(stickers);

  useEffect(() => {
    latest.current = stickers;
  }, [stickers]);

  const load = useCallback(async () => {
    if (gesture.current || pending.current > 0) return;
    try {
      const r = await api<{ stickers: PlacedSticker[] }>(`/api/cycles/${cycleId}/stickers`);
      if (!gesture.current && pending.current === 0) setStickers(r.stickers);
    } catch {
      /* keep what we have */
    }
  }, [cycleId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 6000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function save<T>(p: Promise<T>) {
    pending.current++;
    try {
      return await p;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      pending.current--;
    }
  }

  const update = (id: string, patch: Partial<PlacedSticker>, persist = true) => {
    setStickers((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    if (persist) save(api(`/api/stickers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }));
  };

  async function add(stickerId: string) {
    const def = stickerById(stickerId)!;
    const r = await save(
      api<{ sticker: PlacedSticker }>(`/api/cycles/${cycleId}/stickers`, {
        method: "POST",
        body: JSON.stringify({ stickerId, ...randomPlacement(def.kind) }),
      }),
    );
    if (r) {
      setStickers((list) => [...list, r.sticker]);
      setSelected(r.sticker.id);
    }
  }

  function remove(id: string) {
    setStickers((list) => list.filter((s) => s.id !== id));
    setSelected(null);
    save(api(`/api/stickers/${id}`, { method: "DELETE" }));
  }

  const mineById = (id: string | null | undefined) =>
    latest.current.find((s) => s.id === id && s.user_id === me) ?? null;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!editable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      const hit = (e.target as Element).closest<HTMLElement>("[data-sticker]")?.dataset.sticker;
      const s = mineById(hit);
      if (!s) {
        // Deselect on lift, not now — this may be the first finger of a pinch on the selected sticker.
        gesture.current = null;
        emptyTap.current = true;
        return;
      }
      const rect = boxRef.current!.getBoundingClientRect();
      gesture.current = {
        kind: "drag",
        id: s.id,
        dx: e.clientX - (rect.left + s.x * rect.width),
        dy: e.clientY - (rect.top + s.y * rect.height),
      };
      setSelected(s.id);
    } else if (pointers.current.size === 2) {
      emptyTap.current = false;
      const s = mineById(gesture.current?.id ?? selected);
      if (!s) return;
      gesture.current = { kind: "pinch", id: s.id, ...twoFingers(pointers.current), scale: s.scale, rotation: s.rotation };
      setSelected(s.id);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.kind === "drag") {
      const rect = boxRef.current!.getBoundingClientRect();
      update(
        g.id,
        {
          x: clamp((e.clientX - g.dx - rect.left) / rect.width, 0, 1),
          y: clamp((e.clientY - g.dy - rect.top) / rect.height, 0, 1),
        },
        false,
      );
    } else if (pointers.current.size >= 2) {
      const now = twoFingers(pointers.current);
      update(
        g.id,
        {
          scale: clamp((g.scale * now.dist) / Math.max(1, g.dist), MIN_SCALE, MAX_SCALE),
          rotation: Math.round(g.rotation + now.angle - g.angle),
        },
        false,
      );
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (emptyTap.current && pointers.current.size === 0) {
      emptyTap.current = false;
      setSelected(null);
    }
    const g = gesture.current;
    if (!g) return;
    // A pinch ends when either finger lifts; don't turn the remaining finger into a drag.
    gesture.current = null;
    const s = mineById(g.id);
    if (s) update(s.id, { x: s.x, y: s.y, scale: s.scale, rotation: s.rotation });
  }

  async function share() {
    setSharing(true);
    setError(null);
    try {
      await shareBoard(boardUrl, latest.current, shareName);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSharing(false);
    }
  }

  const sel = stickers.find((s) => s.id === selected && s.user_id === me);

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative w-full select-none overflow-hidden rounded-3xl shadow-2xl shadow-black/15 ${editable ? "touch-none" : ""}`}
        style={{ aspectRatio: "9 / 16" }}
      >
        <img src={boardUrl} alt="This cycle's moodboard" className="absolute inset-0 size-full" draggable={false} />
        {stickers.map((s) => {
          const def = stickerById(s.sticker_id);
          if (!def) return null;
          const mine = editable && s.user_id === me;
          return (
            <img
              key={s.id}
              data-sticker={s.id}
              src={def.src}
              alt={def.label}
              draggable={false}
              className={`absolute drop-shadow-[0_4px_6px_rgba(0,0,0,0.18)] ${mine ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"} ${
                selected === s.id && mine ? "rounded-lg outline-2 outline-offset-4 outline-dashed outline-white" : ""
              }`}
              style={{
                left: `${s.x * 100}%`,
                top: `${s.y * 100}%`,
                width: `${s.scale * 100}%`,
                transform: `translate(-50%, -50%) rotate(${s.rotation}deg)`,
              }}
            />
          );
        })}
      </div>

      {editable && (
        <>
          <div className={`flex items-center justify-center gap-2 transition ${sel ? "opacity-100" : "pointer-events-none opacity-30"}`}>
            <ToolButton label="Smaller" onClick={() => sel && update(sel.id, { scale: clamp(sel.scale * 0.85, MIN_SCALE, MAX_SCALE) })}>−</ToolButton>
            <ToolButton label="Bigger" onClick={() => sel && update(sel.id, { scale: clamp(sel.scale * 1.18, MIN_SCALE, MAX_SCALE) })}>+</ToolButton>
            <ToolButton label="Rotate left" onClick={() => sel && update(sel.id, { rotation: sel.rotation - 15 })}>↺</ToolButton>
            <ToolButton label="Rotate right" onClick={() => sel && update(sel.id, { rotation: sel.rotation + 15 })}>↻</ToolButton>
            <ToolButton label="Remove" onClick={() => sel && remove(sel.id)}>✕</ToolButton>
          </div>

          {(["sticker", "stamp"] as const).map((kind) => (
            <div key={kind}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                {kind === "sticker" ? "Stickers" : "Stamps"}
              </p>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {STICKERS.filter((s) => s.kind === kind).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => add(s.id)}
                    aria-label={`Add ${s.label}`}
                    className={`flex h-20 shrink-0 items-center justify-center rounded-2xl border border-line bg-white/80 p-2 transition active:scale-95 ${
                      kind === "stamp" ? "w-32" : "w-20"
                    }`}
                  >
                    <img src={s.src} alt="" className="max-h-full max-w-full" draggable={false} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-center text-xs text-muted">
            Tap to add · drag to move · pinch or twist to resize and rotate · friends see your stickers too
          </p>
        </>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button
        onClick={share}
        disabled={sharing}
        className="rounded-2xl bg-ink py-3.5 text-[16px] font-medium text-white shadow-lg shadow-black/10 transition active:scale-[0.98] disabled:opacity-60"
      >
        {sharing ? "Preparing…" : "Share board"}
      </button>
    </div>
  );
}

function ToolButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-11 items-center justify-center rounded-full border border-line bg-white/85 text-lg shadow-sm transition active:scale-90"
    >
      {children}
    </button>
  );
}
