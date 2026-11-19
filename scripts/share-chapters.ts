// Nove epizode podcasta s pristankom → njihov Telegram kanal.
//
// Vrti se na Macu iza nightlyja fetch.domovina.tv. Za svaku epizodu iz prozora
// (--hours) čiji podcast ima `telegram.opt_in` u registryju i koja je stvarno na
// domovina.ai (CDN ima data/<id>/article.json) pošalje u kanal podcasta:
//   1. poruku epizode (naslov, sažetak, link na stranicu epizode)
//   2. sva poglavlja, tiho, po jedno, s pregledom tog trenutka
//
// Kanal se stvara lazy: kad podcast s pristankom dobije prvu novu epizodu, a
// kanala još nema, --provision pozove scripts/provision (MTProto). Bez te
// zastavice epizoda čeka idući run. Ništa ne ide u neku zajedničku grupu.
//
// Samo nove epizode (fetch.domovina.tv CLAUDE.md #4): prozor je zadnjih --hours
// sati, a --seed upiše sve u prozoru kao poslano bez ijedne poruke.
//
// Usage:
//   node --experimental-strip-types scripts/share-chapters.ts [flags]
//
//   --hours N          koliko unatrag (default 30: jedan nightly + rezerva)
//   --limit N          najviše N epizoda po runu (default 10)
//   --id ID            samo ova epizoda, bez prozora (stanje se poštuje)
//   --provision        stvori kanal koji nedostaje (MTProto, Domovina račun)
//   --seed             upiši sve u prozoru kao poslano, ništa ne šalji
//   --dry-run          ispiši što bi poslao, ne diraj ništa
//   --delay S          sekunde između poruka (default 3.5)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FETCH_REPO = process.env.FETCH_REPO || join(homedir(), "git", "domovinatv", "fetch.domovina.tv");
const OUTPUT_DIR = join(FETCH_REPO, "storage", "output");
const REGISTRY = join(FETCH_REPO, "data", "podcasts_registry.json");
const PROVISION_DIR = join(REPO, "scripts", "provision");
const STATE_FILE = process.env.SHARE_STATE_FILE || join(REPO, ".state", "shared.json");

const BASE = (process.env.TELEGRAM_BASE || "https://telegram.domovina.ai").replace(/\/$/, "");
const CDN_BASE = (process.env.CDN_BASE || "https://cdn.domovina.ai").replace(/\/$/, "");

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string): string | null => {
  const index = argv.indexOf(name);
  return index !== -1 && index + 1 < argv.length ? argv[index + 1]! : null;
};

const HOURS = Number(option("--hours") ?? 30);
const LIMIT = Number(option("--limit") ?? 10);
const ONLY_ID = option("--id");
const PROVISION = flag("--provision");
const SEED = flag("--seed");
const DRY_RUN = flag("--dry-run");
// Kanal prima ~20 poruka u minuti od jednog bota; 3,5 s ostaje ispod toga.
const DELAY_MS = Number(option("--delay") ?? 3.5) * 1000;

// ─── stanje ───────────────────────────────────────────────────────────────

interface EpisodeState {
  at: string;
  channel: string;
  header: boolean;
  sent: number[];
  /** Sva poglavlja su u kanalu; epizoda se više ne gleda. */
  done: boolean;
}
interface State {
  version: 1;
  episodes: Record<string, EpisodeState>;
}

function readState(): State {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as State;
    if (parsed?.episodes) return parsed;
  } catch {
    // nema stanja = ništa još nije poslano; prozor i --limit ograničavaju štetu
  }
  return { version: 1, episodes: {} };
}

function writeState(state: State): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// ─── registry (pristanak) ─────────────────────────────────────────────────

interface Podcast {
  slug: string;
  name: string;
}

/** Podcasti s pristankom, po YouTube channel_id-u. */
function optedIn(): Map<string, Podcast> {
  const map = new Map<string, Podcast>();
  const registry = JSON.parse(readFileSync(REGISTRY, "utf-8")) as {
    podcasts?: Array<{
      slug?: string;
      display_name?: string;
      youtube?: { channel_id?: string };
      telegram?: { opt_in?: string | boolean };
    }>;
  };
  for (const p of registry.podcasts ?? []) {
    const id = p.youtube?.channel_id;
    if (id && p.slug && p.telegram?.opt_in) map.set(id, { slug: p.slug, name: p.display_name || p.slug });
  }
  return map;
}

// ─── epizode s diska ──────────────────────────────────────────────────────

interface Episode {
  id: string;
  youtubeChannelId: string;
  title: string;
  abstract: string;
  summaryMtime: number;
}

/** Zadnji `_yt_` pobjeđuje: naslovi znaju sadržavati taj niz. */
function extractVideoId(base: string): string | null {
  const match = base.match(/.*_yt_([A-Za-z0-9_-]{11})(?:[._]|$)/);
  return match ? match[1]! : null;
}

/**
 * Epizode u prozoru čiji podcast ima pristanak. Kanal se čita iz yt-dlp
 * info.json (channel_id), jer Tier 2 epizode žive u `_unlisted/` gdje slug
 * direktorija ne kaže ništa o podcastu.
 */
function findEpisodes(podcasts: Map<string, Podcast>): Episode[] {
  if (!existsSync(OUTPUT_DIR)) throw new Error(`nema ${OUTPUT_DIR}; postavi FETCH_REPO`);
  const cutoff = Date.now() - HOURS * 3_600_000;
  const found: Episode[] = [];

  for (const entry of readdirSync(OUTPUT_DIR)) {
    const dir = join(OUTPUT_DIR, entry);
    let files: string[];
    try {
      // kanali su symlinkovi na vanjski disk: statSync ih slijedi
      if (!statSync(dir).isDirectory()) continue;
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".wav.canary.summary.json")) continue;
      if (ONLY_ID && !file.includes(`_yt_${ONLY_ID}`)) continue;
      const path = join(dir, file);
      const mtime = statSync(path).mtimeMs;
      if (!ONLY_ID && mtime < cutoff) continue;

      const base = file.replace(/\.wav\.canary\.summary\.json$/, "");
      const id = extractVideoId(base);
      if (!id) continue;
      if (!files.some((name) => name.startsWith(base) && name.endsWith(".article.json"))) continue;

      let channelId: string | undefined;
      try {
        channelId = (JSON.parse(readFileSync(join(dir, `${base}.info.json`), "utf-8")) as { channel_id?: string }).channel_id;
      } catch {
        continue;
      }
      if (!channelId || !podcasts.has(channelId)) continue;

      let summary: { summary?: { title_hr?: string; abstract_hr?: string }; source?: { title?: string } } = {};
      try {
        summary = JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        continue;
      }
      found.push({
        id,
        youtubeChannelId: channelId,
        title: summary.summary?.title_hr || summary.source?.title || base,
        abstract: summary.summary?.abstract_hr ?? "",
        summaryMtime: mtime,
      });
    }
  }
  // najstarije prvo: kanal čita kronološki
  return found.sort((a, b) => a.summaryMtime - b.summaryMtime);
}

// ─── CDN ──────────────────────────────────────────────────────────────────

interface Chapter {
  sec: number;
  title: string;
}

function toSeconds(stamp: unknown): number | null {
  if (typeof stamp !== "string" || !/^\d+(:\d+){0,2}$/.test(stamp.trim())) return null;
  const parts = stamp.trim().split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts as [number, number, number];
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

/**
 * Poglavlja kakva ih ima živa stranica: svaka sekcija svake iteracije po
 * screenshot_timestampu, sortirano, duplikat sekunde preskočen. Ista pravila
 * kao extractChapters u fetch.domovina.tv/share_to_whatsapp.js.
 * null = epizoda još nije na CDN-u.
 */
async function fetchChapters(id: string): Promise<Chapter[] | null> {
  const response = await fetch(`${CDN_BASE}/data/${id}/article.json`).catch(() => null);
  if (!response?.ok) return null;
  const article = (await response.json()) as {
    iterations?: Array<{ sections?: Array<{ subtitle?: string; screenshot_timestamp?: string }> }>;
  };
  const seen = new Set<number>();
  const chapters: Chapter[] = [];
  for (const iteration of article.iterations ?? []) {
    for (const section of iteration.sections ?? []) {
      const sec = toSeconds(section.screenshot_timestamp);
      if (sec === null || seen.has(sec)) continue;
      seen.add(sec);
      chapters.push({ sec, title: (section.subtitle ?? "").trim() });
    }
  }
  return chapters.sort((a, b) => a.sec - b.sec);
}

// ─── Worker ───────────────────────────────────────────────────────────────

function apiToken(): string {
  if (process.env.TELEGRAM_API_TOKEN) return process.env.TELEGRAM_API_TOKEN;
  try {
    const match = readFileSync(join(REPO, ".dev.vars"), "utf-8").match(/^API_TOKEN=(.+)$/m);
    if (match) return match[1]!.trim();
  } catch {
    // pada ispod
  }
  throw new Error("nema API tokena: TELEGRAM_API_TOKEN ili API_TOKEN u .dev.vars");
}

async function post(token: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).catch((error: unknown) => ({ ok: false, status: 0, text: async () => String(error) }));
  return { ok: response.ok, status: response.status, text: response.ok ? "" : (await response.text()).slice(0, 200) };
}

/** true = kanal postoji (ili je upravo stvoren); false = epizoda čeka idući run. */
async function ensureChannel(podcast: Podcast, channelId: string, token: string): Promise<boolean> {
  const response = await fetch(`${BASE}/podcasts/${channelId}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (response?.ok) return true;
  if (!response || response.status !== 404) {
    console.error(`   ❌ Worker nedostupan (${response?.status ?? "mreža"})`);
    return false;
  }
  if (!PROVISION) {
    console.log(`   ⏸️  ${podcast.name} još nema kanal; --provision ga stvara`);
    return false;
  }
  console.log(`   🛠️  stvaram Telegram kanal za ${podcast.name} (${channelId})`);
  const result = spawnSync(
    "npx",
    [
      "tsx",
      "src/create-channel.ts",
      channelId,
      "--title",
      `${podcast.name} · domovina.ai`,
      "--avatar",
      `${CDN_BASE}/registry/avatars/${podcast.slug}.jpg`,
    ],
    { cwd: PROVISION_DIR, encoding: "utf-8", stdio: ["ignore", "ignore", "inherit"], timeout: 180_000 },
  );
  if (result.status !== 0) {
    console.error(`   ❌ provisioner nije uspio (exit ${result.status ?? result.signal})`);
    return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// ─── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const podcasts = optedIn();
  console.log(`📣 ${podcasts.size} podcasta s pristankom za Telegram kanal`);
  if (podcasts.size === 0) return;

  const state = readState();
  const episodes = findEpisodes(podcasts).filter((e) => !state.episodes[e.id]?.done);
  console.log(`📄 ${episodes.length} epizoda za kanale (prozor ${ONLY_ID ? "--id" : `${HOURS}h`})`);

  if (SEED) {
    for (const e of episodes) {
      state.episodes[e.id] = { at: new Date().toISOString(), channel: e.youtubeChannelId, header: true, sent: [], done: true };
    }
    if (!DRY_RUN) writeState(state);
    console.log(`🌱 ${episodes.length} epizoda upisano kao poslano, nijedna poruka.`);
    return;
  }

  const token = DRY_RUN ? "" : apiToken();
  let handled = 0;
  for (const episode of episodes) {
    if (handled >= LIMIT) {
      console.log(`⏹️  limit ${LIMIT}, ostatak idući run`);
      break;
    }
    const podcast = podcasts.get(episode.youtubeChannelId)!;
    console.log(`\n▶️  ${podcast.name} · ${episode.title} (${episode.id})`);

    const chapters = await fetchChapters(episode.id);
    if (!chapters) {
      console.log("   ⏭️  još nije na CDN-u, idući run");
      continue;
    }
    const record: EpisodeState = state.episodes[episode.id] ?? {
      at: new Date().toISOString(),
      channel: episode.youtubeChannelId,
      header: false,
      sent: [],
      done: false,
    };
    const done = new Set(record.sent);
    const todo = chapters.filter((c) => !done.has(c.sec));
    console.log(`   📚 ${chapters.length} poglavlja, ${todo.length} za poslati${record.header ? "" : " + poruka epizode"}`);

    if (DRY_RUN) {
      for (const c of todo.slice(0, 5)) console.log(`      ${c.sec}s · ${c.title}`);
      handled += 1;
      continue;
    }
    if (!(await ensureChannel(podcast, episode.youtubeChannelId, token))) continue;
    handled += 1;

    const path = `/podcasts/${episode.youtubeChannelId}`;
    if (!record.header) {
      const r = await post(token, `${path}/episode`, {
        id: episode.id,
        title: episode.title,
        abstract: episode.abstract,
        chapters: chapters.length,
      });
      if (!r.ok) {
        console.error(`   ❌ poruka epizode (${r.status}): ${r.text}`);
        continue;
      }
      record.header = true;
      state.episodes[episode.id] = record;
      writeState(state);
    }

    let sent = 0;
    for (const chapter of todo) {
      await sleep(DELAY_MS);
      const r = await post(token, `${path}/chapter`, { id: episode.id, ...chapter });
      if (!r.ok) {
        // stani na prvoj grešci: idući run nastavlja bez rupa u nizu
        console.error(`   ❌ poglavlje ${chapter.sec}s (${r.status}): ${r.text}`);
        break;
      }
      record.sent.push(chapter.sec);
      record.at = new Date().toISOString();
      state.episodes[episode.id] = record;
      writeState(state);
      sent += 1;
    }
    record.done = record.sent.length >= chapters.length;
    state.episodes[episode.id] = record;
    writeState(state);
    console.log(`   ✅ ${sent}/${todo.length} poglavlja u kanalu`);
  }
  console.log(`\n🧾 Gotovo: ${handled} epizoda${DRY_RUN ? " (dry run)" : ""}.`);
}

main().catch((error) => {
  console.error(`❌ ${String(error)}`);
  process.exit(1);
});
