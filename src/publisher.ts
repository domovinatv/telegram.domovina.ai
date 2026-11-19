// RPC ulaz za domovina-push (service binding, entrypoint "TelegramPublisher").
// Nije dostupan s interneta, pa ne treba token.
//
// domovina-push odlučuje KAD je epizoda nova i smije li se javiti na kojem
// jeziku (postavke kanala: push_notifications, english_translation; tihi sati,
// spremnost). Ovdje se odlučuje samo IMA LI podcast kanal na tom jeziku i je li
// epizoda novija od tog kanala.

import { WorkerEntrypoint } from "cloudflare:workers";
import { getPodcastChat, type Lang } from "./podcasts";

export interface PublishRequest {
  videoId: string;
  youtubeChannelId: string;
  /** `YYYY-MM-DD`, dan objave iz listinga. */
  date: string;
  /** Jezik kanala; bez njega "hr" (stari pozivatelj). */
  lang?: Lang;
}

export type PublishStatus = "started" | "exists" | "no_channel" | "before_channel";

/** Instanca po epizodi, kanalu i jeziku: isti par se nikad ne objavi dvaput. HR id ostaje kakav je bio. */
export const instanceId = (videoId: string, youtubeChannelId: string, lang: Lang = "hr") =>
  lang === "hr" ? `ep-${videoId}-${youtubeChannelId}` : `ep-${videoId}-${youtubeChannelId}-${lang}`;

export async function startPublish(env: Env, request: PublishRequest): Promise<PublishStatus> {
  const lang = request.lang ?? "hr";
  const podcast = await getPodcastChat(env.PODCASTS, request.youtubeChannelId, lang);
  if (!podcast) return "no_channel";
  // Samo nove epizode: kanal ne puni ono što je izašlo prije nego je nastao.
  if (request.date < podcast.createdAt.slice(0, 10)) return "before_channel";
  try {
    await env.PUBLISH.create({
      id: instanceId(request.videoId, request.youtubeChannelId, lang),
      params: { videoId: request.videoId, chatId: podcast.chatId, discussionChatId: podcast.discussionChatId, lang },
    });
    return "started";
  } catch (error) {
    if (/already exists|duplicate/i.test(String(error))) return "exists";
    throw error;
  }
}

export class TelegramPublisher extends WorkerEntrypoint<Env> {
  async publishEpisode(request: PublishRequest): Promise<PublishStatus> {
    const status = await startPublish(this.env, request);
    console.log(JSON.stringify({ event: "publish_episode", ...request, lang: request.lang ?? "hr", status }));
    return status;
  }
}
