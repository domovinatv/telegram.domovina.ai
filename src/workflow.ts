// Objava jedne epizode u kanal podcasta: poruka epizode, pa poglavlja tiho,
// jedno po jedno. Workflow, a ne petlja u fetchu: 30–46 poglavlja uz ~20
// poruka u minuti traje 2–3 min, a svaki korak je memoiziran, pa ponovljeni
// pokušaj nastavlja točno ondje gdje je stao, bez duplikata u kanalu.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { episodeContent } from "./episode";
import { chapterMessage, chapterUrl, episodeMessage, episodeUrl } from "./messages";
import { sendMessage } from "./telegram";

export interface PublishParams {
  videoId: string;
  chatId: string;
}

const RETRY = { retries: { limit: 5, delay: "10 seconds" as const, backoff: "exponential" as const }, timeout: "1 minute" as const };
/** Kanal prima ~20 poruka u minuti od jednog bota. */
const PACE = "3 seconds";

export class PublishEpisode extends WorkflowEntrypoint<Env, PublishParams> {
  async run(event: WorkflowEvent<PublishParams>, step: WorkflowStep): Promise<{ chapters: number }> {
    const { videoId, chatId } = event.payload;

    const content = await step.do("episode.json", async () => {
      const object = await this.env.CDN.get(`data/${videoId}/episode.json`);
      const parsed = object ? episodeContent(await object.json()) : null;
      if (!parsed) throw new NonRetryableError(`episode.json za ${videoId} nema članak`);
      return parsed;
    });

    const send = async (text: string, previewUrl: string, silent: boolean) => {
      const result = await sendMessage(this.env.TELEGRAM_BOT_TOKEN, chatId, text, { previewUrl, silent, tries: 2 });
      if (result.ok) return;
      const transient = result.status === 0 || result.status === 429 || result.status >= 500;
      const message = `Telegram ${result.status}: ${result.description ?? ""}`;
      // 400/403 (kanal obrisan, bot izbačen) se ne popravlja ponavljanjem.
      throw transient ? new Error(message) : new NonRetryableError(message);
    };

    await step.do("header", RETRY, () =>
      send(episodeMessage(videoId, content.title, content.abstract, content.chapters.length), episodeUrl(videoId), false),
    );
    for (const chapter of content.chapters) {
      await step.sleep(`pauza-${chapter.sec}`, PACE);
      await step.do(`poglavlje-${chapter.sec}`, RETRY, () =>
        send(chapterMessage(videoId, chapter.sec, chapter.title), chapterUrl(videoId, chapter.sec), true),
      );
    }
    return { chapters: content.chapters.length };
  }
}
