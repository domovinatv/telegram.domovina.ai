// Tekst poruka u kanalu podcasta. Svaki link vodi na domovina.ai, nikad na
// YouTube (isto pravilo kao EPUB i ostali artefakti koji putuju sami).

import { esc } from "./telegram";

const SITE = "https://domovina.ai";

export const episodeUrl = (id: string) => `${SITE}/v/${id}`;
export const chapterUrl = (id: string, sec: number) => `${SITE}/v/${id}/t/${sec}`;

/** Sekunde kao "M:SS" ili "H:MM:SS", isti oblik kao og:title stranice. */
export function clock(sec: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(sec % 60)}` : `${m}:${pad(sec % 60)}`;
}

/** Prva poruka epizode: naslov, kratki sažetak i link na stranicu epizode. */
export function episodeMessage(id: string, title: string, abstract: string, chapters: number): string {
  const lines = [`🎙 <b>${esc(title)}</b>`];
  if (abstract) lines.push("", esc(abstract.length > 600 ? `${abstract.slice(0, 600)}…` : abstract));
  lines.push("", `${chapters > 0 ? `${chapters} poglavlja slijedi u nastavku. ` : ""}Cijela epizoda: ${esc(episodeUrl(id))}`);
  return lines.join("\n");
}

export function chapterMessage(id: string, sec: number, title: string): string {
  const name = title ? ` · ${esc(title)}` : "";
  return `⏱ <b>${clock(sec)}</b>${name}\n${esc(chapterUrl(id, sec))}`;
}
