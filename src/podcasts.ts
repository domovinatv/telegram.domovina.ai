// Telegram kanal po podcastu: mapiranje YouTube channel_id → chat, po jeziku.
//
// Kanale stvara MTProto provisioner na Macu (scripts/provision), jer Bot API ne
// može stvoriti ni grupu ni kanal. Ovdje se samo pamti što je stvoreno.
//
// Ključ je YouTube channel_id, ne slug pipelinea: Tier 2 epizode žive u
// `_unlisted/`, pa im je slug doslovno "_unlisted".
//
// Jezik: hrvatski par je `tg:podcast:<UC>` (kao od početka), engleski par je
// zaseban zapis `tg:podcast:<UC>:en`. Podcast bira svaki posebno (odluka E2):
// postojanje zapisa je zapis pristanka za taj jezik.

export type Lang = "hr" | "en";

export interface PodcastChat {
  youtubeChannelId: string;
  /** Jezik objava; stari HR zapisi ga nemaju (= "hr"). */
  lang?: Lang;
  /** Bot API oblik (-100…) kanala za objave. */
  chatId: string;
  /** Povezana grupa za raspravu, ako postoji. */
  discussionChatId: string | null;
  link: string;
  title: string;
  createdAt: string;
}

export const LANGS: readonly Lang[] = ["hr", "en"];

export const podcastKey = (youtubeChannelId: string, lang: Lang = "hr") =>
  lang === "hr" ? `tg:podcast:${youtubeChannelId}` : `tg:podcast:${youtubeChannelId}:${lang}`;

export function isYoutubeChannelId(value: unknown): value is string {
  return typeof value === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(value);
}

/** `?lang=` iz upita: prazno = hr, nepoznato = null (400). */
export function parseLang(value: string | null | undefined): Lang | null {
  if (value == null || value === "") return "hr";
  return (LANGS as readonly string[]).includes(value) ? (value as Lang) : null;
}

export async function getPodcastChat(kv: KVNamespace, youtubeChannelId: string, lang: Lang = "hr"): Promise<PodcastChat | null> {
  const chat = await kv.get<PodcastChat>(podcastKey(youtubeChannelId, lang), "json");
  return chat ? { ...chat, lang: chat.lang ?? lang } : null;
}

/** Validira tijelo PUT-a; vraća grešku kao tekst ili spremljeni zapis. */
export async function putPodcastChat(
  kv: KVNamespace,
  youtubeChannelId: string,
  body: Record<string, unknown>,
  lang: Lang = "hr",
): Promise<PodcastChat | string> {
  const chatId = String(body.chatId ?? "");
  if (!/^-100\d{5,}$/.test(chatId)) return "chatId mora biti Bot API id kanala (-100…)";
  const discussion = body.discussionChatId == null ? null : String(body.discussionChatId);
  if (discussion !== null && !/^-100\d{5,}$/.test(discussion)) return "discussionChatId mora biti -100… ili null";
  const link = String(body.link ?? "");
  if (!/^https:\/\/t\.me\//.test(link)) return "link mora biti https://t.me/…";
  const title = String(body.title ?? "").trim().slice(0, 128);
  if (!title) return "title je obavezan";
  if (body.lang != null && body.lang !== lang) return `lang u tijelu (${String(body.lang)}) ne odgovara ?lang=${lang}`;
  // Isti Telegram kanal ne smije nositi oba jezika (EN zapis bi pregazio HR objave).
  const other = await getPodcastChat(kv, youtubeChannelId, lang === "hr" ? "en" : "hr");
  if (other && other.chatId === chatId) return `kanal ${chatId} je već ${other.lang ?? "hr"} kanal ovog podcasta`;

  const chat: PodcastChat = {
    youtubeChannelId,
    lang,
    chatId,
    discussionChatId: discussion,
    link,
    title,
    createdAt: typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString(),
  };
  await kv.put(podcastKey(youtubeChannelId, lang), JSON.stringify(chat));
  return chat;
}
