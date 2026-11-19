// Iz data/<id>/episode.json (KORAK 12.7, inline summary/article/info) izvuci
// ono što kanal treba. Čisto, bez I/O-a, da ga testovi vrte bez R2.

export interface Chapter {
  sec: number;
  title: string;
}

export interface EpisodeContent {
  title: string;
  abstract: string;
  youtubeChannelId: string | null;
  chapters: Chapter[];
}

/** "HH:MM:SS", "MM:SS" ili "SS" u sekunde; null za sve ostalo. */
export function toSeconds(stamp: unknown): number | null {
  if (typeof stamp !== "string" || !/^\d+(:\d+){0,2}$/.test(stamp.trim())) return null;
  const parts = stamp.trim().split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts as [number, number, number];
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

type Bundle = {
  inline?: {
    "summary.json"?: { summary?: { title_hr?: string; abstract_hr?: string }; source?: { title?: string } };
    "article.json"?: { iterations?: Array<{ sections?: Array<{ subtitle?: string; screenshot_timestamp?: string }> }> };
    "info.json"?: { channel_id?: string; title?: string };
  };
};

type Section = { subtitle?: string; subtitle_en?: string; screenshot_timestamp?: string };
type Article = { iterations?: Array<{ sections?: Section[] }> };

/**
 * Poglavlja kakva ih ima živa stranica: svaka sekcija svake iteracije po
 * screenshot_timestampu, sortirano, duplikat sekunde preskočen. Ista pravila
 * kao extractChapters u fetch.domovina.tv/share_to_whatsapp.js.
 */
function chaptersOf(article: Article, name: (section: Section) => string | undefined): Chapter[] {
  const seen = new Set<number>();
  const chapters: Chapter[] = [];
  for (const iteration of article.iterations ?? []) {
    for (const section of iteration.sections ?? []) {
      const sec = toSeconds(section.screenshot_timestamp);
      if (sec === null || seen.has(sec)) continue;
      seen.add(sec);
      chapters.push({ sec, title: (name(section) ?? "").trim() });
    }
  }
  return chapters.sort((a, b) => a.sec - b.sec);
}

const validUc = (uc: unknown) => (typeof uc === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(uc) ? uc : null);

export function episodeContent(bundle: unknown): EpisodeContent | null {
  const inline = (bundle as Bundle | null)?.inline;
  const article = inline?.["article.json"];
  if (!article?.iterations) return null;

  const summary = inline?.["summary.json"];
  const info = inline?.["info.json"];
  return {
    title: summary?.summary?.title_hr || summary?.source?.title || info?.title || "",
    abstract: summary?.summary?.abstract_hr ?? "",
    youtubeChannelId: validUc(info?.channel_id),
    chapters: chaptersOf(article, (section) => section.subtitle),
  };
}

type EnglishSummary = { summary?: { title_en?: string; abstract_en?: string } };

/**
 * Engleski sadržaj iz `data/<id>/article.en.json` + `summary.en.json` (nisu
 * inline u episode.json). Prijevod piše `*_en` polja uz hrvatska; hrvatski tekst
 * nikad ne ide u engleski kanal, pa poglavlje bez `subtitle_en` ostaje samo
 * vrijeme + link. Null dok prijevod nije stigao (Workflow tada čeka).
 */
export function englishContent(article: unknown, summary: unknown): EpisodeContent | null {
  const a = article as Article | null;
  const s = (summary as EnglishSummary | null)?.summary;
  const title = s?.title_en?.trim();
  if (!a?.iterations?.length || !title) return null;
  const chapters = chaptersOf(a, (section) => section.subtitle_en);
  if (!chapters.some((c) => c.title)) return null;
  return { title, abstract: s?.abstract_en?.trim() ?? "", youtubeChannelId: null, chapters };
}
