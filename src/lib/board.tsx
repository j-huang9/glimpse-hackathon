import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

export const BOARD_W = 1080;
export const BOARD_H = 1920;

const PAD = 60;
const GAP = 14;
const TOP = 230;
const BOTTOM = 470;

type Tile = { x: number; y: number; w: number; h: number; index: number };

/**
 * Masonry: greedy-assign photos to the shortest column, then stretch each column
 * to fill the collage height exactly (photos are cover-cropped, so this only nudges aspect).
 */
export function masonry(aspects: number[], areaW: number, areaH: number): Tile[] {
  const n = aspects.length;
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 12 ? 3 : 4;
  const colW = (areaW - GAP * (cols - 1)) / cols;
  const columns: { index: number; h: number }[][] = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);

  aspects.forEach((a, index) => {
    const h = colW * Math.min(1.5, Math.max(0.75, a));
    const c = heights.indexOf(Math.min(...heights));
    columns[c].push({ index, h });
    heights[c] += h + GAP;
  });

  const tiles: Tile[] = [];
  columns.forEach((col, c) => {
    const available = areaH - GAP * (col.length - 1);
    const total = col.reduce((s, t) => s + t.h, 0);
    let y = 0;
    col.forEach((t, i) => {
      const h = i === col.length - 1 ? areaH - y : Math.round((t.h / total) * available);
      tiles.push({ x: Math.round(c * (colW + GAP)), y: Math.round(y), w: Math.round(colW), h: Math.round(h), index: t.index });
      y += h + GAP;
    });
  });
  return tiles;
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

let fontsPromise: Promise<{ serif: Buffer; inter500: Buffer; inter700: Buffer }> | null = null;
function loadFonts() {
  if (!fontsPromise) {
    const dir = path.join(process.cwd(), "assets/fonts");
    fontsPromise = Promise.all([
      readFile(path.join(dir, "instrument-serif-latin-400-normal.woff")),
      readFile(path.join(dir, "inter-latin-500-normal.woff")),
      readFile(path.join(dir, "inter-latin-700-normal.woff")),
    ]).then(([serif, inter500, inter700]) => ({ serif, inter500, inter700 }));
  }
  return fontsPromise;
}

export type BoardInput = {
  groupName: string;
  startsAt: string;
  endsAt: string;
  vibeLabel: string;
  palette: string[];
  photos: Buffer[]; // already EXIF-rotated JPEGs
  hiddenCount: number; // photos left out of the collage by sampling
};

export async function renderBoard(input: BoardInput): Promise<Buffer> {
  const { palette } = input;
  const fg = textColorFor(palette);
  const soft = fg === "#ffffff" ? "rgba(255,255,255,0.72)" : "rgba(28,25,23,0.62)";

  const areaW = BOARD_W - PAD * 2;
  const areaH = BOARD_H - TOP - BOTTOM;
  const aspects = await Promise.all(
    input.photos.map(async (buf) => {
      const m = await sharp(buf).metadata();
      return m.width && m.height ? m.height / m.width : 1;
    }),
  );
  const tiles = masonry(aspects, areaW, areaH);
  const tileImages = await Promise.all(
    tiles.map(async (t) => {
      const jpg = await sharp(input.photos[t.index])
        .resize(t.w, t.h, { fit: "cover", position: sharp.strategy.attention })
        .jpeg({ quality: 82 })
        .toBuffer();
      return `data:image/jpeg;base64,${jpg.toString("base64")}`;
    }),
  );

  const fonts = await loadFonts();
  const label = input.vibeLabel;
  const labelSize = label.length > 26 ? 84 : label.length > 16 ? 100 : 116;

  const response = new ImageResponse(
    (
      <div
        style={{
          width: BOARD_W,
          height: BOARD_H,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          backgroundImage: `linear-gradient(170deg, ${palette[0]} 0%, ${palette[1] ?? palette[0]} 100%)`,
          fontFamily: "Inter",
          color: fg,
        }}
      >
        {/* soft color blobs */}
        <div
          style={{
            position: "absolute",
            top: -220,
            right: -260,
            width: 760,
            height: 760,
            borderRadius: 9999,
            backgroundImage: `radial-gradient(circle, ${palette[2] ?? palette[0]}88 0%, ${palette[2] ?? palette[0]}00 70%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -260,
            left: -280,
            width: 820,
            height: 820,
            borderRadius: 9999,
            backgroundImage: `radial-gradient(circle, ${palette[3] ?? palette[1]}77 0%, ${palette[3] ?? palette[1]}00 70%)`,
          }}
        />

        {/* header */}
        <div
          style={{
            height: TOP,
            padding: `0 ${PAD}px`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, textTransform: "uppercase" }}>
            {input.groupName}
          </div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color: soft, marginTop: 10, letterSpacing: 3 }}>
            {formatRange(input.startsAt, input.endsAt)}
            {input.hiddenCount > 0 ? `  ·  +${input.hiddenCount} MORE` : ""}
          </div>
        </div>

        {/* collage */}
        <div style={{ position: "relative", display: "flex", marginLeft: PAD, width: areaW, height: areaH }}>
          {tiles.map((t, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={tileImages[i]}
              width={t.w}
              height={t.h}
              alt=""
              style={{
                position: "absolute",
                left: t.x,
                top: t.y,
                width: t.w,
                height: t.h,
                borderRadius: 24,
                objectFit: "cover",
                boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
              }}
            />
          ))}
        </div>

        {/* vibe + palette */}
        <div
          style={{
            height: BOTTOM,
            padding: `40px ${PAD}px 0`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 5, color: soft, textTransform: "uppercase" }}>
            This cycle&apos;s vibe
          </div>
          <div
            style={{
              fontFamily: "Instrument Serif",
              fontSize: labelSize,
              lineHeight: 1.0,
              marginTop: 14,
              letterSpacing: -1,
            }}
          >
            {label}
          </div>
          <div style={{ display: "flex", marginTop: "auto", marginBottom: 56, alignItems: "flex-end" }}>
            {palette.map((c) => (
              <div key={c} style={{ display: "flex", flexDirection: "column", alignItems: "center", marginRight: 28 }}>
                <div
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: 9999,
                    backgroundColor: c,
                    border: `4px solid ${fg === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.9)"}`,
                    boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
                  }}
                />
                <div style={{ fontSize: 18, fontWeight: 500, marginTop: 10, color: soft }}>{c.toUpperCase()}</div>
              </div>
            ))}
            <div style={{ marginLeft: "auto", fontFamily: "Instrument Serif", fontSize: 36, color: soft }}>glimpse</div>
          </div>
        </div>
      </div>
    ),
    {
      width: BOARD_W,
      height: BOARD_H,
      fonts: [
        { name: "Instrument Serif", data: fonts.serif, weight: 400, style: "normal" },
        { name: "Inter", data: fonts.inter500, weight: 500, style: "normal" },
        { name: "Inter", data: fonts.inter700, weight: 700, style: "normal" },
      ],
    },
  );
  return Buffer.from(await response.arrayBuffer());
}
