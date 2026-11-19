import { describe, expect, it } from "vitest";
import { englishContent } from "../src/episode";
import { chapterMessage, episodeMessage } from "../src/messages";
import { getPodcastChat, parseLang, podcastKey, putPodcastChat } from "../src/podcasts";

const article = {
  iterations: [
    {
      sections: [
        { subtitle: "Drugo", subtitle_en: "Second", screenshot_timestamp: "00:02:15" },
        { subtitle: "Prvo", subtitle_en: "First", screenshot_timestamp: "00:00:35" },
      ],
    },
    { sections: [{ subtitle: "Bez prijevoda", screenshot_timestamp: "00:10:00" }] },
  ],
};
const summary = { summary: { title_hr: "Naslov", title_en: "Title <x>", abstract_hr: "Sažetak.", abstract_en: "Summary." } };

describe("englishContent", () => {
  it("engleski naslovi, hrvatski tekst nikad", () => {
    const c = englishContent(article, summary)!;
    expect(c.title).toBe("Title <x>");
    expect(c.abstract).toBe("Summary.");
    expect(c.chapters).toEqual([
      { sec: 35, title: "First" },
      { sec: 135, title: "Second" },
      { sec: 600, title: "" },
    ]);
  });

  it("bez prijevoda nema sadržaja (Workflow čeka)", () => {
    expect(englishContent(null, summary)).toBeNull();
    expect(englishContent(article, null)).toBeNull();
    expect(englishContent(article, { summary: { title_hr: "Naslov" } })).toBeNull();
    const untranslated = { iterations: [{ sections: [{ subtitle: "Prvo", screenshot_timestamp: "00:00:35" }] }] };
    expect(englishContent(untranslated, summary)).toBeNull();
  });
});

describe("engleske poruke", () => {
  it("engleski tekst i /en rute na domovina.ai", () => {
    const header = episodeMessage("QkcpHsj43rE", "Title", "Summary.", 42, true, "en");
    expect(header).toContain("42 chapters in the comments below. Full episode: https://domovina.ai/v/QkcpHsj43rE/en");
    expect(episodeMessage("abc", "T", "", 1, true, "en")).toContain("1 chapter in the comments below.");
    expect(header).not.toMatch(/youtu|poglavlj/);
    expect(chapterMessage("QkcpHsj43rE", 135, "Second", "en")).toBe("⏱ <b>2:15</b> · Second\nhttps://domovina.ai/v/QkcpHsj43rE/t/135/en");
  });

  it("hrvatski ostaje kakav je bio", () => {
    expect(chapterMessage("abc", 135, "Drugo")).toBe("⏱ <b>2:15</b> · Drugo\nhttps://domovina.ai/v/abc/t/135");
  });
});

class MemoryKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.data.get(key);
    return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
}

const UC = "UCXXhnehl2pss0uYdfLRDtyw";
const hrBody = { chatId: "-1003930493648", discussionChatId: "-1004444601313", link: "https://t.me/+hr", title: "DOMOVINA · domovina.ai" };
const enBody = { chatId: "-1005555555555", discussionChatId: "-1006666666666", link: "https://t.me/+en", title: "DOMOVINA · domovina.ai English" };

describe("mapiranje po jeziku", () => {
  it("HR ključ ostaje stari, EN je zaseban", async () => {
    expect(podcastKey(UC)).toBe(`tg:podcast:${UC}`);
    expect(podcastKey(UC, "en")).toBe(`tg:podcast:${UC}:en`);
    const kv = new MemoryKV() as unknown as KVNamespace;
    await putPodcastChat(kv, UC, hrBody);
    expect(await getPodcastChat(kv, UC, "en")).toBeNull();
    const en = await putPodcastChat(kv, UC, enBody, "en");
    expect(typeof en).not.toBe("string");
    expect((await getPodcastChat(kv, UC, "en"))?.chatId).toBe(enBody.chatId);
    expect((await getPodcastChat(kv, UC))?.chatId).toBe(hrBody.chatId);
  });

  it("stari HR zapis bez lang polja čita se kao hr", async () => {
    const kv = new MemoryKV();
    kv.data.set(podcastKey(UC), JSON.stringify({ ...hrBody, youtubeChannelId: UC, createdAt: "2026-11-19" }));
    expect((await getPodcastChat(kv as unknown as KVNamespace, UC))?.lang).toBe("hr");
  });

  it("isti Telegram kanal ne može biti i HR i EN", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await putPodcastChat(kv, UC, hrBody);
    expect(await putPodcastChat(kv, UC, { ...enBody, chatId: hrBody.chatId }, "en")).toMatch(/već hr kanal/);
    expect(await putPodcastChat(kv, UC, { ...enBody, lang: "hr" }, "en")).toMatch(/ne odgovara/);
  });

  it("parseLang", () => {
    expect(parseLang(null)).toBe("hr");
    expect(parseLang("")).toBe("hr");
    expect(parseLang("en")).toBe("en");
    expect(parseLang("de")).toBeNull();
  });
});
