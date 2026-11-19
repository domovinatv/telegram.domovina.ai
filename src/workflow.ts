// Objava jedne epizode: poruka epizode u kanal, pa poglavlja tiho, jedno po
// jedno, kao komentari ispod te objave (nit u grupi za raspravu). Kanal tako
// ostaje jedna objava po epizodi; tko želi poglavlja otvori komentare.
//
// Workflow, a ne petlja u fetchu: 30–46 poglavlja uz ~20 poruka u minuti traje
// 2–3 min, a svaki korak je memoiziran, pa ponovljeni pokušaj nastavlja točno
// ondje gdje je stao, bez duplikata.
//
// Kanal bez grupe za raspravu (discussionChatId null) dobiva poglavlja izravno
// u kanal, kao prije.
//
// Engleski kanal (lang "en") čita prijevod iz data/<id>/article.en.json i
// summary.en.json. Prijevod stiže nakon hrvatskog članka (za Magisterium kanale
// i satima kasnije), pa Workflow čeka do 48 h (step.sleep, ne drži ništa
// otvoreno) i onda odustane bez slanja.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { englishContent, episodeContent, type EpisodeContent } from "./episode";
import { chapterMessage, chapterUrl, episodeMessage, episodeUrl } from "./messages";
import type { Lang } from "./podcasts";
import { sendMessage } from "./telegram";
import { getThreadRoot } from "./threads";

export interface PublishParams {
  videoId: string;
  chatId: string;
  discussionChatId?: string | null;
  /** Bez njega "hr" (instance pokrenute prije engleskog). */
  lang?: Lang;
}

const RETRY = { retries: { limit: 5, delay: "10 seconds" as const, backoff: "exponential" as const }, timeout: "1 minute" as const };
/**
 * Proslijeđena objava stigne kroz webhook za sekundu-dvije; 6 pokušaja od 5 s
 * eksponencijalno čeka ukupno ~5 min prije nego odustane.
 */
const THREAD_WAIT = { retries: { limit: 6, delay: "5 seconds" as const, backoff: "exponential" as const }, timeout: "30 seconds" as const };
/** Chat prima ~20 poruka u minuti od jednog bota. */
const PACE = "3 seconds";

/**
 * Raspored provjera engleskog prijevoda: prva odmah, pa svakih 15 min prva
 * 2 h (agy prijevod traje ~5 min), pa svaki sat do 48 h ukupno.
 */
type Duration = Parameters<WorkflowStep["sleep"]>[1];
export const TRANSLATION_WAITS: readonly Duration[] = [
  ...Array.from({ length: 8 }, (): Duration => "15 minutes"),
  ...Array.from({ length: 46 }, (): Duration => "1 hour"),
];

async function r2Json(bucket: R2Bucket, key: string): Promise<unknown> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    return await object.json();
  } catch {
    return null; // napola upisan ili pokvaren JSON: kao da ga još nema
  }
}

export class PublishEpisode extends WorkflowEntrypoint<Env, PublishParams> {
  async run(
    event: WorkflowEvent<PublishParams>,
    step: WorkflowStep,
  ): Promise<{ chapters: number; inThread: boolean; lang: Lang; skipped?: string }> {
    const { videoId, chatId, discussionChatId = null, lang = "hr" } = event.payload;

    let content: EpisodeContent | null = null;
    if (lang === "en") {
      for (let attempt = 0; attempt <= TRANSLATION_WAITS.length; attempt++) {
        if (attempt > 0) await step.sleep(`čekam-prijevod-${attempt}`, TRANSLATION_WAITS[attempt - 1]!);
        content = await step.do(`prijevod-${attempt}`, RETRY, async () =>
          englishContent(
            await r2Json(this.env.CDN, `data/${videoId}/article.en.json`),
            await r2Json(this.env.CDN, `data/${videoId}/summary.en.json`),
          ),
        );
        if (content) break;
      }
      if (!content) {
        console.warn(JSON.stringify({ event: "translation_timeout", videoId, chatId }));
        return { chapters: 0, inThread: false, lang, skipped: "nema engleskog prijevoda ni nakon 48 h" };
      }
    } else {
      content = await step.do("episode.json", async () => {
        const object = await this.env.CDN.get(`data/${videoId}/episode.json`);
        const parsed = object ? episodeContent(await object.json()) : null;
        if (!parsed) throw new NonRetryableError(`episode.json za ${videoId} nema članak`);
        return parsed;
      });
    }
    const episode = content;

    const send = async (target: string, text: string, previewUrl: string, silent: boolean, replyTo?: number): Promise<number> => {
      const result = await sendMessage(this.env.TELEGRAM_BOT_TOKEN, target, text, { previewUrl, silent, replyTo, tries: 2 });
      if (result.ok) return result.messageId ?? 0;
      const transient = result.status === 0 || result.status === 429 || result.status >= 500;
      const message = `Telegram ${result.status}: ${result.description ?? ""}`;
      // 400/403 (kanal obrisan, bot izbačen) se ne popravlja ponavljanjem.
      throw transient ? new Error(message) : new NonRetryableError(message);
    };

    const inThread = Boolean(discussionChatId);
    const header = episodeMessage(videoId, episode.title, episode.abstract, episode.chapters.length, inThread, lang);
    const postId = await step.do("header", RETRY, () => send(chatId, header, episodeUrl(videoId, lang), false));

    let target = chatId;
    let replyTo: number | undefined;
    if (discussionChatId && episode.chapters.length > 0) {
      const root = await step.do("nit", THREAD_WAIT, async () => {
        const found = await getThreadRoot(this.env.PODCASTS, chatId, postId);
        if (!found) throw new Error(`proslijeđena objava ${chatId}/${postId} još nije stigla`);
        if (found.chatId !== discussionChatId) {
          throw new NonRetryableError(`objava proslijeđena u ${found.chatId}, mapiranje kaže ${discussionChatId}`);
        }
        return found;
      });
      target = root.chatId;
      replyTo = root.messageId;
    }

    for (const chapter of episode.chapters) {
      await step.sleep(`pauza-${chapter.sec}`, PACE);
      await step.do(`poglavlje-${chapter.sec}`, RETRY, () =>
        send(
          target,
          chapterMessage(videoId, chapter.sec, chapter.title, lang),
          chapterUrl(videoId, chapter.sec, lang),
          true,
          replyTo,
        ),
      );
    }
    return { chapters: episode.chapters.length, inThread, lang };
  }
}
