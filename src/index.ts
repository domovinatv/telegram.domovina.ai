// telegram.domovina.ai — Telegram kanal po podcastu.
//
// Podcast koji pristane (kanal se tada stvara ručno, scripts/provision) dobiva
// vlastiti Telegram kanal + grupu za raspravu. Stvara ih MTProto provisioner na
// Macu (scripts/provision), jer Bot API ne može stvoriti ni kanal ni grupu. Ovaj
// Worker pamti mapiranje i objavljuje u kanal kroz bota domovina.ai.
//
//   GET  /                               zdravlje
//   GET  /public/podcasts/{UC…}          {title, link, en} za gumb „Pridruži se” na domovina.ai (javno, CORS)
//   GET  /podcasts/{UC…}[?lang=en]       puno mapiranje (bearer)
//   PUT  /podcasts/{UC…}[?lang=en]       upis mapiranja; zove ga provisioner (bearer)
//   POST /podcasts/{UC…}/episodes/{videoId}[?lang=en]  ručno pokreni objavu epizode (bearer)
//
// Bez ?lang je hrvatski kanal (kao od početka); ?lang=en je engleski par.
//   POST /telegram/webhook               Telegram (X-Telegram-Bot-Api-Secret-Token): hvata
//                                        objavu proslijeđenu u grupu za raspravu → nit poglavlja
//   POST /telegram/setup                 postavi webhook bota na ovaj Worker (bearer)

import { getPodcastChat, isYoutubeChannelId, parseLang, putPodcastChat } from "./podcasts";
import { startPublish } from "./publisher";
import { setWebhook } from "./telegram";
import { putThreadRoot, threadFromUpdate } from "./threads";

export { TelegramPublisher } from "./publisher";
export { PublishEpisode } from "./workflow";

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

async function sameSecret(given: string, expected: string | undefined): Promise<boolean> {
  if (!expected || !given) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    try {
      if (request.method === "GET" && pathname === "/") return json({ service: "telegram.domovina.ai", ok: true });

      if (request.method === "POST" && pathname === "/telegram/webhook") {
        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!(await sameSecret(secret, env.TELEGRAM_WEBHOOK_SECRET))) return json({ error: "unauthorized" }, 401);
        const thread = threadFromUpdate(await readJson(request));
        if (thread) {
          await putThreadRoot(env.PODCASTS, thread.channelChatId, thread.channelMessageId, thread.root);
          console.log(JSON.stringify({ event: "thread_root", ...thread }));
        }
        // Sve ostalo (komentari ljudi, vlastite poruke bota) se samo potvrdi.
        return json({ ok: true });
      }

      if (request.method === "POST" && pathname === "/telegram/setup") {
        if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
        if (!env.TELEGRAM_WEBHOOK_SECRET) return json({ error: "nema TELEGRAM_WEBHOOK_SECRET" }, 500);
        const url = `${new URL(request.url).origin}/telegram/webhook`;
        const result = await setWebhook(env.TELEGRAM_BOT_TOKEN, url, env.TELEGRAM_WEBHOOK_SECRET);
        return json({ url, ok: result.ok ?? false, description: result.description }, result.ok ? 200 : 502);
      }

      if (pathname.startsWith("/public/podcasts/")) {
        const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
        const id = pathname.slice("/public/podcasts/".length);
        if (!isYoutubeChannelId(id)) return json({ error: "očekujem YouTube channel_id (UC…)" }, 400, cors);
        const [hr, en] = await Promise.all([getPodcastChat(env.PODCASTS, id, "hr"), getPodcastChat(env.PODCASTS, id, "en")]);
        if (!hr && !en) return json({ error: "nema kanala" }, 404, cors);
        // Gornja razina je hrvatski kanal (stari oblik); `en` je engleski par ili null.
        return json(
          {
            title: hr?.title ?? null,
            link: hr?.link ?? null,
            en: en ? { title: en.title, link: en.link } : null,
          },
          200,
          cors,
        );
      }

      if (pathname.startsWith("/podcasts/")) {
        if (!(await authorized(request, env))) return json({ error: "unauthorized" }, 401);
        const [id = "", action = ""] = pathname.slice("/podcasts/".length).split("/");
        if (!isYoutubeChannelId(id)) return json({ error: "očekujem YouTube channel_id (UC…)" }, 400);
        const lang = parseLang(url.searchParams.get("lang"));
        if (!lang) return json({ error: "lang mora biti hr ili en" }, 400);

        if (!action && request.method === "GET") {
          const podcast = await getPodcastChat(env.PODCASTS, id, lang);
          return podcast ? json(podcast) : json({ error: "podcast nema Telegram kanal", youtubeChannelId: id, lang }, 404);
        }
        if (!action && request.method === "PUT") {
          const body = await readJson(request);
          if (!body) return json({ error: "neispravan JSON" }, 400);
          const stored = await putPodcastChat(env.PODCASTS, id, body, lang);
          if (typeof stored === "string") return json({ error: stored }, 400);
          console.log(JSON.stringify({ event: "podcast_chat_stored", youtubeChannelId: id, lang, chatId: stored.chatId }));
          return json(stored, 201);
        }
        // Ručno pokretanje (prvi kanal, test). Normalno epizode šalje domovina-push kroz RPC.
        const videoId = pathname.split("/")[4] ?? "";
        if (action === "episodes" && request.method === "POST" && isVideoId(videoId)) {
          const date = new Date().toISOString().slice(0, 10);
          const status = await startPublish(env, { videoId, youtubeChannelId: id, date, lang });
          return json({ status, videoId, lang }, status === "started" ? 201 : 200);
        }
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "unhandled", path: pathname, message: String(error) }));
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
