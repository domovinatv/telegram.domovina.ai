// Nit komentara ispod objave kanala.
//
// Kad bot objavi epizodu u kanal, Telegram tu objavu sam proslijedi u povezanu
// grupu za raspravu (is_automatic_forward). Odgovori na tu proslijeđenu poruku
// su komentari ispod objave u kanalu, pa poglavlja idu tamo: kanal ostaje jedna
// objava po epizodi, a tko želi poglavlja otvori komentare.
//
// Bot API ne vraća id proslijeđene poruke pri slanju, pa ga hvata webhook i
// sprema ovdje; Workflow ga čeka.

export interface ThreadRoot {
  /** Grupa za raspravu u koju je objava proslijeđena. */
  chatId: string;
  /** message_id proslijeđene objave u toj grupi. */
  messageId: number;
}

const key = (channelChatId: string, channelMessageId: number) => `tg:thread:${channelChatId}:${channelMessageId}`;
/** Nit treba samo dok Workflow ne pošalje poglavlja. */
const TTL_SECONDS = 3 * 24 * 3600;

export async function getThreadRoot(kv: KVNamespace, channelChatId: string, channelMessageId: number): Promise<ThreadRoot | null> {
  return await kv.get<ThreadRoot>(key(channelChatId, channelMessageId), "json");
}

interface TelegramChat {
  id?: number;
}
interface TelegramMessage {
  message_id?: number;
  chat?: TelegramChat;
  is_automatic_forward?: boolean;
  sender_chat?: TelegramChat;
  forward_origin?: { type?: string; chat?: TelegramChat; message_id?: number };
  forward_from_chat?: TelegramChat;
  forward_from_message_id?: number;
}

/** Iz Telegram updatea izvuci (kanal, objava) → (grupa, poruka), ili null. */
export function threadFromUpdate(update: unknown): { channelChatId: string; channelMessageId: number; root: ThreadRoot } | null {
  const message = (update as { message?: TelegramMessage } | null)?.message;
  if (!message?.is_automatic_forward || !message.chat?.id || !message.message_id) return null;
  const origin = message.forward_origin;
  const channelId = origin?.type === "channel" ? origin.chat?.id : (message.forward_from_chat?.id ?? message.sender_chat?.id);
  const channelMessageId = origin?.type === "channel" ? origin.message_id : message.forward_from_message_id;
  if (!channelId || !channelMessageId) return null;
  return {
    channelChatId: String(channelId),
    channelMessageId,
    root: { chatId: String(message.chat.id), messageId: message.message_id },
  };
}

export async function putThreadRoot(kv: KVNamespace, channelChatId: string, channelMessageId: number, root: ThreadRoot): Promise<void> {
  await kv.put(key(channelChatId, channelMessageId), JSON.stringify(root), { expirationTtl: TTL_SECONDS });
}
