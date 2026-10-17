"use client";

import { stickerById, type PlacedSticker } from "./stickers";

const W = 1080;
const H = 1920;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Flattens the board PNG + placed stickers into one 1080×1920 PNG. */
export async function composeBoard(boardUrl: string, stickers: PlacedSticker[]): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(await loadImage(boardUrl), 0, 0, W, H);

  for (const s of stickers) {
    const def = stickerById(s.sticker_id);
    if (!def) continue;
    const img = await loadImage(def.src);
    const w = s.scale * W;
    const h = w * def.aspect;
    ctx.save();
    ctx.translate(s.x * W, s.y * H);
    ctx.rotate((s.rotation * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), "image/png"),
  );
}

/** Native share sheet on phones (straight to IG stories / group chat), download elsewhere. */
export async function shareBoard(boardUrl: string, stickers: PlacedSticker[], name = "glimpse-board") {
  const blob = await composeBoard(boardUrl, stickers);
  const file = new File([blob], `${name}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Our glimpse" });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
