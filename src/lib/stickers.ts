/**
 * Sticker + stamp types. The catalog itself is whatever images are in public/stickers/
 * (see sticker-catalog.ts): drop in a transparent PNG and it shows up in the tray.
 * Order comes from public/stickers/order.json; "stamp…" files just get a larger default size.
 */
export type StickerDef = { id: string; src: string; label: string; aspect: number; kind: "sticker" | "stamp" };

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
