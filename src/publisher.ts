// RPC ulaz za domovina-push (service binding, entrypoint "TelegramPublisher").
// Nije dostupan s interneta, pa ne treba token.
//
// domovina-push odlučuje KAD je epizoda nova i smije li se javiti (postavke
// kanala, tihi sati, spremnost). Ovdje se odlučuje samo IMA LI podcast kanal i
// je li epizoda novija od kanala.

import { WorkerEntrypoint } from "cloudflare:workers";
import { getPodcastChat } from "./podcasts";

export interface PublishRequest {
  videoId: string;
  youtubeChannelId: string;
  /** `YYYY-MM-DD`, dan objave iz listinga. */
  date: string;
}

export type PublishStatus = "started" | "exists" | "no_channel" | "before_channel";

/** Instanca po epizodi i kanalu: isti par se nikad ne objavi dvaput. */
export const instanceId = (videoId: string, youtubeChannelId: string) => `ep-${videoId}-${youtubeChannelId}`;

export async function startPublish(env: Env, request: PublishRequest): Promise<PublishStatus> {
  const podcast = await getPodcastChat(env.PODCASTS, request.youtubeChannelId);
  if (!podcast) return "no_channel";
  // Samo nove epizode: kanal ne puni ono što je izašlo prije nego je nastao.
  if (request.date < podcast.createdAt.slice(0, 10)) return "before_channel";
  try {
    await env.PUBLISH.create({
      id: instanceId(request.videoId, request.youtubeChannelId),
      params: { videoId: request.videoId, chatId: podcast.chatId, discussionChatId: podcast.discussionChatId },
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
    console.log(JSON.stringify({ event: "publish_episode", ...request, status }));
    return status;
  }
}
