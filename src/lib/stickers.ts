/**
 * Sticker + stamp catalog for decorating boards.
 *
 * To add your own drawings: drop a transparent PNG (or SVG) into public/stickers/
 * and add a line here. `aspect` is height ÷ width of the image. Keep ids stable —
 * placed stickers reference them.
 */
export type StickerDef = { id: string; src: string; label: string; aspect: number; kind: "sticker" | "stamp" };

export const STICKERS: StickerDef[] = [
  { id: "heart", src: "/stickers/heart.svg", label: "Heart", aspect: 1, kind: "sticker" },
  { id: "star", src: "/stickers/star.svg", label: "Star", aspect: 1, kind: "sticker" },
  { id: "sparkle", src: "/stickers/sparkle.svg", label: "Sparkle", aspect: 1, kind: "sticker" },
  { id: "flower", src: "/stickers/flower.svg", label: "Flower", aspect: 1, kind: "sticker" },
  { id: "smiley", src: "/stickers/smiley.svg", label: "Smiley", aspect: 1, kind: "sticker" },
  { id: "stamp-miss-u", src: "/stickers/stamp-miss-u.svg", label: "Miss u", aspect: 160 / 300, kind: "stamp" },
  { id: "stamp-besties", src: "/stickers/stamp-besties.svg", label: "Besties", aspect: 160 / 300, kind: "stamp" },
  { id: "stamp-ten", src: "/stickers/stamp-ten.svg", label: "10/10", aspect: 160 / 300, kind: "stamp" },
  { id: "stamp-iconic", src: "/stickers/stamp-iconic.svg", label: "Iconic", aspect: 160 / 300, kind: "stamp" },
];

export const STICKER_IDS = new Set(STICKERS.map((s) => s.id));
export const stickerById = (id: string) => STICKERS.find((s) => s.id === id);

export type PlacedSticker = {
  id: string;
  cycle_id: string;
  user_id: string;
  sticker_id: string;
  x: number; // center, fraction of board width
  y: number; // center, fraction of board height
  scale: number; // sticker width as fraction of board width
  rotation: number; // degrees
  orientation: "portrait" | "landscape"; // stickers belong to one orientation of the board
};
