import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

/**
 * Scrapbook-style moodboard: handwritten vibe title, real photos scattered at angles in
 * mixed frames (polaroid, scalloped, double-line, taped), and ink doodles around them.
 * Rendered in portrait (1080×1920, stories) and landscape (1920×1080).
 */

export type Orientation = "portrait" | "landscape";

export const BOARD_SIZE: Record<Orientation, { w: number; h: number }> = {
  portrait: { w: 1080, h: 1920 },
  landscape: { w: 1920, h: 1080 },
};

type Box = { x: number; y: number; w: number; h: number };

const LAYOUT: Record<Orientation, { title: Box; photos: Box; footerY: number }> = {
  portrait: { title: { x: 70, y: 70, w: 860, h: 280 }, photos: { x: 60, y: 380, w: 960, h: 1320 }, footerY: 1745 },
  landscape: { title: { x: 80, y: 40, w: 1240, h: 170 }, photos: { x: 70, y: 235, w: 1780, h: 720 }, footerY: 975 },
};

type FrameStyle = "polaroid" | "scallop" | "double" | "taped";
const FRAME_ORDER: FrameStyle[] = ["polaroid", "double", "scallop", "taped", "double", "polaroid", "taped", "scallop"];

/** Deterministic randomness so a board (and both orientations) always lays out the same way. */
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

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

// ─── Layout ──────────────────────────────────────────────────────────────────

type Slot = { cx: number; cy: number; w: number; h: number; angle: number; style: FrameStyle; index: number };

/** Loose grid with jitter + alternating tilt, so photos overlap a little like a real scrapbook page. */
function scatter(aspects: number[], area: Box, rand: () => number): Slot[] {
  const n = aspects.length;
  let best = { c: 1, r: n, score: Infinity };
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const score = Math.abs(Math.log(area.w / c / (area.h / r) / 0.82)) + (c * r - n) * 0.12;
    if (score < best.score) best = { c, r, score };
  }
  const { c, r } = best;
  const cw = area.w / c;
  const ch = area.h / r;

  return aspects.map((rawAspect, i) => {
    const row = Math.floor(i / c);
    const col = i % c;
    const inRow = row === r - 1 ? n - c * (r - 1) : c;
    const a = Math.min(1.35, Math.max(0.72, rawAspect));
    // Frames add ~12% width and up to ~25% height; leave room for the tilt.
    const w = Math.min(cw * 0.8, (ch * 0.74) / a);
    return {
      cx: area.x + ((c - inRow) * cw) / 2 + (col + 0.5) * cw + (rand() - 0.5) * cw * 0.12,
      cy: area.y + (row + 0.5) * ch + (rand() - 0.5) * ch * 0.1,
      w: Math.round(w),
      h: Math.round(w * a),
      angle: (i % 2 ? 1 : -1) * (2 + rand() * 6),
      style: FRAME_ORDER[i % FRAME_ORDER.length],
      index: i,
    };
  });
}

// ─── Frames (composited with sharp, then rotated with a transparent background) ─────────────

async function framedTile(photo: Buffer, slot: Slot, ink: string, tape: string) {
  const { w, h, style } = slot;
  const stroke = Math.max(3, Math.round(w / 110));
  const m = style === "taped" ? 0 : Math.round(w * (style === "scallop" ? 0.1 : 0.065));
  const mb = style === "polaroid" ? Math.round(w * 0.2) : m;
  const W = w + m * 2;
  const H = h + m + mb;
  const pad = style === "taped" ? Math.round(w * 0.06) : stroke; // room for tape overhang / outline
  const CW = W + pad * 2;
  const CH = H + pad * 2;

  let back = "";
  let front = `<rect x="${pad + m}" y="${pad + m}" width="${w}" height="${h}" fill="none" stroke="${ink}" stroke-width="${Math.max(2, stroke - 1)}"/>`;

  if (style === "polaroid") {
    back = `<rect x="${pad}" y="${pad}" width="${W}" height="${H}" rx="${stroke * 2}" fill="#fffdf9" stroke="${ink}" stroke-width="${stroke}"/>`;
  } else if (style === "double") {
    const inset = Math.round(m * 0.45);
    back = `<rect x="${pad}" y="${pad}" width="${W}" height="${H}" fill="#fffdf9" stroke="${ink}" stroke-width="${stroke}"/>
      <rect x="${pad + inset}" y="${pad + inset}" width="${W - inset * 2}" height="${H - inset * 2}" fill="none" stroke="${ink}" stroke-width="${Math.max(2, stroke - 1)}"/>`;
  } else if (style === "scallop") {
    // Circles along the edge, outlined; a plain rect over their inner halves leaves a scalloped outline.
    const rad = m * 0.62;
    const circles: string[] = [];
    const along = (x1: number, y1: number, x2: number, y2: number) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const count = Math.max(2, Math.round(len / (rad * 1.7)));
      for (let k = 0; k < count; k++) {
        const t = k / count;
        circles.push(`<circle cx="${x1 + (x2 - x1) * t}" cy="${y1 + (y2 - y1) * t}" r="${rad}"/>`);
      }
    };
    const [x0, y0, x1, y1] = [pad + rad, pad + rad, pad + W - rad, pad + H - rad];
    along(x0, y0, x1, y0);
    along(x1, y0, x1, y1);
    along(x1, y1, x0, y1);
    along(x0, y1, x0, y0);
    back = `<g fill="#fffdf9" stroke="${ink}" stroke-width="${stroke}">${circles.join("")}</g>
      <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#fffdf9"/>`;
  } else {
    const tw = Math.round(w * 0.36);
    const th = Math.round(w * 0.11);
    front += `<rect x="${pad + w / 2 - tw / 2}" y="${pad - th / 2}" width="${tw}" height="${th}" fill="${tape}" fill-opacity="0.72" transform="rotate(-4 ${pad + w / 2} ${pad})"/>`;
  }

  const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}">${body}</svg>`);
  const img = await sharp(photo).resize(w, h, { fit: "cover", position: sharp.strategy.attention }).toBuffer();
  const flat = await sharp({ create: { width: CW, height: CH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      ...(back ? [{ input: svg(back) }] : []),
      { input: img, left: pad + m, top: pad + m },
      { input: svg(front) },
    ])
    .png()
    .toBuffer();
  const { data, info } = await sharp(flat)
    .rotate(slot.angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { src: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height, frameW: W, frameH: H };
}

// ─── Ink doodles ─────────────────────────────────────────────────────────────

type DoodleKind = "star" | "heart" | "smiley" | "bow" | "sparkle";

function doodle(kind: DoodleKind, ink: string) {
  const s = `fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;
  const body: Record<DoodleKind, string> = {
    star: `<path ${s} d="M52 6 L78 92 L6 40 L95 38 L22 94 L50 12"/>`,
    heart: `<path ${s} d="M50 88 C22 66 6 48 10 30 C14 12 40 10 48 32 C54 12 82 8 90 28 C96 48 78 66 52 86"/>`,
    smiley: `<path ${s} d="M50 6 C78 4 96 26 94 52 C92 80 70 96 46 94 C20 92 4 72 6 46 C8 22 26 8 54 8"/><path ${s} d="M30 44 L36 32 L42 44 M58 44 L64 32 L70 44"/><path ${s} d="M28 60 C38 78 64 80 74 60"/>`,
    bow: `<path ${s} d="M50 46 C36 26 10 20 10 40 C10 58 34 56 50 46 C66 56 90 58 90 40 C90 20 64 26 50 46 Z"/><path ${s} d="M48 50 L34 90 M52 50 L68 90"/>`,
    sparkle: `<path ${s} d="M50 6 C54 36 64 46 94 50 C64 54 54 64 50 94 C46 64 36 54 6 50 C36 46 46 36 50 6 Z"/>`,
  };
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${body[kind]}</svg>`).toString("base64")}`;
}

type Deco = { kind: DoodleKind; x: number; y: number; size: number; angle: number };

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
  groupName: string;
  startsAt: string;
  endsAt: string;
  vibeLabel: string;
  palette: string[];
  photos: Buffer[]; // already EXIF-rotated JPEGs
  hiddenCount: number; // photos left off the board by sampling
};

export async function renderBoard(input: BoardInput, orientation: Orientation = "portrait"): Promise<Buffer> {
  const { w: BW, h: BH } = BOARD_SIZE[orientation];
  const layout = LAYOUT[orientation];
  const { palette } = input;
  const ink = textColorFor(palette);
  const soft = ink === "#ffffff" ? "rgba(255,255,255,0.72)" : "rgba(28,25,23,0.6)";
  const tape = palette[2] ?? palette[1] ?? "#f6c9a8";
  const rand = seededRandom(`${input.seed}:${orientation}`);

  const aspects = await Promise.all(
    input.photos.map(async (buf) => {
      const meta = await sharp(buf).metadata();
      return meta.width && meta.height ? meta.height / meta.width : 1;
    }),
  );
  const slots = scatter(aspects, layout.photos, rand);
  const tiles = await Promise.all(slots.map((s) => framedTile(input.photos[s.index], s, ink, tape)));

  // Doodles: some pinned to photo corners (like the sketch), plus fixed accents around the page.
  const decos: Deco[] = [];
  slots.forEach((s, i) => {
    const t = tiles[i];
    const size = Math.round(Math.min(110, Math.max(60, s.w * 0.28)));
    if (i % 3 === 0) decos.push({ kind: "star", x: s.cx - t.frameW / 2 - size * 0.25, y: s.cy + t.frameH / 2 - size * 0.7, size, angle: -10 });
    else if (s.style === "scallop") decos.push({ kind: "bow", x: s.cx + t.frameW / 2 - size * 0.6, y: s.cy - t.frameH / 2 - size * 0.45, size, angle: 12 });
    else if (i % 3 === 1) decos.push({ kind: "heart", x: s.cx - t.frameW / 2 - size * 0.5, y: s.cy - t.frameH / 2 - size * 0.4, size: size * 0.7, angle: -14 });
  });
  const { footerY } = layout;
  if (orientation === "portrait") {
    decos.push({ kind: "heart", x: BW - 140, y: 70, size: 90, angle: 18 });
    decos.push({ kind: "sparkle", x: BW - 110, y: 190, size: 50, angle: 0 });
    decos.push({ kind: "smiley", x: BW - 200, y: footerY - 20, size: 120, angle: -6 });
  } else {
    decos.push({ kind: "heart", x: 1360, y: 50, size: 90, angle: 18 });
    decos.push({ kind: "smiley", x: BW - 190, y: footerY - 20, size: 100, angle: -6 });
    decos.push({ kind: "sparkle", x: 1480, y: 70, size: 60, angle: 0 });
  }

  const fonts = await loadFonts();
  const label = input.vibeLabel;
  const titleSize =
    orientation === "portrait" ? (label.length > 26 ? 96 : label.length > 13 ? 112 : 150) : label.length > 30 ? 96 : 116;

  const response = new ImageResponse(
    (
      <div
        style={{
          width: BW,
          height: BH,
          display: "flex",
          position: "relative",
          backgroundImage: `linear-gradient(${orientation === "portrait" ? 170 : 120}deg, ${palette[0]} 0%, ${palette[1] ?? palette[0]} 100%)`,
          fontFamily: "Inter",
          color: ink,
        }}
      >
        {/* title */}
        <div
          style={{
            position: "absolute",
            left: layout.title.x,
            top: layout.title.y,
            width: layout.title.w,
            height: layout.title.h,
            display: "flex",
            flexDirection: "column",
            justifyContent: orientation === "portrait" ? "flex-end" : "flex-start",
          }}
        >
          <div style={{ fontFamily: "Caveat", fontSize: titleSize, lineHeight: 0.95, letterSpacing: -1 }}>{label}</div>
          <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 4, color: soft, marginTop: 14 }}>
            {input.groupName.toUpperCase()}  ·  {formatRange(input.startsAt, input.endsAt)}
            {input.hiddenCount > 0 ? `  ·  +${input.hiddenCount} MORE` : ""}
          </div>
        </div>

        {/* photos */}
        {tiles.map((t, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={t.src}
            width={t.width}
            height={t.height}
            alt=""
            style={{ position: "absolute", left: Math.round(slots[i].cx - t.width / 2), top: Math.round(slots[i].cy - t.height / 2) }}
          />
        ))}

        {/* doodles */}
        {decos.map((d, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`d${i}`}
            src={doodle(d.kind, ink)}
            width={d.size}
            height={d.size}
            alt=""
            style={{ position: "absolute", left: Math.round(d.x), top: Math.round(d.y), transform: `rotate(${d.angle}deg)` }}
          />
        ))}

        {/* footer: palette dots, xoxo, brand */}
        <div
          style={{
            position: "absolute",
            left: layout.title.x,
            top: footerY,
            display: "flex",
            alignItems: "center",
          }}
        >
          {palette.map((c) => (
            <div
              key={c}
              style={{
                width: 54,
                height: 54,
                borderRadius: 9999,
                backgroundColor: c,
                border: `4px solid ${ink}`,
                marginRight: 14,
              }}
            />
          ))}
          <div style={{ fontFamily: "Caveat", fontSize: 76, marginLeft: 28, transform: "rotate(-6deg)" }}>xoxo</div>
        </div>
        <div
          style={{
            position: "absolute",
            ...(orientation === "portrait" ? { left: layout.title.x, bottom: 34 } : { right: 230, bottom: 34 }),
            fontFamily: "Instrument Serif",
            fontSize: 34,
            color: soft,
          }}
        >
          glimpse
        </div>
      </div>
    ),
    {
      width: BW,
      height: BH,
      fonts: [
        { name: "Caveat", data: fonts.hand, weight: 700, style: "normal" },
        { name: "Inter", data: fonts.inter500, weight: 500, style: "normal" },
        { name: "Inter", data: fonts.inter700, weight: 700, style: "normal" },
        { name: "Instrument Serif", data: fonts.serif, weight: 400, style: "normal" },
      ],
    },
  );
  return Buffer.from(await response.arrayBuffer());
}
