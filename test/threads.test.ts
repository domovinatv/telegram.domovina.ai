import { describe, expect, it } from "vitest";
import { chapterWord, episodeMessage } from "../src/messages";
import { threadFromUpdate } from "../src/threads";

const CHANNEL = -1001111111111;
const GROUP = -1002222222222;

describe("threadFromUpdate", () => {
  it("hvata automatski proslijeđenu objavu kanala (forward_origin)", () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 77,
        chat: { id: GROUP, type: "supergroup" },
        sender_chat: { id: CHANNEL, type: "channel" },
        is_automatic_forward: true,
        forward_origin: { type: "channel", chat: { id: CHANNEL }, message_id: 12 },
      },
    };
    expect(threadFromUpdate(update)).toEqual({
      channelChatId: String(CHANNEL),
      channelMessageId: 12,
      root: { chatId: String(GROUP), messageId: 77 },
    });
  });

  it("radi i sa starim poljima forward_from_*", () => {
    const update = {
      message: {
        message_id: 5,
        chat: { id: GROUP },
        is_automatic_forward: true,
        forward_from_chat: { id: CHANNEL },
        forward_from_message_id: 3,
      },
    };
    expect(threadFromUpdate(update)?.channelMessageId).toBe(3);
  });

  it("ignorira obične poruke i komentare", () => {
    expect(threadFromUpdate({ message: { message_id: 9, chat: { id: GROUP }, text: "bok" } })).toBeNull();
    expect(threadFromUpdate({ edited_message: {} })).toBeNull();
    expect(threadFromUpdate(null)).toBeNull();
  });
});

describe("episodeMessage", () => {
  it("kaže gdje su poglavlja", () => {
    expect(episodeMessage("abc", "Naslov", "", 46, true)).toContain("46 poglavlja u komentarima ispod objave.");
    expect(episodeMessage("abc", "Naslov", "", 46)).toContain("46 poglavlja slijedi u nastavku.");
    expect(episodeMessage("abc", "Naslov", "", 0, true)).not.toContain("komentarima");
  });

  it("sklanja riječ poglavlje", () => {
    expect([1, 2, 5, 11, 21, 101, 111].map(chapterWord)).toEqual([
      "poglavlje", "poglavlja", "poglavlja", "poglavlja", "poglavlje", "poglavlje", "poglavlja",
    ]);
  });
});
