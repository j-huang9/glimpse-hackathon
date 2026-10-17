import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp, { type OverlayOptions } from "sharp";

/**
 * Scrappy, Pinterest-style moodboard.
 *
 * Layers (bottom → top), composited with sharp:
 *   1. cream paper with grain, faintly tinted by the palette
 *   2. real photos, overlapping, in mixed borders (instax / square polaroid / plain / torn) with drop shadows
 *   3. white paint-brush swipes and marker doodles (squiggle, scribble circle, hearts)
 *   4. washi tape and puffy stickers (buttons, metallic stars, heart buttons) with shadows
 *   5. text via satori on a transparent layer: taped title label, paint-chip palette card, "xoxo"
 * Rendered in portrait (1080×1920) and landscape (1920×1080).
 */

export type Orientation = "portrait" | "landscape";

/**
 * scrapbook — cream paper, instax/polaroid borders, tape, puffy buttons + metallic stars (cozy, daytime)
 * film      — edge-to-edge overlapping photos, white paint swipes, yellow marker doodles (night out, flash photos)
 */
export const THEMES = ["scrapbook", "film"] as const;
export type Theme = (typeof THEMES)[number];

export const BOARD_SIZE: Record<Orientation, { w: number; h: number }> = {
  portrait: { w: 1080, h: 1920 },
  landscape: { w: 1920, h: 1080 },
};

type Box = { x: number; y: number; w: number; h: number };

const LAYOUT: Record<Orientation, { photos: Box; title: { x: number; y: number; maxW: number }; chip: { right: number; bottom: number } }> = {
  portrait: { photos: { x: 20, y: 250, w: 1040, h: 1570 }, title: { x: 46, y: 64, maxW: 760 }, chip: { right: 54, bottom: 60 } },
  landscape: { photos: { x: 30, y: 150, w: 1860, h: 880 }, title: { x: 56, y: 40, maxW: 1320 }, chip: { right: 50, bottom: 46 } },
};

const PAPER = "#f5efe3";
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Deterministic randomness so a board (and each orientation) always renders the same. */
function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T,>(rand: Rand, list: readonly T[]) => list[Math.floor(rand() * list.length)];
const between = (rand: Rand, a: number, b: number) => a + rand() * (b - a);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

export function textColorFor(bg: string[]) {
  const avg = (luminance(bg[0]) + luminance(bg[1] ?? bg[0])) / 2;
  return avg > 0.35 ? "#1c1917" : "#ffffff";
}

function formatRange(start: string, end: string) {
  const f = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
  return `${f(start)} – ${f(end)}`;
}

const svgBuf = (w: number, h: number, body: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}">${body}</svg>`);

const roughFilter = (id: string, w: number, h: number, freq: number, scale: number, seed: number) =>
  `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`;

type Sprite = { buf: Buffer; w: number; h: number; ax: number; ay: number }; // ax/ay = anchor (visual center) inside buf

/** Adds a soft, offset drop shadow under a transparent PNG. Anchor stays on the original's center. */
async function withShadow(input: Buffer, { blur = 10, dx = 5, dy = 9, opacity = 0.32 } = {}): Promise<Sprite> {
  const pad = Math.ceil(blur * 2.5 + Math.max(dx, dy));
  const ext = await sharp(input)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: TRANSPARENT })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = ext.info;
  const silhouette = await sharp(ext.data)
    .composite([{ input: { create: { width, height, channels: 4, background: { r: 30, g: 18, b: 10, alpha: opacity } } }, blend: "in" }])
    .png()
    .toBuffer();
  // Separate passes: sharp always crops before extending within one pipeline.
  const blurred = await sharp(silhouette).blur(blur).extend({ top: dy, left: dx, background: TRANSPARENT }).png().toBuffer();
  const shadow = await sharp(blurred).extract({ left: 0, top: 0, width, height }).png().toBuffer();
  const buf = await sharp({ create: { width, height, channels: 4, background: TRANSPARENT } })
    .composite([{ input: shadow }, { input: ext.data }])
    .png()
    .toBuffer();
  return { buf, w: width, h: height, ax: width / 2, ay: height / 2 };
}

async function rotate(input: Buffer, angle: number) {
  return sharp(input).rotate(angle, { background: TRANSPARENT }).png().toBuffer();
}

/** Composite entry centered at (cx, cy), clipped to the canvas (sharp rejects overlays that spill off). */
async function place(sprite: Sprite, cx: number, cy: number, W: number, H: number): Promise<OverlayOptions | null> {
  const left = Math.round(cx - sprite.ax);
  const top = Math.round(cy - sprite.ay);
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(W, left + sprite.w);
  const y1 = Math.min(H, top + sprite.h);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  if (x0 === left && y0 === top && x1 - x0 === sprite.w && y1 - y0 === sprite.h) return { input: sprite.buf, left, top };
  const input = await sharp(sprite.buf)
    .extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 })
    .png()
    .toBuffer();
  return { input, left: x0, top: y0 };
}

// ─── Photos ──────────────────────────────────────────────────────────────────

type FrameStyle = "instax" | "square" | "plain" | "torn";
type Slot = { cx: number; cy: number; w: number; h: number; angle: number; style: FrameStyle; index: number };

/** Loose grid, oversized + jittered so neighbours overlap like a real collage. */
function layoutPhotos(aspects: number[], area: Box, rand: Rand, { film = false } = {}): Slot[] {
  const n = aspects.length;
  let best = { c: 1, r: n, score: Infinity };
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const score = Math.abs(Math.log(area.w / c / (area.h / r) / 0.85)) + (c * r - n) * 0.15;
    if (score < best.score) best = { c, r, score };
  }
  const { c, r } = best;
  const cw = area.w / c;
  const ch = area.h / r;
  const styles: FrameStyle[] = ["instax", "plain", "square", "instax", "torn", "plain", "square", "instax"];
  const offset = Math.floor(rand() * styles.length);

  return aspects.map((raw, i) => {
    const row = Math.floor(i / c);
    const col = i % c;
    const inRow = row === r - 1 ? n - c * (r - 1) : c;
    const style = film ? "plain" : styles[(i + offset) % styles.length];
    const a = style === "square" ? 1 : Math.min(1.3, Math.max(0.75, raw));
    const frameH = style === "instax" ? 1.22 : style === "square" ? 1.17 : style === "torn" ? 1.12 : 1;
    // Film photos are oversized so they overlap edge to edge with no paper showing.
    const w = film ? Math.max(cw * 1.16, (ch * 1.14) / a) : Math.min(cw * 1.02, (ch * 0.98) / (a * frameH));
    return {
      cx: area.x + ((c - inRow) * cw) / 2 + (col + 0.5) * cw + between(rand, -0.1, 0.1) * cw,
      cy: area.y + (row + 0.5) * ch + between(rand, -0.08, 0.08) * ch,
      w: Math.round(w),
      h: Math.round(w * a),
      angle: film ? (rand() < 0.4 ? 0 : between(rand, -2.5, 2.5)) : style === "plain" ? between(rand, -3, 3) : (i % 2 ? 1 : -1) * between(rand, 2.5, 8),
      style,
      index: i,
    };
  });
}

async function photoSprite(photo: Buffer, slot: Slot, seed: number, film = false): Promise<Sprite & { frameW: number; frameH: number }> {
  const { w, h, style } = slot;
  const side = style === "plain" ? 0 : Math.round(w * (style === "torn" ? 0.06 : 0.055));
  const bottom = style === "instax" ? Math.round(w * 0.2) : style === "square" ? Math.round(w * 0.15) : side;
  const W = w + side * 2;
  const H = h + side + bottom;
  const card = "#fbfaf5";

  const img = await sharp(photo)
    .resize(w, h, { fit: "cover", position: sharp.strategy.attention })
    .modulate({ saturation: film ? 1.08 : 1.04 })
    .linear(film ? 1.06 : 1, film ? -6 : 0) // a touch of flash-photo contrast
    .toBuffer();

  let back: Buffer | null = null;
  if (style === "instax" || style === "square") {
    back = svgBuf(W, H, `<rect width="${W}" height="${H}" rx="3" fill="${card}"/>`);
  } else if (style === "torn") {
    const p = 10; // torn edge wobbles outward; keep it inside the canvas
    back = svgBuf(W, H, `${roughFilter("t", W, H, 0.06, 14, seed)}<rect x="${p}" y="${p}" width="${W - 2 * p}" height="${H - 2 * p}" fill="${card}" filter="url(#t)"/>`);
  }

  const flat = await sharp({ create: { width: W, height: H, channels: 4, background: TRANSPARENT } })
    .composite([...(back ? [{ input: back }] : []), { input: img, left: side, top: side }])
    .png()
    .toBuffer();
  const sprite = await withShadow(
    await rotate(flat, slot.angle),
    film ? { blur: 16, dx: 4, dy: 10, opacity: 0.6 } : { blur: 12, dx: 6, dy: 11, opacity: 0.38 },
  );
  return { ...sprite, frameW: W, frameH: H };
}

// ─── Decorations ─────────────────────────────────────────────────────────────

const STAR_PATH = "M50 4 L62 36 L96 38 L69 59 L79 93 L50 73 L21 93 L31 59 L4 38 L38 36 Z";
const HEART_PATH = "M50 90 C18 68 4 50 8 30 C12 10 38 6 50 28 C62 6 88 10 92 30 C96 50 82 68 50 90 Z";

function shade(hex: string, amt: number) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)))));
  return `rgb(${r},${g},${b})`;
}

function starSvg(size: number, color: string) {
  return svgBuf(
    size,
    size,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(color, 0.55)}"/><stop offset=".5" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -0.35)}"/></linearGradient></defs>
     <g transform="scale(${size / 100})"><path d="${STAR_PATH}" fill="url(#g)" stroke="${shade(color, -0.3)}" stroke-width="2.5" stroke-linejoin="round"/>
     <path d="M30 40 L46 39 L50 22" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="4" stroke-linecap="round"/></g>`,
  );
}

function buttonSvg(size: number, kind: "red" | "gingham" | "stripe" | "flower" | "heart", seed: number) {
  const holes = (pts: [number, number][]) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5" fill="rgba(60,20,20,.55)"/>`).join("");
  const four = holes([[40, 40], [60, 40], [40, 60], [60, 60]]);
  const gloss = `<ellipse cx="36" cy="28" rx="16" ry="8" fill="#fff" fill-opacity=".45" transform="rotate(-25 36 28)"/>`;
  let body = "";
  if (kind === "red") {
    body = `<defs><radialGradient id="b" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ff6b6b"/><stop offset="1" stop-color="#b3141c"/></radialGradient></defs>
      <circle cx="50" cy="50" r="46" fill="url(#b)"/><circle cx="50" cy="50" r="34" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3"/>${four}${gloss}`;
  } else if (kind === "gingham") {
    body = `<defs><pattern id="p${seed}" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#e8f7e9"/><rect width="8" height="16" fill="#49b665" fill-opacity=".55"/><rect width="16" height="8" fill="#49b665" fill-opacity=".55"/></pattern></defs>
      <circle cx="50" cy="50" r="46" fill="url(#p${seed})" stroke="#2f8a49" stroke-width="3"/><circle cx="50" cy="50" r="34" fill="none" stroke="rgba(0,0,0,.15)" stroke-width="3"/>${four}${gloss}`;
  } else if (kind === "stripe") {
    const stripes = Array.from({ length: 12 }, (_, k) => `<path d="M50 50 L${50 + 60 * Math.cos((k * Math.PI) / 6)} ${50 + 60 * Math.sin((k * Math.PI) / 6)} L${50 + 60 * Math.cos(((k + 0.5) * Math.PI) / 6)} ${50 + 60 * Math.sin(((k + 0.5) * Math.PI) / 6)} Z" fill="#ef5b7a"/>`).join("");
    body = `<defs><clipPath id="c"><circle cx="50" cy="50" r="46"/></clipPath></defs><circle cx="50" cy="50" r="46" fill="#fff4f6"/>
      <g clip-path="url(#c)">${stripes}</g><circle cx="50" cy="50" r="24" fill="#fbe3e8" stroke="rgba(0,0,0,.12)" stroke-width="2"/>${four}${gloss}`;
  } else if (kind === "flower") {
    const petals = Array.from({ length: 5 }, (_, k) => {
      const a = (k * 2 * Math.PI) / 5 - Math.PI / 2;
      return `<circle cx="${50 + 26 * Math.cos(a)}" cy="${50 + 26 * Math.sin(a)}" r="22"/>`;
    }).join("");
    body = `<defs><radialGradient id="f" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffa8d4"/><stop offset="1" stop-color="#e2479a"/></radialGradient></defs>
      <g fill="url(#f)">${petals}<circle cx="50" cy="50" r="26"/></g>${four}${gloss}`;
  } else {
    body = `<defs><radialGradient id="h" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#ff5c5c"/><stop offset="1" stop-color="#b10f1a"/></radialGradient></defs>
      <path d="${HEART_PATH}" fill="url(#h)"/>${holes([[42, 46], [58, 46]])}<ellipse cx="30" cy="30" rx="12" ry="6" fill="#fff" fill-opacity=".45" transform="rotate(-35 30 30)"/>`;
  }
  return svgBuf(size, size, `<g transform="scale(${size / 100})">${body}</g>`);
}

function tapeSvg(w: number, h: number, color: string, pattern: "grid" | "dots" | "wave" | "plain", seed: number) {
  const teeth = (x: number, dir: number) =>
    Array.from({ length: 7 }, (_, k) => `${x + (k % 2 ? dir * 5 : 0)},${(k * h) / 6}`).join(" ");
  const pat =
    pattern === "grid"
      ? `<pattern id="p${seed}" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/></pattern>`
      : pattern === "dots"
        ? `<pattern id="p${seed}" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="2.6" fill="#fff" fill-opacity=".8"/></pattern>`
        : pattern === "wave"
          ? `<pattern id="p${seed}" width="24" height="${h}" patternUnits="userSpaceOnUse"><path d="M0 ${h / 2} q6 -7 12 0 t12 0" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="3"/></pattern>`
          : "";
  const shape = `<polygon points="${teeth(0, 1)} ${teeth(w, -1).split(" ").reverse().join(" ")}"`;
  return svgBuf(w, h, `<defs>${pat}</defs>${shape} fill="${color}" fill-opacity=".82"/>${pattern === "plain" ? "" : `${shape} fill="url(#p${seed})"/>`}`);
}

function squiggleSvg(w: number, color: string, seed: number) {
  const h = w * 0.55;
  const step = w / 7;
  const zig = Array.from({ length: 8 }, (_, k) => `${10 + k * step * 0.95},${k % 2 ? h * 0.2 : h * 0.55}`).join(" L");
  const zig2 = Array.from({ length: 8 }, (_, k) => `${10 + k * step * 0.95},${k % 2 ? h * 0.5 : h * 0.85}`).join(" L");
  return svgBuf(w, h, `${roughFilter("m", w, h, 0.03, 5, seed)}<g filter="url(#m)" fill="none" stroke="${color}" stroke-width="${w / 26}" stroke-linecap="round" stroke-linejoin="round"><path d="M${zig}"/><path d="M${zig2}"/></g>`);
}

function scribbleRingSvg(w: number, h: number, color: string, seed: number) {
  const rx = w / 2 - 14;
  const ry = h / 2 - 14;
  return svgBuf(w, h, `${roughFilter("m", w, h, 0.025, 6, seed)}<g filter="url(#m)" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round">
    <path d="M${w / 2 + rx * 0.2} ${h / 2 - ry} C${w / 2 + rx * 1.15} ${h / 2 - ry * 0.95} ${w / 2 + rx * 1.05} ${h / 2 + ry * 1.05} ${w / 2} ${h / 2 + ry * 0.98} C${w / 2 - rx * 1.1} ${h / 2 + ry * 0.95} ${w / 2 - rx * 1.05} ${h / 2 - ry * 1.02} ${w / 2 + rx * 0.05} ${h / 2 - ry * 0.92} C${w / 2 + rx * 0.5} ${h / 2 - ry * 0.9} ${w / 2 + rx * 0.7} ${h / 2 - ry * 0.85} ${w / 2 + rx * 0.85} ${h / 2 - ry * 0.7}"/></g>`);
}

function markerHeartsSvg(size: number, color: string, seed: number) {
  const heart = (x: number, y: number, s: number, r: number) =>
    `<path transform="translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-50 -50)" d="M50 88 C22 66 6 48 10 30 C14 12 40 10 48 32 C54 12 82 8 90 28 C96 48 78 66 52 86"/>`;
  return svgBuf(size, size * 1.3, `${roughFilter("m", size, size * 1.3, 0.03, 4, seed)}<g filter="url(#m)" fill="none" stroke="${color}" stroke-width="${size / 18}" stroke-linecap="round" stroke-linejoin="round">
    ${heart(size * 0.38, size * 0.32, size / 190, -14)}${heart(size * 0.7, size * 0.72, size / 280, 12)}${heart(size * 0.32, size * 1.05, size / 240, -6)}</g>`);
}

function brushSvg(w: number, h: number, seed: number) {
  return svgBuf(w, h, `${roughFilter("b", w, h, 0.08, h / 5, seed)}<g filter="url(#b)" fill="none" stroke="#fffdf8" stroke-linecap="round">
    <path d="M${h * 0.6} ${h * 0.55} C${w * 0.3} ${h * 0.3} ${w * 0.65} ${h * 0.75} ${w - h * 0.6} ${h * 0.45}" stroke-width="${h * 0.42}" stroke-opacity=".95"/>
    <path d="M${h * 0.8} ${h * 0.3} C${w * 0.35} ${h * 0.15} ${w * 0.6} ${h * 0.45} ${w - h} ${h * 0.25}" stroke-width="${h * 0.1}" stroke-opacity=".75"/></g>`);
}

/** A patch of overlapping white paint strokes, big enough to write a multi-line title on. */
function brushPatchSvg(w: number, h: number, seed: number) {
  const rows = Math.max(2, Math.round(h / 90));
  const strokes = Array.from({ length: rows }, (_, k) => {
    const y = h * (0.18 + (0.64 * k) / (rows - 1));
    const inset = (k % 2 ? 0.06 : 0.02) * w;
    return `<path d="M${inset + 40} ${y + 6} C${w * 0.35} ${y - 14} ${w * 0.6} ${y + 16} ${w - inset - 40} ${y - 4}" stroke-width="${(h / rows) * 1.25}"/>`;
  }).join("");
  return svgBuf(w, h, `${roughFilter("b", w, h, 0.07, 22, seed)}<g filter="url(#b)" fill="none" stroke="#fffdf8" stroke-linecap="round" stroke-opacity=".96">${strokes}</g>`);
}

function markerSmileySvg(size: number, color: string, seed: number) {
  return svgBuf(size, size, `${roughFilter("m", size, size, 0.03, 5, seed)}<g filter="url(#m)" fill="none" stroke="${color}" stroke-width="${size / 14}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${size * 0.52} ${size * 0.08} C${size * 0.85} ${size * 0.06} ${size * 0.95} ${size * 0.35} ${size * 0.93} ${size * 0.55} C${size * 0.9} ${size * 0.85} ${size * 0.6} ${size * 0.95} ${size * 0.42} ${size * 0.92} C${size * 0.15} ${size * 0.88} ${size * 0.05} ${size * 0.6} ${size * 0.08} ${size * 0.42} C${size * 0.12} ${size * 0.2} ${size * 0.3} ${size * 0.08} ${size * 0.58} ${size * 0.12}"/>
    <circle cx="${size * 0.36}" cy="${size * 0.4}" r="${size * 0.02}"/><circle cx="${size * 0.64}" cy="${size * 0.4}" r="${size * 0.02}"/>
    <path d="M${size * 0.3} ${size * 0.6} C${size * 0.4} ${size * 0.76} ${size * 0.62} ${size * 0.76} ${size * 0.7} ${size * 0.58}"/></g>`);
}

function markerWaveSvg(w: number, color: string, seed: number) {
  const h = w * 0.3;
  const waves = Array.from({ length: 5 }, (_, k) => `q${w / 20} ${k % 2 ? h * 0.5 : -h * 0.5} ${w / 10} 0 t${w / 10} 0`).join(" ");
  return svgBuf(w, h, `${roughFilter("m", w, h, 0.03, 5, seed)}<path filter="url(#m)" d="M${w * 0.02} ${h / 2} ${waves}" fill="none" stroke="${color}" stroke-width="${w / 30}" stroke-linecap="round"/>`);
}

async function sprite(svg: Buffer, angle = 0, shadow = true): Promise<Sprite> {
  const png = await sharp(svg).png().toBuffer();
  const rotated = angle ? await rotate(png, angle) : png;
  if (shadow) return withShadow(rotated, { blur: 5, dx: 3, dy: 5, opacity: 0.35 });
  const meta = await sharp(rotated).metadata();
  return { buf: rotated, w: meta.width!, h: meta.height!, ax: meta.width! / 2, ay: meta.height! / 2 };
}

// ─── Fonts ───────────────────────────────────────────────────────────────────

let fontsPromise: Promise<{ hand: Buffer; inter500: Buffer; inter700: Buffer; serif: Buffer }> | null = null;
function loadFonts() {
  if (!fontsPromise) {
    const dir = path.join(process.cwd(), "assets/fonts");
    fontsPromise = Promise.all(
      ["caveat-latin-700-normal.woff", "inter-latin-500-normal.woff", "inter-latin-700-normal.woff", "instrument-serif-latin-400-normal.woff"].map(
        (f) => readFile(path.join(dir, f)),
      ),
    ).then(([hand, inter500, inter700, serif]) => ({ hand, inter500, inter700, serif }));
  }
  return fontsPromise;
}

// ─── Render ──────────────────────────────────────────────────────────────────

export type BoardInput = {
  seed: string; // cycle id — keeps layout stable across re-renders
  theme?: Theme;
  groupName: string;
  startsAt: string;
  endsAt: string;
  vibeLabel: string;
  palette: string[];
  photos: Buffer[]; // already EXIF-rotated JPEGs
  hiddenCount: number; // photos left off the board by sampling
};

export function renderBoard(input: BoardInput, orientation: Orientation = "portrait"): Promise<Buffer> {
  return input.theme === "film" ? renderFilm(input, orientation) : renderScrapbook(input, orientation);
}

async function renderScrapbook(input: BoardInput, orientation: Orientation): Promise<Buffer> {
  const { w: W, h: H } = BOARD_SIZE[orientation];
  const layout = LAYOUT[orientation];
  const portrait = orientation === "portrait";
  const rand = seededRandom(`${input.seed}:${orientation}`);
  const seedNum = () => Math.floor(rand() * 1000);
  const { palette } = input;

  const vivid = [...palette].sort((a, b) => saturation(b) - saturation(a))[0];
  const marker = saturation(vivid) > 0.35 && luminance(vivid) > 0.18 ? vivid : "#f4cb3a";
  const tapeColors = [palette[2] ?? "#e8998d", palette[3] ?? "#a26769", "#f4a7b9", "#9ec5e8", "#f6d36b"];

  // 1. paper
  const paper = svgBuf(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/><rect width="${W}" height="${H}" fill="${palette[0]}" fill-opacity=".35"/>
     <filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .28  0 0 0 0 .2  0 0 0 .09 0"/></filter>
     <rect width="${W}" height="${H}" filter="url(#n)"/>`,
  );
  const layers: (OverlayOptions | null)[] = [];

  // 2. photos (drawn in a shuffled order so overlaps vary)
  const aspects = await Promise.all(
    input.photos.map(async (buf) => {
      const meta = await sharp(buf).metadata();
      return meta.width && meta.height ? meta.height / meta.width : 1;
    }),
  );
  const slots = layoutPhotos(aspects, layout.photos, rand);
  const photos = await Promise.all(slots.map((s) => photoSprite(input.photos[s.index], s, seedNum())));
  const order = slots.map((_, i) => i).sort(() => rand() - 0.5);
  for (const i of order) layers.push(await place(photos[i], slots[i].cx, slots[i].cy, W, H));

  // 3. paint + marker
  const corner = (i: number, cxSign: number, cySign: number, inset = 0.42) => ({
    x: slots[i].cx + cxSign * photos[i].frameW * inset,
    y: slots[i].cy + cySign * photos[i].frameH * inset,
  });
  const n = slots.length;
  if (n >= 2) {
    const a = slots[Math.floor(rand() * n)];
    const bw = Math.min(W * 0.7, a.w * 1.6);
    layers.push(await place(await sprite(brushSvg(bw, bw * 0.22, seedNum()), between(rand, -12, 12), false), a.cx, a.cy + a.h * 0.55, W, H));
  }
  if (n >= 4) {
    const b = slots[Math.floor(rand() * n)];
    const bw = Math.min(W * 0.55, b.w * 1.3);
    layers.push(await place(await sprite(brushSvg(bw, bw * 0.2, seedNum()), between(rand, -20, 20), false), b.cx - b.w * 0.3, b.cy - b.h * 0.45, W, H));
  }
  const ringTarget = Math.floor(rand() * n);
  {
    const p = photos[ringTarget];
    const ring = await sprite(scribbleRingSvg(p.frameW * 1.18, p.frameH * 1.12, marker, seedNum()), slots[ringTarget].angle, false);
    layers.push(await place(ring, slots[ringTarget].cx, slots[ringTarget].cy, W, H));
  }
  layers.push(await place(await sprite(squiggleSvg(portrait ? 230 : 260, marker, seedNum()), -8, false), W - (portrait ? 150 : 170), portrait ? 120 : 95, W, H));
  {
    const target = (ringTarget + 1 + Math.floor(rand() * Math.max(1, n - 1))) % n;
    const c = corner(target, -1, 1, 0.5);
    layers.push(await place(await sprite(markerHeartsSvg(150, marker, seedNum()), 0, false), c.x, c.y, W, H));
  }

  // 4. tape + puffy stickers, pinned to photo corners/edges
  for (let i = 0; i < n; i++) {
    if (rand() > 0.45) continue;
    const s = slots[i];
    const tw = Math.round(between(rand, 150, 210));
    const tape = await sprite(tapeSvg(tw, Math.round(tw * 0.28), pick(rand, tapeColors), pick(rand, ["grid", "dots", "wave", "plain"] as const), seedNum()), 0, false);
    if (rand() < 0.5) {
      const rotated = await sprite(tapeSvg(tw, Math.round(tw * 0.28), pick(rand, tapeColors), pick(rand, ["grid", "dots", "wave"] as const), seedNum()), s.angle + between(rand, -6, 6), false);
      layers.push(await place(rotated, s.cx + between(rand, -0.15, 0.15) * s.w, s.cy - photos[i].frameH * 0.48, W, H));
    } else {
      const sign = rand() < 0.5 ? -1 : 1;
      const c = corner(i, sign, -1, 0.46);
      const diag = await sprite(await sharp(tape.buf).png().toBuffer(), sign * -40 + s.angle, false);
      layers.push(await place(diag, c.x, c.y, W, H));
    }
  }

  const stickerCount = Math.min(14, Math.max(5, Math.round(n * 0.7) + 3));
  const kinds = ["star", "button", "star", "heart", "button", "star", "flower"] as const;
  const starColors = ["#e7c35a", "#c3cbd4", "#3b82f6", "#ff5fa8", "#f5d76e"];
  const buttonKinds = ["red", "gingham", "stripe"] as const;
  for (let k = 0; k < stickerCount; k++) {
    const kind = kinds[k % kinds.length];
    const size = Math.round(kind === "star" ? between(rand, 70, 120) : between(rand, 75, 105));
    const svg =
      kind === "star"
        ? starSvg(size, pick(rand, starColors))
        : kind === "button"
          ? buttonSvg(size, pick(rand, buttonKinds), seedNum())
          : buttonSvg(size, kind === "heart" ? "heart" : "flower", seedNum());
    const i = Math.floor(rand() * n);
    const c = corner(i, rand() < 0.5 ? -1 : 1, rand() < 0.5 ? -1 : 1, between(rand, 0.4, 0.52));
    layers.push(await place(await sprite(svg, between(rand, -25, 25)), c.x, c.y, W, H));
  }

  // 5. text layer (satori, transparent background)
  const fonts = await loadFonts();
  const label = input.vibeLabel;
  const titleSize = portrait ? (label.length > 22 ? 84 : label.length > 14 ? 100 : 124) : label.length > 30 ? 88 : 104;
  const ink = "#1c1917";
  // satori only wraps text inside a fixed width, so size the label from an estimate of the title's width.
  const subtitle = `${input.groupName.toUpperCase()}  ·  ${formatRange(input.startsAt, input.endsAt)}${input.hiddenCount > 0 ? `  ·  +${input.hiddenCount} MORE` : ""}`;
  const labelW = Math.round(
    Math.min(layout.title.maxW, Math.max(label.length * titleSize * 0.43, subtitle.length * 12.5) + 68),
  );

  const textLayer = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: layout.title.x,
            top: layout.title.y,
            width: labelW,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#fffdf7",
            padding: "16px 34px 18px",
            transform: "rotate(-2deg)",
            boxShadow: "0 12px 28px rgba(40,20,10,0.28)",
            color: ink,
          }}
        >
          <div style={{ fontFamily: "Caveat", fontSize: titleSize, lineHeight: 0.95 }}>{label}</div>
          <div style={{ display: "flex", fontSize: 19, fontWeight: 700, letterSpacing: 4, color: "rgba(28,25,23,0.55)", marginTop: 10 }}>
            {subtitle}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: layout.chip.right,
            bottom: layout.chip.bottom,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#ffffff",
            padding: "12px 12px 10px",
            transform: "rotate(3.5deg)",
            boxShadow: "0 10px 24px rgba(40,20,10,0.3)",
          }}
        >
          {palette.map((c) => (
            <div key={c} style={{ display: "flex", alignItems: "center", height: 40, marginBottom: 4 }}>
              <div style={{ width: 120, height: 40, backgroundColor: c }} />
              <div style={{ fontSize: 14, fontWeight: 500, color: "#57534e", marginLeft: 10, width: 70 }}>{c.toUpperCase()}</div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 3, color: "#78716c" }}>PALETTE</div>
            <div style={{ fontFamily: "Instrument Serif", fontSize: 24, color: ink }}>glimpse</div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            left: portrait ? 70 : 90,
            bottom: portrait ? 70 : 50,
            fontFamily: "Caveat",
            fontSize: portrait ? 104 : 92,
            color: marker,
            transform: "rotate(-8deg)",
            textShadow: "0 0 10px #fffdf7, 0 0 4px #fffdf7",
          }}
        >
          xoxo
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Caveat", data: fonts.hand, weight: 700, style: "normal" },
        { name: "Inter", data: fonts.inter500, weight: 500, style: "normal" },
        { name: "Inter", data: fonts.inter700, weight: 700, style: "normal" },
        { name: "Instrument Serif", data: fonts.serif, weight: 400, style: "normal" },
      ],
    },
  );
  layers.push({ input: Buffer.from(await textLayer.arrayBuffer()), left: 0, top: 0 });

  // tape holding the title label + palette card (on top of the text layer)
  const labelTape = await sprite(tapeSvg(170, 46, pick(rand, tapeColors), "grid", seedNum()), -38, false);
  layers.push(await place(labelTape, layout.title.x + 20, layout.title.y + 8, W, H));
  const chipTop = H - layout.chip.bottom - (22 + palette.length * 44 + 34);
  const chipTape = await sprite(tapeSvg(150, 42, pick(rand, tapeColors), "dots", seedNum()), 8, false);
  layers.push(await place(chipTape, W - layout.chip.right - 112, chipTop + 4, W, H));

  return sharp(paper)
    .composite(layers.filter((l): l is OverlayOptions => l !== null))
    .png()
    .toBuffer();
}

// ─── Film theme ──────────────────────────────────────────────────────────────

const FILM_YELLOW = "#f5d547";

async function renderFilm(input: BoardInput, orientation: Orientation): Promise<Buffer> {
  const { w: W, h: H } = BOARD_SIZE[orientation];
  const portrait = orientation === "portrait";
  const rand = seededRandom(`${input.seed}:${orientation}:film`);
  const seedNum = () => Math.floor(rand() * 1000);
  const { palette } = input;
  const layers: (OverlayOptions | null)[] = [];

  // Photos cover the whole page (bleeding off the edges); a dark base shows only in gaps.
  const base = svgBuf(W, H, `<rect width="${W}" height="${H}" fill="#141210"/>`);
  const aspects = await Promise.all(
    input.photos.map(async (buf) => {
      const meta = await sharp(buf).metadata();
      return meta.width && meta.height ? meta.height / meta.width : 1;
    }),
  );
  const area = { x: -30, y: -30, w: W + 60, h: H + 60 };
  const slots = layoutPhotos(aspects, area, rand, { film: true });
  const photos = await Promise.all(slots.map((s) => photoSprite(input.photos[s.index], s, seedNum(), true)));
  const order = slots.map((_, i) => i).sort(() => rand() - 0.5);
  for (const i of order) layers.push(await place(photos[i], slots[i].cx, slots[i].cy, W, H));
  const n = slots.length;

  // White paint swipes across seams.
  const swipes = Math.min(4, Math.max(2, Math.round(n / 3)));
  for (let k = 0; k < swipes; k++) {
    const s = slots[Math.floor(rand() * n)];
    const bw = Math.min(W * 0.75, Math.max(260, s.w * between(rand, 0.9, 1.4)));
    const y = s.cy + (rand() < 0.5 ? -1 : 1) * s.h * 0.5;
    layers.push(await place(await sprite(brushSvg(bw, bw * 0.2, seedNum()), between(rand, -18, 18), false), s.cx, y, W, H));
  }

  // Yellow marker doodles.
  const ringTarget = Math.floor(rand() * n);
  {
    const p = photos[ringTarget];
    const ring = await sprite(scribbleRingSvg(p.frameW * 0.92, p.frameH * 0.85, FILM_YELLOW, seedNum()), between(rand, -8, 8), false);
    layers.push(await place(ring, slots[ringTarget].cx, slots[ringTarget].cy, W, H));
  }
  layers.push(await place(await sprite(squiggleSvg(portrait ? 260 : 280, FILM_YELLOW, seedNum()), -12, false), portrait ? 150 : W - 200, portrait ? H * 0.42 : 110, W, H));
  layers.push(await place(await sprite(markerHeartsSvg(170, FILM_YELLOW, seedNum()), 0, false), portrait ? 110 : 140, portrait ? H * 0.66 : H * 0.62, W, H));
  layers.push(await place(await sprite(markerSmileySvg(150, FILM_YELLOW, seedNum()), 10, false), W - 130, portrait ? H - 330 : H - 260, W, H));
  layers.push(await place(await sprite(markerWaveSvg(portrait ? 420 : 520, FILM_YELLOW, seedNum()), between(rand, -6, 6), false), W * 0.55, portrait ? H * 0.36 : H * 0.5, W, H));

  // Title + subtitle written in black marker on a big white swipe.
  const fonts = await loadFonts();
  const label = input.vibeLabel;
  const titleSize = portrait ? (label.length > 22 ? 92 : label.length > 14 ? 110 : 132) : label.length > 30 ? 92 : 112;
  const maxW = portrait ? 860 : 1200;
  const estW = label.length * titleSize * 0.43;
  const lines = Math.max(1, Math.ceil(estW / (maxW - 60) - 0.1)); // estimate runs ~10% wide
  const textW = Math.round(Math.min(maxW - 80, estW));
  const subtitle = `${input.groupName.toUpperCase()}  ·  ${formatRange(input.startsAt, input.endsAt)}${input.hiddenCount > 0 ? `  ·  +${input.hiddenCount} MORE` : ""}`;
  const titleX = portrait ? 70 : 80;
  const titleY = portrait ? 90 : 60;
  const blockH = lines * titleSize * 0.95 + 44;
  const swipe = await sprite(brushPatchSvg(textW + 170, blockH + 70, seedNum()), -3, false);
  layers.push(await place(swipe, titleX + textW / 2 + 10, titleY + blockH / 2 + 4, W, H));

  // Palette as marker dots on a small swipe in the bottom corner.
  const footW = 580;
  layers.push(await place(await sprite(brushSvg(footW, 170, seedNum()), 4, false), portrait ? footW / 2 + 30 : footW / 2 + 40, H - (portrait ? 122 : 102), W, H));

  const textLayer = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: titleX,
            top: titleY,
            width: textW + 20,
            display: "flex",
            flexDirection: "column",
            transform: "rotate(-3deg)",
            color: "#141210",
          }}
        >
          <div style={{ fontFamily: "Caveat", fontSize: titleSize, lineHeight: 0.95 }}>{label}</div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 700, letterSpacing: 4, color: "rgba(20,18,16,0.6)", marginTop: 8 }}>{subtitle}</div>
        </div>
        <div
          style={{
            position: "absolute",
            left: portrait ? 78 : 88,
            top: H - (portrait ? 150 : 130),
            display: "flex",
            alignItems: "center",
            transform: "rotate(4deg)",
          }}
        >
          {palette.map((c) => (
            <div key={c} style={{ width: 44, height: 44, borderRadius: 9999, backgroundColor: c, border: "4px solid #141210", marginRight: 10 }} />
          ))}
          <div style={{ fontFamily: "Instrument Serif", fontSize: 32, color: "#141210", marginLeft: 12 }}>glimpse</div>
        </div>
        <div
          style={{
            position: "absolute",
            right: portrait ? 90 : 640,
            top: portrait ? H * 0.2 : 760,
            fontFamily: "Caveat",
            fontSize: portrait ? 110 : 96,
            color: FILM_YELLOW,
            transform: "rotate(-10deg)",
            textShadow: "0 2px 8px rgba(0,0,0,0.45)",
          }}
        >
          hi!
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Caveat", data: fonts.hand, weight: 700, style: "normal" },
        { name: "Inter", data: fonts.inter700, weight: 700, style: "normal" },
        { name: "Instrument Serif", data: fonts.serif, weight: 400, style: "normal" },
      ],
    },
  );
  layers.push({ input: Buffer.from(await textLayer.arrayBuffer()), left: 0, top: 0 });

  return sharp(base)
    .composite(layers.filter((l): l is OverlayOptions => l !== null))
    .png()
    .toBuffer();
}
