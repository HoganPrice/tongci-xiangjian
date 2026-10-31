import { describe, expect, it } from "vitest";
import {
  addOrReconnectPlayer,
  beginNextRound,
  createRoom,
  normalizeWord,
  sanitizeWord,
  startGame,
  submitWord,
  toPublicRoom,
} from "../src/game.js";

function makeRoom() {
  let room = createRoom({
    code: "ABC234",
    hostId: "host",
    hostName: "小林",
    durationSec: 45,
    now: 1000,
  });
  room = addOrReconnectPlayer(
    room,
    { id: "guest", name: "小周" },
    1100,
  ).room;
  room = startGame(room, 1200).room;
  return room;
}

describe("word normalization", () => {
  it("normalizes width, case and whitespace", () => {
    expect(normalizeWord("  ＨＥＬＬＯ  World ")).toBe("helloworld");
  });

  it("preserves long input without truncation", () => {
    const word = "一二三四五六七八九十十一十二十三十四";
    expect(sanitizeWord(word)).toBe(word);
  });
});

describe("game flow", () => {
  it("does not reveal a word while the other player is still writing", () => {
    const submitted = submitWord(makeRoom(), "host", "月亮", 1500);
    const publicRoom = toPublicRoom(submitted.room, 1600);

    expect(submitted.room.phase).toBe("playing");
    expect(publicRoom.players.find((player) => player.id === "host").submitted).toBe(true);
    expect(publicRoom.history).toHaveLength(0);
    expect(JSON.stringify(publicRoom)).not.toContain("月亮");
  });

  it("reveals both words after both players submit", () => {
    let room = submitWord(makeRoom(), "host", "月亮", 1500).room;
    room = submitWord(room, "guest", "晚风", 1600).room;

    expect(room.phase).toBe("reveal");
    expect(room.history).toHaveLength(1);
    expect(room.history[0].words.map((item) => item.word)).toEqual(["月亮", "晚风"]);
  });

  it("wins on the exact same normalized word", () => {
    let room = submitWord(makeRoom(), "host", "晚风", 1500).room;
    room = submitWord(room, "guest", " 晚 风 ", 1600).room;

    expect(room.phase).toBe("won");
    expect(room.winnerWord).toBe("晚风");
    expect(room.history[0].match).toBe(true);
  });

  it("moves to the next round after a miss", () => {
    let room = submitWord(makeRoom(), "host", "海", 1500).room;
    room = submitWord(room, "guest", "山", 1600).room;
    room = beginNextRound(room, 7000).room;

    expect(room.phase).toBe("playing");
    expect(room.round).toBe(2);
    expect(room.submitted).toEqual({});
  });

  it("allows only two players", () => {
    const room = makeRoom();
    const result = addOrReconnectPlayer(room, { id: "third", name: "第三人" }, 2000);

    expect(result.accepted).toBe(false);
    expect(result.room.players).toHaveLength(2);
  });
});
