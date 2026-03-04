import { customAlphabet, nanoid } from "nanoid";
import { applyAction, createGameState, getPlayerView } from "./engine.js";

const ROOM_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const createCode = customAlphabet(ROOM_CODE_ALPHABET, 4);

function createRoomCode() {
  return createCode();
}

function normalizeRounds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  if (parsed <= 0) return 0;
  return Math.max(1, Math.floor(parsed));
}

export function createRoom(roundsTotal) {
  return {
    code: createRoomCode(),
    players: [],
    sockets: new Map(),
    reconnectTokens: new Map(),
    state: createGameState(normalizeRounds(roundsTotal))
  };
}

export function addPlayer(room, socket, name) {
  if (room.players.length >= 2) {
    return { ok: false, error: "Room full" };
  }
  const player = {
    id: nanoid(),
    name: name || "Guest"
  };
  room.players.push(player);
  room.sockets.set(player.id, socket);
  const token = nanoid();
  room.reconnectTokens.set(token, player.id);
  return { ok: true, player, token };
}

export function removePlayer(room, playerId) {
  const player = room.players.find((p) => p.id === playerId);
  if (player) {
    player.disconnectedAt = Date.now();
  }
  room.sockets.delete(playerId);
}

export function pruneRoom(room, ttlMs) {
  const now = Date.now();
  room.players = room.players.filter((p) => {
    if (!p.disconnectedAt) return true;
    return now - p.disconnectedAt < ttlMs;
  });
}

export function roomStateFor(room, playerId) {
  const index = room.players.findIndex((p) => p.id === playerId);
  return {
    code: room.code,
    players: room.players.map((p, i) => ({ id: p.id, name: p.name, seat: i, connected: !p.disconnectedAt })),
    you: playerId,
    playerIndex: index
  };
}

export function gameStateFor(room, playerId) {
  const index = room.players.findIndex((p) => p.id === playerId);
  if (index === -1) return null;
  return getPlayerView(room.state, index);
}

export function handleAction(room, playerId, action) {
  const index = room.players.findIndex((p) => p.id === playerId);
  if (index === -1) return { ok: false, error: "Unknown player" };
  const connectedPlayers = room.players.filter((player) => !player.disconnectedAt).length;
  if (connectedPlayers < 2) return { ok: false, error: "Waiting for both players" };
  const result = applyAction(room.state, index, action);
  return result;
}

export function restartRoom(room) {
  const roundsTotal = room.state?.roundsTotal ?? 3;
  room.state = createGameState(roundsTotal);
  return { ok: true };
}

export function reconnectPlayer(room, socket, token) {
  const playerId = room.reconnectTokens.get(token);
  if (!playerId) return { ok: false, error: "Invalid token" };
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: "Player not found" };
  delete player.disconnectedAt;
  room.sockets.set(playerId, socket);
  return { ok: true, playerId };
}
