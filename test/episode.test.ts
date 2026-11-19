import { describe, expect, it } from "vitest";
import { episodeContent, toSeconds } from "../src/episode";
import { chapterMessage, clock, episodeMessage } from "../src/messages";

const bundle = {
  inline: {
    "summary.json": { summary: { title_hr: "Naslov <epizode>", abstract_hr: "Sažetak." } },
    "info.json": { channel_id: "UCoCKZ9-VK2qVHSwce7FDBFA", title: "Original" },
    "article.json": {
      iterations: [
        { sections: [{ subtitle: "Drugo", screenshot_timestamp: "00:02:15" }, { subtitle: "Prvo", screenshot_timestamp: "00:00:35" }] },
        { sections: [{ subtitle: "Duplikat", screenshot_timestamp: "02:15" }, { subtitle: "Krivo", screenshot_timestamp: "00:61:00" }] },
        { sections: [{ subtitle: "Bez vremena" }, { subtitle: "Sat", screenshot_timestamp: "1:00:00" }] },
      ],
    },
  },
};

describe("episodeContent", () => {
  it("poglavlja sortirana, duplikat sekunde i krivo vrijeme preskočeni", () => {
    const c = episodeContent(bundle)!;
    expect(c.chapters).toEqual([
      { sec: 35, title: "Prvo" },
      { sec: 135, title: "Drugo" },
      { sec: 3600, title: "Sat" },
    ]);
    expect(c.title).toBe("Naslov <epizode>");
    expect(c.youtubeChannelId).toBe("UCoCKZ9-VK2qVHSwce7FDBFA");
  });

  it("bez članka nema objave", () => {
    expect(episodeContent({ inline: {} })).toBeNull();
    expect(episodeContent(null)).toBeNull();
  });

  it("neispravan channel_id je null", () => {
    const c = episodeContent({ inline: { ...bundle.inline, "info.json": { channel_id: "@handle" } } })!;
    expect(c.youtubeChannelId).toBeNull();
  });

  it("toSeconds", () => {
    expect(toSeconds("35")).toBe(35);
    expect(toSeconds("1:02:03")).toBe(3723);
    expect(toSeconds("x")).toBeNull();
  });
});

describe("poruke", () => {
  it("svi linkovi vode na domovina.ai, HTML escapiran", () => {
    const header = episodeMessage("nP0mdQb5n-Q", "A <b>", "Sažetak", 3);
    expect(header).toContain("A &lt;b&gt;");
    expect(header).toContain("https://domovina.ai/v/nP0mdQb5n-Q");
    expect(header).not.toMatch(/youtu/);
    expect(chapterMessage("nP0mdQb5n-Q", 135, "Drugo")).toBe("⏱ <b>2:15</b> · Drugo\nhttps://domovina.ai/v/nP0mdQb5n-Q/t/135");
    expect(clock(3723)).toBe("1:02:03");
  });
});
