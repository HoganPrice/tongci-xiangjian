export const DURATION_OPTIONS = [30, 45, 60];
export const ROOM_CODE_LENGTH = 6;
export const REVEAL_MS = 5000;

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoomCode(random = Math.random) {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_CHARS[Math.floor(random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export function sanitizeCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

export function sanitizeWord(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeWord(value) {
  return sanitizeWord(value).replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

export function createRoom({ code, hostId, hostName, durationSec = 45, now = Date.now() }) {
  return {
    code,
    hostId,
    durationSec,
    createdAt: now,
    updatedAt: now,
    phase: "waiting",
    round: 1,
    roundStartedAt: null,
    roundEndsAt: null,
    revealEndsAt: null,
    players: [
      {
        id: hostId,
        name: hostName,
        role: "host",
        online: true,
        lastSeen: now,
      },
    ],
    submitted: {},
    history: [],
    winnerWord: "",
  };
}

export function addOrReconnectPlayer(room, player, now = Date.now()) {
  const existing = room.players.find((item) => item.id === player.id);

  if (existing) {
    return {
      room: {
        ...room,
        updatedAt: now,
        players: room.players.map((item) =>
          item.id === player.id
            ? { ...item, name: player.name || item.name, online: true, lastSeen: now }
            : item,
        ),
      },
      accepted: true,
    };
  }

  if (room.players.length >= 2) {
    return { room, accepted: false, reason: "房间已经坐满两个人了" };
  }

  return {
    room: {
      ...room,
      updatedAt: now,
      players: [
        ...room.players,
        {
          id: player.id,
          name: player.name,
          role: "guest",
          online: true,
          lastSeen: now,
        },
      ],
    },
    accepted: true,
  };
}

export function setPlayerOnline(room, playerId, online, now = Date.now()) {
  return {
    ...room,
    updatedAt: now,
    players: room.players.map((player) =>
      player.id === playerId ? { ...player, online, lastSeen: online ? now : player.lastSeen } : player,
    ),
  };
}

export function touchPlayer(room, playerId, now = Date.now()) {
  return {
    ...room,
    updatedAt: now,
    players: room.players.map((player) =>
      player.id === playerId
        ? { ...player, online: true, lastSeen: now }
        : player,
    ),
  };
}

export function startGame(room, now = Date.now()) {
  if (room.players.length !== 2) {
    return { room, accepted: false, reason: "还需要一位朋友加入" };
  }

  return {
    room: {
      ...room,
      phase: "playing",
      round: 1,
      roundStartedAt: now,
      roundEndsAt: now + room.durationSec * 1000,
      revealEndsAt: null,
      submitted: {},
      history: [],
      winnerWord: "",
      updatedAt: now,
    },
    accepted: true,
  };
}

export function submitWord(room, playerId, rawWord, now = Date.now()) {
  if (room.phase !== "playing") {
    return { room, accepted: false, reason: "现在不在写词阶段" };
  }

  const player = room.players.find((item) => item.id === playerId);
  if (!player) {
    return { room, accepted: false, reason: "你不在这个房间里" };
  }

  const word = sanitizeWord(rawWord);
  if (!word) {
    return { room, accepted: false, reason: "先写下一个词" };
  }

  if (room.submitted[playerId]) {
    return { room, accepted: false, reason: "这一轮已经写过了" };
  }

  const nextRoom = {
    ...room,
    submitted: { ...room.submitted, [playerId]: word },
    updatedAt: now,
    players: room.players.map((item) =>
      item.id === playerId ? { ...item, online: true, lastSeen: now } : item,
    ),
  };

  const everyoneSubmitted = room.players.every((item) => Boolean(nextRoom.submitted[item.id]));
  return {
    room: everyoneSubmitted ? revealRound(nextRoom, now).room : nextRoom,
    accepted: true,
    revealed: everyoneSubmitted,
  };
}

export function revealRound(room, now = Date.now()) {
  if (room.phase !== "playing") {
    return { room, accepted: false };
  }

  const words = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    word: room.submitted[player.id] || "",
  }));
  const bothAnswered = words.every((item) => Boolean(normalizeWord(item.word)));
  const match = bothAnswered && normalizeWord(words[0].word) === normalizeWord(words[1].word);
  const roundRecord = {
    round: room.round,
    words,
    match,
    winnerWord: match ? words[0].word : "",
    revealedAt: now,
  };

  return {
    room: {
      ...room,
      phase: match ? "won" : "reveal",
      roundEndsAt: null,
      revealEndsAt: match ? null : now + REVEAL_MS,
      winnerWord: match ? words[0].word : "",
      history: [...room.history, roundRecord],
      updatedAt: now,
    },
    accepted: true,
    match,
  };
}

export function beginNextRound(room, now = Date.now()) {
  if (room.phase !== "reveal") {
    return { room, accepted: false };
  }

  return {
    room: {
      ...room,
      phase: "playing",
      round: room.round + 1,
      roundStartedAt: now,
      roundEndsAt: now + room.durationSec * 1000,
      revealEndsAt: null,
      submitted: {},
      updatedAt: now,
    },
    accepted: true,
  };
}

export function rematch(room, now = Date.now()) {
  if (room.players.length !== 2) {
    return removeNonHostPlayers(room, now);
  }

  return {
    ...room,
    phase: "playing",
    round: 1,
    roundStartedAt: now,
    roundEndsAt: now + room.durationSec * 1000,
    revealEndsAt: null,
    submitted: {},
    history: [],
    winnerWord: "",
    updatedAt: now,
  };
}

export function removePlayer(room, playerId, now = Date.now()) {
  if (playerId === room.hostId) {
    return room;
  }
  return removeNonHostPlayers(
    {
      ...room,
      players: room.players.filter((player) => player.id !== playerId),
    },
    now,
  );
}

export function removeNonHostPlayers(room, now = Date.now()) {
  const host = room.players.find((player) => player.id === room.hostId);
  return {
    ...room,
    phase: "waiting",
    round: 1,
    roundStartedAt: null,
    roundEndsAt: null,
    revealEndsAt: null,
    submitted: {},
    history: [],
    winnerWord: "",
    updatedAt: now,
    players: host ? [{ ...host, online: true, lastSeen: now }] : [],
  };
}

export function toPublicRoom(room, now = Date.now()) {
  return {
    version: 1,
    code: room.code,
    hostId: room.hostId,
    durationSec: room.durationSec,
    phase: room.phase,
    round: room.round,
    updatedAt: room.updatedAt,
    roundRemainingMs:
      room.phase === "playing" && room.roundEndsAt
        ? Math.max(0, room.roundEndsAt - now)
        : 0,
    revealRemainingMs:
      room.phase === "reveal" && room.revealEndsAt
        ? Math.max(0, room.revealEndsAt - now)
        : 0,
    winnerWord: room.winnerWord,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      role: player.role,
      online: player.online,
      submitted: Boolean(room.submitted[player.id]),
    })),
    history: room.history,
  };
}
