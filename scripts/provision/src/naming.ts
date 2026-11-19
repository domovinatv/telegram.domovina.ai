// Pravilo imenovanja Telegram kanala i grupe podcasta (19. 11. 2026.).
//
// Lista chatova na mobitelu prikaže ~24 znaka naslova, pa je naslov kratak:
// ime podcasta prvo, jezik zastavicom, uloga grupe jednom riječju. Ime
// domovina.ai NIJE u naslovu (bilo je „DOMOVINA · domovina.ai En…”): stoji u
// opisu kanala, u imenu bota i u svakom linku.
//
//   kanal  „<Podcast> 🇭🇷”              grupa „<Podcast> 🇭🇷 · rasprava”
//   kanal  „<Podcast> 🇬🇧”              grupa „<Podcast> 🇬🇧 · discussion”
//
// Jedino mjesto s ovim pravilom: create-channel i rename-channel ga oba uvoze.

export type Lang = "hr" | "en";

const FLAG: Record<Lang, string> = { hr: "🇭🇷", en: "🇬🇧" };
const DISCUSSION: Record<Lang, string> = { hr: "rasprava", en: "discussion" };

export const ABOUT: Record<Lang, string> = {
  hr: "domovina.ai · svaka nova epizoda, poglavlja u komentarima: svaki link vodi točno na trenutak u snimci.",
  en: "domovina.ai · every new episode in English, chapters in the comments: each link opens the exact moment in the recording.",
};

/** Naslov iznad kojeg lista chatova na mobitelu počne rezati. */
export const VISIBLE_TITLE = 24;

export function chatTitles(podcastName: string, lang: Lang): { channel: string; discussion: string } {
  const name = podcastName.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("ime podcasta je prazno");
  if (/domovina\.ai/i.test(name)) throw new Error(`--name je ime podcasta, bez „domovina.ai” (dobio „${name}”)`);
  const channel = `${name} ${FLAG[lang]}`;
  return { channel, discussion: `${channel} · ${DISCUSSION[lang]}` };
}

export function parseLang(value: unknown): Lang | null {
  const v = String(value ?? "hr");
  return v === "hr" || v === "en" ? v : null;
}
