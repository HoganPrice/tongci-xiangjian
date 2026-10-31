import mqtt from "mqtt";
import {
  addOrReconnectPlayer,
  beginNextRound,
  createRoom,
  removeNonHostPlayers,
  removePlayer,
  rematch,
  revealRound,
  sanitizeCode,
  setPlayerOnline,
  startGame,
  submitWord,
  toPublicRoom,
  touchPlayer,
} from "./game.js";

const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
const TOPIC_PREFIX = "tongci-xiangjian/v1";
const HEARTBEAT_MS = 6000;
const HOST_STATE_HEARTBEAT_MS = 9000;
const PLAYER_TIMEOUT_MS = 19000;
const HOST_TIMEOUT_MS = 22000;

function randomId(prefix) {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random.replace(/-/g, "").slice(0, 24)}`;
}

function parseMessage(buffer) {
  try {
    return JSON.parse(buffer.toString());
  } catch {
    return null;
  }
}

export class RoomClient {
  constructor({
    code,
    role,
    player,
    durationSec = 45,
    initialHostRoom = null,
    onState,
    onConnection,
    onNotice,
    onHostRoom,
    onFatal,
  }) {
    this.code = sanitizeCode(code);
    this.role = role;
    this.player = player;
    this.onState = onState;
    this.onConnection = onConnection;
    this.onNotice = onNotice;
    this.onHostRoom = onHostRoom;
    this.onFatal = onFatal;
    this.eventTopic = `${TOPIC_PREFIX}/${this.code}/events`;
    this.stateTopic = `${TOPIC_PREFIX}/${this.code}/state`;
    this.client = null;
    this.brokerConnected = false;
    this.closed = false;
    this.seq = 0;
    this.lastStateSeq = -1;
    this.lastStateAt = 0;
    this.lastGuestHeartbeatAt = 0;
    this.lastHostHeartbeatAt = 0;
    this.lastPresenceCheck = 0;
    this.reconnectNotified = false;
    this.room =
      role === "host"
        ? initialHostRoom ??
          createRoom({
            code: this.code,
            hostId: player.id,
            hostName: player.name,
            durationSec,
          })
        : null;

    if (role === "host") {
      this.persistHostRoom();
      this.publishLocalState();
    }

    this.tickTimer = window.setInterval(() => this.tick(), 500);
  }

  connect() {
    if (this.closed || this.client) return;
    this.onConnection?.("connecting");

    this.client = mqtt.connect(BROKER_URL, {
      protocolVersion: 4,
      clientId: randomId("tc"),
      clean: true,
      keepalive: 30,
      connectTimeout: 12000,
      reconnectPeriod: 1800,
      resubscribe: true,
    });

    this.client.on("connect", () => {
      if (this.closed) return;
      this.brokerConnected = true;
      this.reconnectNotified = false;
      this.client.subscribe([this.eventTopic, this.stateTopic], { qos: 0 });

      if (this.role === "host") {
        this.onConnection?.("online");
        this.publishState();
      } else {
        this.onConnection?.("connecting");
        this.sendGuestEvent("join");
        window.setTimeout(() => this.sendGuestEvent("join"), 900);
        window.setTimeout(() => this.sendGuestEvent("join"), 2600);
      }
    });

    this.client.on("reconnect", () => {
      if (!this.closed) this.onConnection?.("connecting");
    });

    this.client.on("offline", () => {
      this.brokerConnected = false;
      if (!this.closed) this.onConnection?.("offline");
    });

    this.client.on("error", () => {
      if (!this.closed) this.onConnection?.("offline");
    });

    this.client.on("message", (topic, buffer) => {
      const message = parseMessage(buffer);
      if (!message || message.room !== this.code || message.senderId === this.player.id) return;

      if (this.role === "host" && topic === this.eventTopic) {
        this.handleGuestEvent(message);
      }
      if (this.role === "guest" && topic === this.stateTopic) {
        this.handleHostState(message);
      }
      if (this.role === "guest" && topic === this.eventTopic) {
        this.handleHostEvent(message);
      }
    });
  }

  publishLocalState() {
    if (!this.room) return;
    this.onState?.(toPublicRoom(this.room));
    this.persistHostRoom();
  }

  persistHostRoom() {
    if (this.role === "host" && this.room) {
      this.onHostRoom?.(this.room);
    }
  }

  publishState() {
    if (this.role !== "host" || !this.room || !this.brokerConnected || this.closed) return;
    this.seq += 1;
    const packed = {
      type: "state",
      room: this.code,
      senderId: this.player.id,
      senderRole: "host",
      seq: this.seq,
      sentAt: Date.now(),
      state: toPublicRoom(this.room),
    };
    this.client.publish(this.stateTopic, JSON.stringify(packed), { qos: 0, retain: false });
    this.publishLocalState();
  }

  updateHostRoom(nextRoom, { publish = true } = {}) {
    if (this.role !== "host") return;
    this.room = nextRoom;
    if (publish) {
      this.publishState();
    } else {
      this.publishLocalState();
    }
  }

  handleGuestEvent(message) {
    if (message.senderRole !== "guest" && message.type !== "join") return;
    const payload = message.payload ?? {};

    if (message.type === "join") {
      if (!payload.player?.id || !payload.player?.name) return;
      const result = addOrReconnectPlayer(this.room, payload.player);
      if (!result.accepted) {
        this.sendHostEvent("rejected", message.senderId, {
          message: result.reason || "暂时无法加入这个房间",
        });
        return;
      }
      this.lastGuestHeartbeatAt = Date.now();
      this.updateHostRoom(result.room);
      return;
    }

    if (message.type === "heartbeat") {
      this.lastGuestHeartbeatAt = Date.now();
      const guest = this.room.players.find((item) => item.id === message.senderId);
      if (guest && !guest.online) {
        this.updateHostRoom(touchPlayer(this.room, message.senderId));
      } else {
        this.room = touchPlayer(this.room, message.senderId);
      }
      return;
    }

    if (message.type === "leave") {
      this.updateHostRoom(removePlayer(this.room, message.senderId));
      return;
    }

    if (message.type === "submit") {
      if (payload.round !== this.room.round) return;
      const result = submitWord(this.room, message.senderId, payload.word);
      if (!result.accepted) return;
      this.updateHostRoom(result.room);
    }
  }

  handleHostState(message) {
    if (!message.state || !Number.isFinite(message.seq)) return;
    if (message.seq < this.lastStateSeq) return;

    this.lastStateSeq = message.seq;
    this.lastStateAt = Date.now();
    this.reconnectNotified = false;
    this.room = message.state;
    this.onState?.(message.state);
    this.onConnection?.("online");
  }

  handleHostEvent(message) {
    const isForThisGuest = message.targetId === this.player.id || message.targetId === "*";
    if (!isForThisGuest) return;
    if (message.type === "rejected") {
      this.onFatal?.(message.payload?.message || "这个房间暂时进不去");
      this.close();
    }
    if (message.type === "closed") {
      this.onFatal?.(message.payload?.message || "房主已经关闭了房间");
      this.close();
    }
  }

  sendGuestEvent(type, payload = {}) {
    if (this.role !== "guest" || !this.brokerConnected || this.closed) return false;
    this.client.publish(
      this.eventTopic,
      JSON.stringify({
        type,
        room: this.code,
        senderId: this.player.id,
        senderRole: "guest",
        sentAt: Date.now(),
        payload:
          type === "join"
            ? { ...payload, player: this.player }
            : payload,
      }),
      { qos: 0, retain: false },
    );
    return true;
  }

  sendHostEvent(type, targetId, payload = {}) {
    if (this.role !== "host" || !this.brokerConnected) return;
    this.client.publish(
      this.eventTopic,
      JSON.stringify({
        type,
        room: this.code,
        senderId: this.player.id,
        senderRole: "host",
        targetId,
        sentAt: Date.now(),
        payload,
      }),
      { qos: 0, retain: false },
    );
  }

  startGame() {
    if (this.role !== "host") return false;
    const result = startGame(this.room);
    if (!result.accepted) {
      this.onNotice?.(result.reason);
      return false;
    }
    this.updateHostRoom(result.room);
    return true;
  }

  submit(word) {
    if (!this.room || this.room.phase !== "playing") return false;

    if (this.role === "host") {
      const result = submitWord(this.room, this.player.id, word);
      if (!result.accepted) {
        this.onNotice?.(result.reason);
        return false;
      }
      this.updateHostRoom(result.room);
      return true;
    }

    if (!this.brokerConnected) {
      this.onNotice?.("网络还没连上，稍等一下再写");
      return false;
    }
    return this.sendGuestEvent("submit", {
      word,
      round: this.room.round,
    });
  }

  playAgain() {
    if (this.role !== "host") return;
    this.updateHostRoom(rematch(this.room));
  }

  resetToWaiting() {
    if (this.role !== "host") return;
    this.updateHostRoom(removeNonHostPlayers(this.room));
  }

  tick() {
    if (this.closed || !this.room) return;
    const now = Date.now();

    if (this.role === "host") {
      if (this.room.phase === "playing" && now >= this.room.roundEndsAt) {
        this.updateHostRoom(revealRound(this.room, now).room);
      } else if (this.room.phase === "reveal" && now >= this.room.revealEndsAt) {
        this.updateHostRoom(beginNextRound(this.room, now).room);
      }

      if (now - this.lastHostHeartbeatAt > HOST_STATE_HEARTBEAT_MS) {
        this.lastHostHeartbeatAt = now;
        this.publishState();
      }

      if (now - this.lastPresenceCheck > 4000) {
        this.lastPresenceCheck = now;
        const guest = this.room.players.find((item) => item.id !== this.room.hostId);
        if (guest?.online && now - guest.lastSeen > PLAYER_TIMEOUT_MS) {
          this.updateHostRoom(setPlayerOnline(this.room, guest.id, false, now));
        }
      }
      return;
    }

    if (this.brokerConnected && now - this.lastGuestHeartbeatAt > HEARTBEAT_MS) {
      this.lastGuestHeartbeatAt = now;
      this.sendGuestEvent("heartbeat");
    }

    if (this.lastStateAt && now - this.lastStateAt > HOST_TIMEOUT_MS && !this.reconnectNotified) {
      this.reconnectNotified = true;
      this.onConnection?.("unstable");
    }
  }

  leave() {
    if (this.closed) return;
    if (!this.client || !this.brokerConnected) {
      this.close();
      return;
    }

    const message =
      this.role === "guest"
        ? {
            type: "leave",
            room: this.code,
            senderId: this.player.id,
            senderRole: "guest",
            sentAt: Date.now(),
            payload: {},
          }
        : {
            type: "closed",
            room: this.code,
            senderId: this.player.id,
            senderRole: "host",
            targetId: "*",
            sentAt: Date.now(),
            payload: { message: "房主已经关闭了房间" },
          };

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.close();
    };
    const fallback = window.setTimeout(finish, 1200);
    this.client.publish(
      this.eventTopic,
      JSON.stringify(message),
      { qos: 1, retain: false },
      () => {
        window.clearTimeout(fallback);
        finish();
      },
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.tickTimer);
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.brokerConnected = false;
  }
}
