import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-5-5";

let client: Anthropic | null = null;
function anthropic() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const FALLBACK_PROMPTS = [
  "the best thing you ate this week",
  "your view right now",
  "something you own that's older than you",
  "the most chaotic thing in your fridge",
  "a sky that made you stop walking",
  "your current comfort item",
  "something that made you think of us",
  "the last thing that made you laugh",
  "your desk, exactly as it is",
  "a corner of your home you love",
  "your go-to drink order, in the wild",
  "the shoes you've worn the most lately",
  "something small that made today better",
  "a sign or poster that caught your eye",
  "what's on your nightstand",
  "your favorite mug and what's in it",
  "a plant you've kept alive (or tried to)",
  "the most you thing in your bag",
  "your walk home, one frame",
  "something golden",
];

/** Used when there's no API key (demo mode) or the model fails. */
const FALLBACK_LABELS = [
  "Main Character Golden Hour",
  "Soft Chaos Picnic Era",
  "Cozy Cottagecore Brunch Club",
  "Sunday Reset Energy",
  "Postcard From Everywhere",
  "Little Treat Culture",
  "Slow Morning Society",
  "Windows Down Summer",
];

export function fallbackVibeLabel() {
  return FALLBACK_LABELS[Math.floor(Math.random() * FALLBACK_LABELS.length)];
}

const hasKey = () => !!process.env.ANTHROPIC_API_KEY;

function textOf(msg: Anthropic.Message) {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function generatePrompt(previous: string[] = []): Promise<string> {
  const avoid = previous.length
    ? `\n\nRecent prompts this group already had (don't repeat these themes):\n${previous.map((p) => `- ${p}`).join("\n")}`
    : "";
  if (hasKey()) try {
    const msg = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 60,
      system:
        "You write one photo prompt for a group of friends who live in different cities after college and want to stay close. " +
        "The prompt should be cute, warm, and doable by anyone in ordinary everyday life within a few days. " +
        "Vary randomly between generic (\"your view right now\") and niche-but-answerable (\"something you own that's older than you\", \"the most chaotic thing in your fridge\"). " +
        "Never ask for photos of strangers, anything unsafe, private, embarrassing, or anything that costs money or requires travel. " +
        "Reply with only the prompt: under 12 words, lowercase, casual, no quotes, no trailing punctuation.",
      messages: [{ role: "user", content: `Write this cycle's prompt.${avoid}` }],
    });
    const prompt = textOf(msg).replace(/^["'“]|["'”.]$/g, "").trim();
    if (prompt && prompt.length < 120) return prompt;
  } catch (err) {
    console.error("generatePrompt failed", err);
  }
  const fresh = FALLBACK_PROMPTS.filter((p) => !previous.includes(p));
  const pool = fresh.length ? fresh : FALLBACK_PROMPTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export type Vibe = { vibe_label: string; palette: string[] };

const HEX = /^#[0-9a-f]{6}$/i;

function parseVibe(text: string): Vibe | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    const palette = Array.isArray(v.palette) ? v.palette.filter((c: unknown) => typeof c === "string" && HEX.test(c)) : [];
    if (typeof v.vibe_label !== "string" || !v.vibe_label.trim() || palette.length < 3) return null;
    return { vibe_label: v.vibe_label.trim().slice(0, 60), palette: palette.slice(0, 5) };
  } catch {
    return null;
  }
}

/** One multimodal call over all (downscaled) photos. Returns null if the model fails twice. */
export async function analyzeVibe(images: Buffer[], prompt: string): Promise<Vibe | null> {
  if (!hasKey()) return null;
  const content: Anthropic.ContentBlockParam[] = [
    ...images.map(
      (buf): Anthropic.ImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
      }),
    ),
    {
      type: "text",
      text:
        `These ${images.length} photos were shared by a friend group this cycle for the prompt "${prompt}". ` +
        "Sum up the group's collective vibe the way Spotify Wrapped names a listening aesthetic " +
        '(e.g. "Cozy Cottagecore Brunch Club", "Main Character Golden Hour", "Soft Chaos Picnic Era"). ' +
        "Be cute and wholesome. Never tease, and never comment on anyone's body or appearance.\n\n" +
        "Reply with only JSON, no prose:\n" +
        '{"vibe_label": "2-5 word aesthetic label in Title Case", "palette": ["#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb"]}\n' +
        "The palette is 5 colors actually drawn from the photos, ordered from lightest to darkest.",
    },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const msg = await anthropic().messages.create({
        model: MODEL,
        max_tokens: 200,
        messages: [{ role: "user", content }],
      });
      const vibe = parseVibe(textOf(msg));
      if (vibe) return vibe;
    } catch (err) {
      console.error("analyzeVibe failed", err);
    }
  }
  return null;
}
