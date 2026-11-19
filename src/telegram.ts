// Bot API transport: jedna poruka u jedan chat, HTML, s ponovnim pokušajem.
//
// Kanali podcasta su broadcast kanali stvoreni MTProtom, pa nema migracije
// grupe u supergrupu (i promjene chat_id-a) koju bi trebalo pratiti.

const API = "https://api.telegram.org";

/** Telegram odbija poruke dulje od 4096 znakova. */
const MAX_MESSAGE = 3900;

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface TelegramResponse {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

export interface SendResult {
  ok: boolean;
  status: number;
  description?: string;
}

/**
 * Šalje jednu poruku. 429 i 5xx se ponavljaju (uz retry_after), sve ostalo je
 * konačna greška koju pozivatelj vidi s opisom.
 *
 * Pregled linka je uključen samo za `previewUrl`: to je stranica poglavlja na
 * domovina.ai, čiji og:image je kadar tog trenutka.
 */
export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
  options: { previewUrl?: string; silent?: boolean; tries?: number } = {},
): Promise<SendResult> {
  const { previewUrl, silent = false, tries = 4 } = options;
  const body = text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}\n…` : text;
  const linkPreview = previewUrl
    ? { url: previewUrl, prefer_large_media: true, show_above_text: false }
    : { is_disabled: true };

  let last: SendResult = { ok: false, status: 0 };
  for (let attempt = 1; attempt <= tries; attempt++) {
    let payload: TelegramResponse = {};
    let status = 0;
    try {
      const response = await fetch(`${API}/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: body,
          parse_mode: "HTML",
          link_preview_options: linkPreview,
          disable_notification: silent,
        }),
      });
      status = response.status;
      payload = (await response.json().catch(() => ({}))) as TelegramResponse;
      if (response.ok && payload.ok) return { ok: true, status };
    } catch (error) {
      console.warn(JSON.stringify({ event: "telegram_network_error", attempt, message: String(error) }));
    }
    last = { ok: false, status, description: payload.description };

    const transient = status === 0 || status === 429 || status >= 500;
    if (!transient || attempt === tries) break;
    const retryAfter = Number(payload.parameters?.retry_after) * 1000;
    const wait = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1000 * attempt) + Math.floor(Math.random() * 300);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  console.error(JSON.stringify({ event: "telegram_send_failed", chatId, ...last }));
  return last;
}
