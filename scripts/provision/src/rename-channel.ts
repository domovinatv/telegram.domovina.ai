// Preimenuj postojeći kanal + grupu podcasta po pravilu iz src/naming.ts.
//
//   npm run rename-channel -- <UC…> --name "Podcast" [--lang hr|en] [--about] [--dry-run]
//
// Čita mapiranje iz Workera (GET /podcasts/<UC>[?lang=en]), mijenja naslove
// (channels.EditTitle) kanala i grupe, uz --about i opis obama, pa upiše novi
// naslov u mapiranje (PUT, createdAt ostaje, inače bi kanal „zaboravio” epizode
// objavljene od nastanka). Kanal i grupa ostaju isti, mijenjaju se samo nazivi.

import "dotenv/config";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { ABOUT, chatTitles, parseLang } from "./naming.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const log = (...parts: unknown[]) => console.error(...parts);
const usage = 'Upotreba: npm run rename-channel -- <UC…> --name "Podcast" [--lang hr|en] [--about] [--dry-run]';

const argv = process.argv.slice(2);
const flags = new Map<string, string | boolean>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--dry-run" || a === "--about") flags.set(a, true);
  else if (["--name", "--lang"].includes(a)) flags.set(a, argv[++i] ?? "");
  else positional.push(a);
}
const youtubeChannelId = positional[0] ?? "";
if (!/^UC[A-Za-z0-9_-]{22}$/.test(youtubeChannelId)) {
  log(`Nevaljan YouTube channel_id '${youtubeChannelId}'.\n${usage}`);
  process.exit(1);
}
const lang = parseLang(flags.get("--lang"));
if (!lang) {
  log(`Nevaljan --lang.\n${usage}`);
  process.exit(1);
}
let titles: { channel: string; discussion: string };
try {
  titles = chatTitles(String(flags.get("--name") ?? ""), lang);
} catch (error) {
  log(`${(error as Error).message}\n${usage}`);
  process.exit(1);
}
const withAbout = flags.get("--about") === true;
const dryRun = flags.get("--dry-run") === true;

const BASE = (process.env.TELEGRAM_BASE || "https://telegram.domovina.ai").replace(/\/$/, "");
const query = lang === "en" ? "?lang=en" : "";
function apiToken(): string {
  if (process.env.TELEGRAM_API_TOKEN) return process.env.TELEGRAM_API_TOKEN;
  const match = readFileSync(path.join(REPO, ".dev.vars"), "utf-8").match(/^API_TOKEN=(.+)$/m);
  if (!match) throw new Error("nema API_TOKEN u .dev.vars ni TELEGRAM_API_TOKEN");
  return match[1]!.trim();
}
const token = apiToken();
const auth = { Authorization: `Bearer ${token}` };

const got = await fetch(`${BASE}/podcasts/${youtubeChannelId}${query}`, { headers: auth });
if (!got.ok) {
  log(`❌ ${youtubeChannelId} nema ${lang.toUpperCase()} mapiranje (${got.status})`);
  process.exit(1);
}
const mapping = (await got.json()) as {
  chatId: string;
  discussionChatId: string | null;
  link: string;
  title: string;
  createdAt: string;
};

log(`▸ ${lang.toUpperCase()} ${youtubeChannelId}`);
log(`  kanal ${mapping.chatId}: „${mapping.title}” → „${titles.channel}”`);
if (mapping.discussionChatId) log(`  grupa ${mapping.discussionChatId}: → „${titles.discussion}”`);
if (withAbout) log(`  opis: ${ABOUT[lang]}`);
if (dryRun) process.exit(0);

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH ?? "";
const client = new TelegramClient(new StringSession(process.env.TG_SESSION ?? ""), apiId, apiHash, { connectionRetries: 5 });
await client.connect();
if (!(await client.checkAuthorization())) {
  log("❌ TG_SESSION nije valjan — ponovi `npm run login`.");
  process.exit(1);
}
// Pristupni hash kanala dolazi iz dijaloga računa (StringSession nema cache entiteta).
await client.getDialogs({ limit: 200 });

async function retitle(botApiId: string, title: string): Promise<void> {
  const channel = await client.getInputEntity(botApiId);
  try {
    await client.invoke(new Api.channels.EditTitle({ channel, title }));
    log(`  ✓ ${botApiId} → „${title}”`);
  } catch (error) {
    if (!/CHAT_NOT_MODIFIED|ChatNotModified/i.test(String(error))) throw error;
    log(`  = ${botApiId} već „${title}”`);
  }
  if (withAbout) {
    try {
      await client.invoke(new Api.messages.EditChatAbout({ peer: channel, about: ABOUT[lang!] }));
      log("    ✓ opis");
    } catch (error) {
      if (!/CHAT_ABOUT_NOT_MODIFIED|ChatAboutNotModified/i.test(String(error))) throw error;
    }
  }
}

await retitle(mapping.chatId, titles.channel);
if (mapping.discussionChatId) await retitle(mapping.discussionChatId, titles.discussion);
await client.disconnect();

const put = await fetch(`${BASE}/podcasts/${youtubeChannelId}${query}`, {
  method: "PUT",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ ...mapping, title: titles.channel }),
});
if (!put.ok) {
  log(`  ❌ PUT mapiranja ${put.status}: ${(await put.text()).slice(0, 200)} — Telegram je preimenovan, KV nije`);
  process.exit(2);
}
log("  ✓ mapiranje: novi naslov, createdAt isti");
process.exit(0);
