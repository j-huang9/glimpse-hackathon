import type { Metadata } from "next";

export const metadata: Metadata = { title: "glimpse · phone preview" };

/**
 * Desktop presentation view: the live app inside an iPhone-sized frame (390×844),
 * for screen-recording the demo video. Everything inside the frame is the real app.
 */
export default function PhonePreview() {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-16 bg-[radial-gradient(ellipse_at_top_right,#ffe1d2,transparent_55%),radial-gradient(ellipse_at_bottom_left,#e4dcff,transparent_55%)] bg-bg p-8">
      <div className="hidden max-w-xs lg:block">
        <p className="font-serif text-6xl leading-none">glimpse</p>
        <p className="mt-5 text-lg leading-relaxed text-muted">
          One prompt. Real photos from your real friends, sealed until the end of the cycle. Then a moodboard you can
          decorate together.
        </p>
      </div>
      <div className="relative rounded-[64px] bg-[#111] p-[14px] shadow-[0_40px_120px_rgba(40,20,10,0.35)]">
        <div className="absolute left-1/2 top-[26px] z-10 h-[32px] w-[120px] -translate-x-1/2 rounded-full bg-black" />
        <iframe
          src="/"
          title="glimpse on a phone"
          className="block h-[844px] w-[390px] rounded-[50px] bg-bg"
          style={{ border: 0 }}
        />
      </div>
    </div>
  );
}
