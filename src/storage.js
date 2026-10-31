const NAME_KEY = "tongci.name";
const PLAYER_KEY = "tongci.playerId";
const HOST_ROOM_PREFIX = "tongci.hostRoom.";
const GUEST_SESSION_PREFIX = "tongci.guestSession.";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function read(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The game still works for the current tab when storage is unavailable.
  }
}

function remove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function readJson(key) {
  try {
    return JSON.parse(read(key) || "null");
  } catch {
    return null;
  }
}

export function getPlayerId() {
  const existing = read(PLAYER_KEY);
  if (existing) return existing;
  const playerId =
    globalThis.crypto?.randomUUID?.() ??
    `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  write(PLAYER_KEY, playerId);
  return playerId;
}

export function getSavedName() {
  return read(NAME_KEY) || "";
}

export function saveName(name) {
  write(NAME_KEY, name);
}

export function saveHostRoom(room) {
  write(
    `${HOST_ROOM_PREFIX}${room.code}`,
    JSON.stringify({ savedAt: Date.now(), room }),
  );
}

export function loadHostRoom(code) {
  const payload = readJson(`${HOST_ROOM_PREFIX}${code}`);
  if (!payload?.room || Date.now() - payload.savedAt > MAX_AGE_MS) {
    remove(`${HOST_ROOM_PREFIX}${code}`);
    return null;
  }
  return payload.room;
}

export function removeHostRoom(code) {
  remove(`${HOST_ROOM_PREFIX}${code}`);
}

export function saveGuestSession(code, player) {
  write(
    `${GUEST_SESSION_PREFIX}${code}`,
    JSON.stringify({ savedAt: Date.now(), player }),
  );
}

export function loadGuestSession(code) {
  const payload = readJson(`${GUEST_SESSION_PREFIX}${code}`);
  if (!payload?.player || Date.now() - payload.savedAt > MAX_AGE_MS) {
    remove(`${GUEST_SESSION_PREFIX}${code}`);
    return null;
  }
  return payload.player;
}

export function removeGuestSession(code) {
  remove(`${GUEST_SESSION_PREFIX}${code}`);
}
