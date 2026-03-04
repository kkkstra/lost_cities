import { WebSocketServer } from "ws";
import { createRoom, addPlayer, removePlayer, roomStateFor, gameStateFor, handleAction, reconnectPlayer, pruneRoom, restartRoom } from "./room.js";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
const RECONNECT_TTL_MS = 60_000;

const rooms = new Map();
const socketToPlayer = new Map();

function send(socket, type, payload) {
  socket.send(JSON.stringify({ type, payload }));
}

function broadcastRoom(room) {
  for (const player of room.players) {
    const socket = room.sockets.get(player.id);
    if (!socket || socket.readyState !== socket.OPEN) continue;
    send(socket, "room:state", roomStateFor(room, player.id));
    send(socket, "game:state", gameStateFor(room, player.id));
  }
}

function broadcastEvent(room, type, payload) {
  for (const player of room.players) {
    const socket = room.sockets.get(player.id);
    if (!socket || socket.readyState !== socket.OPEN) continue;
    send(socket, type, payload);
  }
}

function getRoom(code) {
  if (!code || typeof code !== "string") return undefined;
  return rooms.get(code.toUpperCase());
}

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      send(socket, "error", { message: "Invalid JSON" });
      return;
    }

    const { type, payload } = msg || {};
    if (type === "room:create") {
      let room = createRoom(payload?.roundsTotal);
      while (rooms.has(room.code)) {
        room = createRoom(payload?.roundsTotal);
      }
      rooms.set(room.code, room);
      const { ok, player, token, error } = addPlayer(room, socket, payload?.name);
      if (!ok) {
        send(socket, "error", { message: error });
        return;
      }
      socketToPlayer.set(socket, { roomCode: room.code, playerId: player.id });
      send(socket, "room:token", { token });
      broadcastRoom(room);
      return;
    }

    if (type === "room:join") {
      const room = getRoom(payload?.code);
      if (!room) {
        send(socket, "error", { message: "Room not found" });
        return;
      }
      const { ok, player, token, error } = addPlayer(room, socket, payload?.name);
      if (!ok) {
        send(socket, "error", { message: error });
        return;
      }
      socketToPlayer.set(socket, { roomCode: room.code, playerId: player.id });
      send(socket, "room:token", { token });
      broadcastRoom(room);
      return;
    }

    if (type === "room:reconnect") {
      const room = getRoom(payload?.code);
      if (!room) {
        send(socket, "error", { message: "Room not found" });
        return;
      }
      const result = reconnectPlayer(room, socket, payload?.token);
      if (!result.ok) {
        send(socket, "error", { message: result.error });
        return;
      }
      socketToPlayer.set(socket, { roomCode: room.code, playerId: result.playerId });
      broadcastRoom(room);
      return;
    }

    if (type === "game:action") {
      const meta = socketToPlayer.get(socket);
      if (!meta) {
        send(socket, "error", { message: "Not in room" });
        return;
      }
      const room = getRoom(meta.roomCode);
      if (!room) {
        send(socket, "error", { message: "Room not found" });
        return;
      }
      const result = handleAction(room, meta.playerId, payload);
      if (!result.ok) {
        send(socket, "error", { message: result.error });
        return;
      }
      broadcastRoom(room);
      return;
    }

    if (type === "game:restart") {
      const meta = socketToPlayer.get(socket);
      if (!meta) {
        send(socket, "error", { message: "Not in room" });
        return;
      }
      const room = getRoom(meta.roomCode);
      if (!room) {
        send(socket, "error", { message: "Room not found" });
        return;
      }
      const result = restartRoom(room);
      if (!result.ok) {
        send(socket, "error", { message: result.error || "Failed to restart" });
        return;
      }
      broadcastRoom(room);
      return;
    }

    if (type === "room:chat") {
      const meta = socketToPlayer.get(socket);
      if (!meta) {
        send(socket, "error", { message: "Not in room" });
        return;
      }
      const room = getRoom(meta.roomCode);
      if (!room) {
        send(socket, "error", { message: "Room not found" });
        return;
      }
      const player = room.players.find((p) => p.id === meta.playerId);
      if (!player) {
        send(socket, "error", { message: "Unknown player" });
        return;
      }
      const text = String(payload?.text ?? "").trim().slice(0, 120);
      if (!text) {
        send(socket, "error", { message: "Empty chat message" });
        return;
      }
      broadcastEvent(room, "room:chat", {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        senderId: player.id,
        senderName: player.name || "Guest",
        text,
        at: Date.now()
      });
      return;
    }

    send(socket, "error", { message: "Unknown message type" });
  });

  socket.on("close", () => {
    const meta = socketToPlayer.get(socket);
    if (!meta) return;
    const room = getRoom(meta.roomCode);
    if (!room) return;
    removePlayer(room, meta.playerId);
    socketToPlayer.delete(socket);
    pruneRoom(room, RECONNECT_TTL_MS);
    if (room.players.length === 0) {
      rooms.delete(meta.roomCode);
    } else {
      broadcastRoom(room);
    }
  });
});

console.log(`Lost Cities server listening on ${PORT}`);
