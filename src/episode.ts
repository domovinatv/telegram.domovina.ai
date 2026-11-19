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

/**
 * Poglavlja kakva ih ima živa stranica: svaka sekcija svake iteracije po
 * screenshot_timestampu, sortirano, duplikat sekunde preskočen. Ista pravila
 * kao extractChapters u fetch.domovina.tv/share_to_whatsapp.js.
 */
export function episodeContent(bundle: unknown): EpisodeContent | null {
  const inline = (bundle as Bundle | null)?.inline;
  const article = inline?.["article.json"];
  if (!article?.iterations) return null;

  const seen = new Set<number>();
  const chapters: Chapter[] = [];
  for (const iteration of article.iterations) {
    for (const section of iteration.sections ?? []) {
      const sec = toSeconds(section.screenshot_timestamp);
      if (sec === null || seen.has(sec)) continue;
      seen.add(sec);
      chapters.push({ sec, title: (section.subtitle ?? "").trim() });
    }
  }
  chapters.sort((a, b) => a.sec - b.sec);

  const summary = inline?.["summary.json"];
  const info = inline?.["info.json"];
  const uc = info?.channel_id;
  return {
    title: summary?.summary?.title_hr || summary?.source?.title || info?.title || "",
    abstract: summary?.summary?.abstract_hr ?? "",
    youtubeChannelId: typeof uc === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(uc) ? uc : null,
    chapters,
  };
}
