// telegram.domovina.ai — Telegram kanal po podcastu.
//
// Podcast koji pristane (telegram.opt_in u registryju fetch.domovina.tv) dobiva
// vlastiti Telegram kanal + grupu za raspravu. Stvara ih MTProto provisioner na
// Macu (scripts/provision), jer Bot API ne može stvoriti ni kanal ni grupu. Ovaj
// Worker pamti mapiranje i objavljuje u kanal kroz bota domovina.ai.
//
//   GET  /                               zdravlje
//   GET  /public/podcasts/{UC…}          {title, link} za gumb „Pridruži se” na domovina.ai (javno, CORS)
//   GET  /podcasts/{UC…}                 puno mapiranje (bearer)
//   PUT  /podcasts/{UC…}                 upis mapiranja; zove ga provisioner (bearer)
//   POST /podcasts/{UC…}/episode         {id, title, abstract?, chapters?} prva poruka epizode (bearer)
//   POST /podcasts/{UC…}/chapter         {id, sec, title} jedno poglavlje, tiho (bearer)
//
// Jedno poglavlje po zahtjevu: epizoda ima 30–46 poglavlja, a kanal prima ~20
// poruka u minuti. Tempo drži petlja (scripts/share-chapters.ts), ne waitUntil
// koji runtime reže nakon 30 s.

import { chapterMessage, chapterUrl, episodeMessage, episodeUrl } from "./messages";
import { getPodcastChat, isYoutubeChannelId, putPodcastChat } from "./podcasts";
import { sendMessage } from "./telegram";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

const isVideoId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{9,}$/.test(value);

async function authorized(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get("Authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!env.API_TOKEN || !given) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(env.API_TOKEN)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function handlePost(youtubeChannelId: string, action: string, request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "TELEGRAM_BOT_TOKEN nije postavljen" }, 503);
  const podcast = await getPodcastChat(env.PODCASTS, youtubeChannelId);
  if (!podcast) return json({ error: "podcast nema Telegram kanal", youtubeChannelId }, 404);
  const body = await readJson(request);
  if (!body || !isVideoId(body.id)) return json({ error: "id mora biti YouTube id epizode" }, 400);
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 300) : "";

  if (action === "episode") {
    const abstract = typeof body.abstract === "string" ? body.abstract.trim() : "";
    const chapters = Number.isInteger(body.chapters) ? (body.chapters as number) : 0;
    const sent = await sendMessage(env.TELEGRAM_BOT_TOKEN, podcast.chatId, episodeMessage(body.id, title, abstract, chapters), {
      previewUrl: episodeUrl(body.id),
    });
    return json({ sent: sent.ok, id: body.id, error: sent.description }, sent.ok ? 201 : 502);
  }

  const sec = Number(body.sec);
  if (!Number.isInteger(sec) || sec < 0) return json({ error: "sec mora biti cijeli broj sekundi" }, 400);
  const sent = await sendMessage(env.TELEGRAM_BOT_TOKEN, podcast.chatId, chapterMessage(body.id, sec, title), {
    previewUrl: chapterUrl(body.id, sec),
    silent: true,
  });
  return json({ sent: sent.ok, id: body.id, sec, error: sent.description }, sent.ok ? 201 : 502);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (request.method === "GET" && pathname === "/") return json({ service: "telegram.domovina.ai", ok: true });

      if (pathname.startsWith("/public/podcasts/")) {
        const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
        const id = pathname.slice("/public/podcasts/".length);
        if (!isYoutubeChannelId(id)) return json({ error: "očekujem YouTube channel_id (UC…)" }, 400, cors);
        const podcast = await getPodcastChat(env.PODCASTS, id);
        return podcast ? json({ title: podcast.title, link: podcast.link }, 200, cors) : json({ error: "nema kanala" }, 404, cors);
      }

      if (pathname.startsWith("/podcasts/")) {
        if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
        const [id = "", action = ""] = pathname.slice("/podcasts/".length).split("/");
        if (!isYoutubeChannelId(id)) return json({ error: "očekujem YouTube channel_id (UC…)" }, 400);

        if (!action && request.method === "GET") {
          const podcast = await getPodcastChat(env.PODCASTS, id);
          return podcast ? json(podcast) : json({ error: "podcast nema Telegram kanal", youtubeChannelId: id }, 404);
        }
        if (!action && request.method === "PUT") {
          const body = await readJson(request);
          if (!body) return json({ error: "neispravan JSON" }, 400);
          const stored = await putPodcastChat(env.PODCASTS, id, body);
          if (typeof stored === "string") return json({ error: stored }, 400);
          console.log(JSON.stringify({ event: "podcast_chat_stored", youtubeChannelId: id, chatId: stored.chatId }));
          return json(stored, 201);
        }
        if ((action === "episode" || action === "chapter") && request.method === "POST") {
          return await handlePost(id, action, request, env);
        }
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "unhandled", path: pathname, message: String(error) }));
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
