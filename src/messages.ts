// Tekst poruka u kanalu podcasta, hrvatski ili engleski. Svaki link vodi na
// domovina.ai, nikad na YouTube (isto pravilo kao EPUB i ostali artefakti koji
// putuju sami). Engleski kanal vodi na engleske rute (`…/en`), čiji og:title je
// engleski.

import type { Lang } from "./podcasts";
import { esc } from "./telegram";

const SITE = "https://domovina.ai";

const suffix = (lang: Lang) => (lang === "en" ? "/en" : "");
export const episodeUrl = (id: string, lang: Lang = "hr") => `${SITE}/v/${id}${suffix(lang)}`;
export const chapterUrl = (id: string, sec: number, lang: Lang = "hr") => `${SITE}/v/${id}/t/${sec}${suffix(lang)}`;

/** Sekunde kao "M:SS" ili "H:MM:SS", isti oblik kao og:title stranice. */
export function clock(sec: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(sec % 60)}` : `${m}:${pad(sec % 60)}`;
}

/** „1 poglavlje”, „21 poglavlje”, ali „11 poglavlja”, „5 poglavlja”. */
export function chapterWord(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return "poglavlje";
  return "poglavlja";
}

const TEXT = {
  hr: {
    count: (n: number) => `${n} ${chapterWord(n)}`,
    inThread: "u komentarima ispod objave",
    below: "slijedi u nastavku",
    full: "Cijela epizoda",
  },
  en: {
    count: (n: number) => `${n} ${n === 1 ? "chapter" : "chapters"}`,
    inThread: "in the comments below",
    below: "below",
    full: "Full episode",
  },
} as const;

/** Prva poruka epizode: naslov, kratki sažetak i link na stranicu epizode. */
export function episodeMessage(
  id: string,
  title: string,
  abstract: string,
  chapters: number,
  inThread = false,
  lang: Lang = "hr",
): string {
  const t = TEXT[lang];
  const lines = [`🎙 <b>${esc(title)}</b>`];
  if (abstract) lines.push("", esc(abstract.length > 600 ? `${abstract.slice(0, 600)}…` : abstract));
  const where = inThread ? t.inThread : t.below;
  lines.push("", `${chapters > 0 ? `${t.count(chapters)} ${where}. ` : ""}${t.full}: ${esc(episodeUrl(id, lang))}`);
  return lines.join("\n");
}

export function chapterMessage(id: string, sec: number, title: string, lang: Lang = "hr"): string {
  const name = title ? ` · ${esc(title)}` : "";
  return `⏱ <b>${clock(sec)}</b>${name}\n${esc(chapterUrl(id, sec, lang))}`;
}
