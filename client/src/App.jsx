import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const COLORS = [
  { id: "red", name: "红" },
  { id: "green", name: "绿" },
  { id: "blue", name: "蓝" },
  { id: "yellow", name: "黄" },
  { id: "white", name: "白" }
];
const COLOR_ORDER = COLORS.reduce((acc, color, index) => {
  acc[color.id] = index;
  return acc;
}, {});

const RULE_SECTIONS = [
  {
    title: "基本信息",
    items: [
      "双人对战，使用五种颜色进行探险。",
      "基础牌组共 60 张：探险牌（2-10）与投资牌。"
    ]
  },
  {
    title: "开局准备",
    items: [
      "洗牌后每人 8 张手牌，其余作为抽牌堆。",
      "每种颜色各有一个弃牌堆位。"
    ]
  },
  {
    title: "你的回合",
    items: [
      "每回合必须先出牌，再抽牌。",
      "出牌只能二选一：打入自己探险列，或弃到对应颜色弃牌堆。",
      "抽牌可从牌堆顶，或任一颜色弃牌堆顶抽 1 张。"
    ]
  },
  {
    title: "探险列限制",
    items: [
      "同色牌必须按点数严格递增。",
      "投资牌只能放在该色探险列前端（点数牌之前）。",
      "打出点数牌后，不能再补该色投资牌。"
    ]
  },
  {
    title: "抽牌限制",
    items: [
      "不能抽回自己本回合刚弃掉的那张同色牌。",
      "抽牌后回合立刻结束。"
    ]
  },
  {
    title: "计分规则",
    items: [
      "每种颜色单独结算：点数和 - 20。",
      "有 1/2/3 张投资牌时，分别乘以 2/3/4。",
      "该颜色探险列若达到 8 张及以上，额外 +20 分。",
      "未开始的颜色不计分。"
    ]
  },
  {
    title: "结束与胜负",
    items: [
      "当抽牌堆被抽空时，本小局结束。",
      "通常进行多小局，按约定规则累计后分出胜负。"
    ]
  }
];

const QUICK_CHAT_MESSAGES = [
  "我先想一下这步",
  "你这步很强",
  "我准备冲高分了",
  "这把稳住别急",
  "最后几张了",
  "打得漂亮"
];

function useSocket(url) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!url) return undefined;
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => setConnected(true));
    ws.addEventListener("close", () => setConnected(false));
    setSocket(ws);
    return () => ws.close();
  }, [url]);

  return { socket, connected };
}

function Card({ card, onClick, selectable }) {
  if (!card) {
    return <div className="card small">空</div>;
  }
  const label = card.type === "wager" ? "投资" : "探险";
  const colorClass = `color-${card.color}`;
  return (
    <div
      className={`card small ${card.color} ${colorClass} ${selectable ? "selectable" : ""}`}
      onClick={selectable ? onClick : undefined}
    >
      <div className="label">{label}</div>
      <div className="value">{card.type === "wager" ? "×" : card.value}</div>
    </div>
  );
}

function HandCard({ card, onSelect, active, selected }) {
  const colorClass = `color-${card.color}`;
  return (
    <div className={`card ${card.color} ${colorClass} ${active ? "selectable" : ""} ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="label">{card.type === "wager" ? "投资" : "探险"}</div>
      <div className="value">{card.type === "wager" ? "×" : card.value}</div>
    </div>
  );
}

function scoreExpedition(expedition) {
  if (!expedition || expedition.length === 0) return 0;
  const wagers = expedition.filter((c) => c.type === "wager").length;
  const sum = expedition.filter((c) => c.type === "number").reduce((acc, c) => acc + c.value, 0);
  let score = sum - 20;
  const multiplier = wagers === 0 ? 1 : 1 + wagers;
  score *= multiplier;
  if (expedition.length >= 8) score += 20;
  return score;
}

function scoreAll(expeditions) {
  if (!expeditions) return 0;
  return Object.values(expeditions).reduce((acc, expedition) => acc + scoreExpedition(expedition), 0);
}

function sortHand(cards) {
  if (!cards) return [];
  return [...cards].sort((a, b) => {
    const colorDiff = (COLOR_ORDER[a.color] ?? 0) - (COLOR_ORDER[b.color] ?? 0);
    if (colorDiff !== 0) return colorDiff;
    const typeWeight = (card) => (card.type === "wager" ? 0 : 1);
    const typeDiff = typeWeight(a) - typeWeight(b);
    if (typeDiff !== 0) return typeDiff;
    if (a.type === "number" && b.type === "number") return a.value - b.value;
    return 0;
  });
}

function expeditionsForSeat(state, seat, selfSeat) {
  if (!state) return null;
  return seat === selfSeat ? state.your.expeditions : state.opponent.expeditions;
}

function describePlayAction(prevState, nextState, actorSeat, selfSeat) {
  const prevExpeditions = expeditionsForSeat(prevState, actorSeat, selfSeat);
  const nextExpeditions = expeditionsForSeat(nextState, actorSeat, selfSeat);

  for (const color of COLORS) {
    const prevLen = prevExpeditions?.[color.id]?.length ?? 0;
    const nextLen = nextExpeditions?.[color.id]?.length ?? 0;
    if (nextLen > prevLen) {
      return `打出了${color.name}探险牌`;
    }
  }

  for (const color of COLORS) {
    const prevTopId = prevState?.discardTops?.[color.id]?.id ?? null;
    const nextTop = nextState?.discardTops?.[color.id];
    if (nextTop && nextTop.id !== prevTopId) {
      return `弃掉了${color.name}牌`;
    }
  }

  return "完成了出牌";
}

function describeDrawAction(prevState, nextState) {
  if ((nextState?.roundIndex ?? 0) > (prevState?.roundIndex ?? 0)) {
    return "完成了抽牌，进入下一局";
  }

  if (!prevState?.finished && nextState?.finished) {
    return "完成了抽牌，本局结束";
  }

  if ((nextState?.deckCount ?? 0) < (prevState?.deckCount ?? 0)) {
    return "从牌堆抽了一张牌";
  }

  for (const color of COLORS) {
    const prevTopId = prevState?.discardTops?.[color.id]?.id ?? null;
    const nextTopId = nextState?.discardTops?.[color.id]?.id ?? null;
    if (prevTopId !== nextTopId) {
      return `从${color.name}弃牌堆抽了一张牌`;
    }
  }

  return "完成了抽牌";
}

function calcMatchWins(history, selfSeat) {
  let you = 0;
  let opponent = 0;
  if (!Array.isArray(history)) {
    return { you, opponent };
  }
  for (const round of history) {
    const myRound = round?.scores?.[selfSeat] ?? 0;
    const opponentRound = round?.scores?.[selfSeat === 0 ? 1 : 0] ?? 0;
    if (myRound > opponentRound) {
      you += 1;
    } else if (myRound < opponentRound) {
      opponent += 1;
    }
  }
  return { you, opponent };
}

function formatActionTime() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatChatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return formatActionTime();
  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
}

function mapServerError(message) {
  const text = typeof message === "string" ? message.trim() : "";
  const dict = {
    "Invalid expedition play": "该牌不能这样打到探险列",
    "Not your turn": "还没轮到你操作",
    "Must play before drawing": "请先出牌再抽牌",
    "Card not in hand": "这张牌不在你的手牌中",
    "Discard empty": "该弃牌堆为空",
    "Cannot draw your just-discarded card": "不能立刻抽回你刚弃掉的牌",
    "Waiting players to continue": "请等待双方点击继续",
    "No round to continue": "当前没有可继续的下一局",
    "Empty chat message": "消息不能为空"
  };
  return dict[text] || text || "未知错误";
}

function copyTextByExecCommand(text) {
  if (typeof document === "undefined") return false;
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.top = "0";
  input.style.left = "0";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.appendChild(input);

  const selection = document.getSelection();
  const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(input);
  if (selection) {
    selection.removeAllRanges();
    if (originalRange) {
      selection.addRange(originalRange);
    }
  }
  return copied;
}

async function copyText(text) {
  const value = String(text ?? "");
  if (!value) return false;

  const canUseClipboardApi =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function" &&
    (typeof window === "undefined" || window.isSecureContext);

  if (canUseClipboardApi) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback for browsers/platforms where clipboard API exists but fails at runtime.
    }
  }
  return copyTextByExecCommand(value);
}

function normalizeRoomCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 4);
}

function getInviteCodeFromUrl() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return normalizeRoomCode(params.get("invite") || "");
}

function buildInviteLink(roomCode) {
  if (typeof window === "undefined") return "";
  const code = normalizeRoomCode(roomCode);
  if (!code) return "";
  const url = new URL(window.location.href);
  url.searchParams.set("invite", code);
  return url.toString();
}

export default function App() {
  const defaultHost = typeof window !== "undefined" && window.location.hostname ? window.location.hostname : "localhost";
  const socketProtocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const isLocalHost = defaultHost === "localhost" || defaultHost === "127.0.0.1";
  const defaultPort =
    typeof window !== "undefined" && window.location.port
      ? window.location.port
      : isLocalHost
        ? "8080"
        : "";
  const [activeHost, setActiveHost] = useState(defaultHost);
  const [activePort, setActivePort] = useState(defaultPort);
  const [socketSession, setSocketSession] = useState(0);
  const [pendingHost, setPendingHost] = useState(defaultHost);
  const [pendingPort, setPendingPort] = useState(defaultPort);
  const serverUrl = useMemo(() => {
    const portPart = activePort ? `:${activePort}` : "";
    return `${socketProtocol}://${activeHost}${portPart}/ws/?session=${socketSession}`;
  }, [socketProtocol, activeHost, activePort, socketSession]);
  const { socket, connected } = useSocket(serverUrl);
  const [roomState, setRoomState] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(() => getInviteCodeFromUrl());
  const [invitedRoomCode, setInvitedRoomCode] = useState(() => getInviteCodeFromUrl());
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [phaseAction, setPhaseAction] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showGameMenu, setShowGameMenu] = useState(false);
  const [showActionHistory, setShowActionHistory] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [actionHistory, setActionHistory] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [roundContinueSent, setRoundContinueSent] = useState(false);
  const [roundResultSeenKey, setRoundResultSeenKey] = useState("");
  const [roundsTotal, setRoundsTotal] = useState("3");
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [reconnectToken, setReconnectToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("lostcities-token") || "";
  });
  const [reconnectCode, setReconnectCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("lostcities-code") || "";
  });
  const toastTimersRef = useRef(new Map());
  const nextToastIdRef = useRef(1);
  const nextActionHistoryIdRef = useRef(1);
  const prevRoomRef = useRef(null);
  const prevGameRef = useRef(null);
  const invitePromptedRef = useRef(false);

  const playerIndex = roomState?.playerIndex ?? -1;
  const myPlayer = roomState?.players?.find((p) => p.id === roomState.you) || null;
  const opponentPlayer = roomState?.players?.find((p) => p.id !== roomState.you) || null;
  const connectedPlayersCount = roomState?.players?.filter((player) => player.connected !== false).length ?? 0;
  const hasTwoPlayers = connectedPlayersCount >= 2;
  const waitingForOpponent = !!roomState && !hasTwoPlayers;
  const myName = myPlayer?.name || "你";
  const opponentName = opponentPlayer?.name || "等待对手";
  const isMyTurn = gameState && gameState.turn === playerIndex;
  const roundHistory = gameState?.history || [];
  const roundResult = gameState?.roundResult || null;
  const roundPendingContinue = !!roundResult?.canContinue;
  const roundResultKey = roundResult
    ? `${roundResult.roundIndex}:${roundResult.scores?.[0] ?? 0}:${roundResult.scores?.[1] ?? 0}`
    : "";
  const showRoundResultModal = !!roundResult && (roundResult.canContinue || roundResultSeenKey !== roundResultKey);
  const matchWins = useMemo(() => {
    if (Array.isArray(gameState?.matchWins) && playerIndex !== -1) {
      return {
        you: gameState.matchWins[playerIndex] ?? 0,
        opponent: gameState.matchWins[playerIndex === 0 ? 1 : 0] ?? 0
      };
    }
    return calcMatchWins(roundHistory, playerIndex === -1 ? 0 : playerIndex);
  }, [gameState?.matchWins, roundHistory, playerIndex]);
  const liveRoundScores = useMemo(() => {
    if (!gameState) return null;
    return {
      you: scoreAll(gameState.your.expeditions),
      opponent: scoreAll(gameState.opponent.expeditions)
    };
  }, [gameState]);
  const roundResultWinnerText = useMemo(() => {
    if (!roundResult) return "";
    if (roundResult.winner === -1) return "本局平局";
    if (roundResult.winner === playerIndex) return `${myName} 赢下本局`;
    return `${opponentName} 赢下本局`;
  }, [roundResult, playerIndex, myName, opponentName]);
  const roundResultMyScore = roundResult && playerIndex !== -1 ? (roundResult.scores?.[playerIndex] ?? 0) : 0;
  const roundResultOpponentScore =
    roundResult && playerIndex !== -1 ? (roundResult.scores?.[playerIndex === 0 ? 1 : 0] ?? 0) : 0;
  const roundResultMatchWins = useMemo(() => {
    if (roundResult && Array.isArray(roundResult.matchWins) && playerIndex !== -1) {
      return {
        you: roundResult.matchWins[playerIndex] ?? 0,
        opponent: roundResult.matchWins[playerIndex === 0 ? 1 : 0] ?? 0
      };
    }
    return matchWins;
  }, [roundResult, matchWins, playerIndex]);
  const sortedHand = useMemo(() => sortHand(gameState?.your.hand), [gameState?.your.hand]);
  const pushToast = useCallback((text) => {
    if (!text) return;
    const id = nextToastIdRef.current++;
    setToasts((prev) => [...prev, { id, text }].slice(-4));
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      toastTimersRef.current.delete(id);
    }, 2800);
    toastTimersRef.current.set(id, timer);
  }, []);
  const pushActionHistory = useCallback((text) => {
    if (!text) return;
    const id = nextActionHistoryIdRef.current++;
    const entry = { id, text, at: formatActionTime() };
    setActionHistory((prev) => [...prev, entry].slice(-80));
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "room:state") {
        setRoomState(msg.payload);
      }
      if (msg.type === "game:state") {
        setGameState(msg.payload);
      }
      if (msg.type === "room:token") {
        if (msg.payload?.token) {
          localStorage.setItem("lostcities-token", msg.payload.token);
          setReconnectToken(msg.payload.token);
        }
      }
      if (msg.type === "error") {
        const errorText = mapServerError(msg.payload?.message);
        pushToast(errorText);
      }
      if (msg.type === "room:chat") {
        const item = msg.payload;
        if (!item?.text) return;
        const chatEntry = {
          id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          senderId: item.senderId || "",
          senderName: item.senderName || "玩家",
          text: String(item.text),
          at: item.at || Date.now()
        };
        setChatMessages((prev) => [...prev, chatEntry].slice(-80));
        if (item.senderId && item.senderId !== roomState?.you) {
          pushToast(`${chatEntry.senderName}：${chatEntry.text}`);
        }
      }
    };
    socket.addEventListener("message", handler);
    return () => socket.removeEventListener("message", handler);
  }, [socket, pushToast, roomState?.you]);

  useEffect(() => {
    if (gameState?.phase === "draw") {
      setPhaseAction("draw");
    } else {
      setPhaseAction(null);
      setSelectedCardId(null);
    }
  }, [gameState?.phase]);

  useEffect(() => {
    if (!roomState?.code) return;
    localStorage.setItem("lostcities-code", roomState.code);
    setReconnectCode(roomState.code);
  }, [roomState?.code]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateInviteFromUrl = () => {
      const code = getInviteCodeFromUrl();
      setInvitedRoomCode(code);
      if (!roomState && code) {
        setRoomCode(code);
      }
    };
    updateInviteFromUrl();
    window.addEventListener("popstate", updateInviteFromUrl);
    return () => window.removeEventListener("popstate", updateInviteFromUrl);
  }, [roomState]);

  useEffect(() => {
    if (!invitedRoomCode || roomState || invitePromptedRef.current) return;
    setShowJoinModal(true);
    setShowCreateModal(false);
    setRoomCode(invitedRoomCode);
    pushToast("这是邀请链接，请设置昵称后加入房间");
    invitePromptedRef.current = true;
  }, [invitedRoomCode, roomState, pushToast]);

  useEffect(() => {
    if (roomState) return;
    setShowGameMenu(false);
    setShowActionHistory(false);
    setShowChatPanel(false);
    setActionHistory([]);
    setChatMessages([]);
    setChatInput("");
    setRoundContinueSent(false);
    setRoundResultSeenKey("");
  }, [roomState]);

  useEffect(() => {
    setRoundContinueSent(false);
  }, [roundResultKey]);

  useEffect(() => () => {
    for (const timer of toastTimersRef.current.values()) {
      clearTimeout(timer);
    }
    toastTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!roomState) {
      prevRoomRef.current = null;
      return;
    }
    const prevRoom = prevRoomRef.current;
    if (prevRoom) {
      if (prevRoom.code !== roomState.code) {
        setShowActionHistory(false);
        setActionHistory([]);
      }
      const prevIds = new Set(prevRoom.players.map((player) => player.id));
      const joinedPlayers = roomState.players.filter((player) => !prevIds.has(player.id));
      for (const player of joinedPlayers) {
        pushToast(`${player.name} 加入了房间`);
      }
    }
    prevRoomRef.current = roomState;
  }, [roomState, pushToast]);

  useEffect(() => {
    if (!gameState || !roomState) {
      prevGameRef.current = gameState || null;
      return;
    }
    const prevGame = prevGameRef.current;
    if (prevGame) {
      if (
        (gameState.roundIndex ?? 1) === 1 &&
        (gameState.history?.length ?? 0) === 0 &&
        (((prevGame.roundIndex ?? 1) !== 1) || (prevGame.history?.length ?? 0) > 0)
      ) {
        pushToast("对局已重新开始");
        setActionHistory([]);
        setRoundResultSeenKey("");
        pushActionHistory("对局已重新开始");
        prevGameRef.current = gameState;
        return;
      }

      const playerNamesBySeat = new Map(roomState.players.map((player) => [player.seat, player.name]));
      const actorName = (seat) => (seat === playerIndex ? "你" : playerNamesBySeat.get(seat) || "对手");

      if (prevGame.phase === "play" && gameState.phase === "draw" && prevGame.turn === gameState.turn) {
        const actorSeat = gameState.turn;
        const actionText = `${actorName(actorSeat)}${describePlayAction(prevGame, gameState, actorSeat, playerIndex)}`;
        pushToast(actionText);
        pushActionHistory(actionText);
      } else if (prevGame.phase === "draw" && gameState.phase === "play" && prevGame.turn !== gameState.turn) {
        const actorSeat = prevGame.turn;
        const actionText = `${actorName(actorSeat)}${describeDrawAction(prevGame, gameState)}`;
        pushToast(actionText);
        pushActionHistory(actionText);
      }
    }
    prevGameRef.current = gameState;
  }, [gameState, roomState, playerIndex, pushToast, pushActionHistory]);

  const canPlay = hasTwoPlayers && !roundPendingContinue && isMyTurn && gameState?.phase === "play";

  const send = (type, payload) => {
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ type, payload }));
  };

  const copyRoomCode = useCallback(async () => {
    const code = roomState?.code;
    if (!code) return;
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      pushToast("房间号已复制");
      return;
    }
    pushToast("复制失败，请手动复制房间号");
  }, [roomState?.code, pushToast]);

  const copyInviteLink = useCallback(async () => {
    const code = roomState?.code;
    if (!code) return;
    const inviteLink = buildInviteLink(code);
    const ok = await copyText(inviteLink);
    if (ok) {
      setInviteCopied(true);
      pushToast("邀请链接已复制");
      return;
    }
    pushToast("邀请链接复制失败，请手动复制");
  }, [roomState?.code, pushToast]);

  const createRoom = () => {
    send("room:create", { name: name || "Guest", roundsTotal });
  };

  const joinRoom = () => {
    if (!roomCode) {
      pushToast("请输入房间码");
      return;
    }
    send("room:join", { code: roomCode.trim().toUpperCase(), name: name || "Guest" });
  };

  const reconnect = () => {
    if (!reconnectCode || !reconnectToken) return;
    send("room:reconnect", { code: reconnectCode, token: reconnectToken });
  };

  const restartGame = () => {
    setShowGameMenu(false);
    send("game:restart");
    pushToast("已发送重新开始请求");
  };

  const leaveRoom = () => {
    setShowGameMenu(false);
    setShowActionHistory(false);
    setShowChatPanel(false);
    setRoundContinueSent(false);
    setRoundResultSeenKey("");
    setActionHistory([]);
    setChatMessages([]);
    setChatInput("");
    setRoomState(null);
    setGameState(null);
    setSelectedCardId(null);
    setPhaseAction(null);
    setReconnectToken("");
    setReconnectCode("");
    prevRoomRef.current = null;
    prevGameRef.current = null;
    nextActionHistoryIdRef.current = 1;
    localStorage.removeItem("lostcities-token");
    localStorage.removeItem("lostcities-code");
    setSocketSession((prev) => prev + 1);
    pushToast("已退出房间");
  };

  const continueRound = () => {
    if (!roundResult?.canContinue || roundContinueSent) return;
    send("game:action", { type: "continue_round" });
    setRoundContinueSent(true);
  };

  const playCard = (target) => {
    if (!hasTwoPlayers || roundPendingContinue) return;
    if (!selectedCardId) return;
    send("game:action", { type: "play_card", payload: { cardId: selectedCardId, target } });
    setSelectedCardId(null);
  };

  const drawCard = (source, color) => {
    if (!hasTwoPlayers || roundPendingContinue) return;
    send("game:action", { type: "draw_card", payload: { source, color } });
  };

  const sendChatMessage = useCallback((text) => {
    const normalized = String(text ?? "").trim();
    if (!normalized) {
      pushToast("消息不能为空");
      return;
    }
    send("room:chat", { text: normalized });
    setChatInput("");
  }, [pushToast, socket]);

  const selectedCard = useMemo(() => {
    if (!gameState || !selectedCardId) return null;
    return gameState.your.hand.find((c) => c.id === selectedCardId) || null;
  }, [gameState, selectedCardId]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!inviteCopied) return undefined;
    const timer = setTimeout(() => setInviteCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [inviteCopied]);

  return (
    <div>
      <header>
        <h1>Lost Cities</h1>
        <div className="header-right">
          {roomState && gameState && (
            <div className="header-meta">
              <div className="info-chip info-room header-chip">
                <span>房间 {roomState.code}</span>
                <button
                  className="chip-action"
                  onClick={copyRoomCode}
                  title="复制房间号"
                >
                  {copied ? "已复制" : "复制"}
                </button>
                <button
                  className="chip-action"
                  onClick={copyInviteLink}
                  title="复制邀请链接"
                >
                  {inviteCopied ? "链接已复制" : "邀请链接"}
                </button>
                <span className="chip-meta">
                  {gameState.roundIndex}/{gameState.roundsTotal === 0 ? "∞" : gameState.roundsTotal}
                </span>
              </div>
              <div className={`info-chip header-chip header-score ${isMyTurn ? "highlight" : ""}`}>
                {myName} vs {opponentName} · 总分(赢局) {matchWins.you} : {matchWins.opponent} · 本局分 {liveRoundScores?.you ?? 0} : {liveRoundScores?.opponent ?? 0}
              </div>
            </div>
          )}
          {roomState && (
            <div className="menu-wrap">
              <button
                className="secondary menu-btn"
                onClick={() => setShowGameMenu((prev) => !prev)}
              >
                菜单
              </button>
              {showGameMenu && (
                <div className="menu-dropdown">
                  <button className="secondary" onClick={restartGame}>重新开始</button>
                  <button className="secondary" onClick={leaveRoom}>退出房间</button>
                </div>
              )}
            </div>
          )}
          <div className="badge">{connected ? "已连接" : "未连接"}</div>
        </div>
      </header>
      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className="toast-item">{toast.text}</div>
          ))}
        </div>
      )}
      {showRulesModal && (
        <div className="modal-backdrop rules-backdrop" onClick={() => setShowRulesModal(false)}>
          <div className="modal rules-modal" onClick={(e) => e.stopPropagation()}>
            <h3>游戏规则</h3>
            <div className="rules-content">
              {RULE_SECTIONS.map((section) => (
                <section key={section.title} className="rules-section">
                  <h4>{section.title}</h4>
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowRulesModal(false)}>我知道了</button>
            </div>
          </div>
        </div>
      )}
      {showRoundResultModal && (
        <div
          className="modal-backdrop result-backdrop"
          onClick={() => {
            if (!roundResult?.canContinue) {
              setRoundResultSeenKey(roundResultKey);
            }
          }}
        >
          <div className="modal result-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{roundResultWinnerText}</h3>
            <div className="notice">本局分数 你 {roundResultMyScore} : 对手 {roundResultOpponentScore}</div>
            <div className="notice">当前比分(赢局) {myName} {roundResultMatchWins.you} : {roundResultMatchWins.opponent} {opponentName}</div>
            <div className="modal-actions">
              {roundResult?.canContinue ? (
                <button onClick={continueRound} disabled={roundContinueSent}>
                  {roundContinueSent ? `已继续，等待对方… (${roundResult.readyCount ?? 1}/2)` : "继续"}
                </button>
              ) : (
                <button onClick={() => setRoundResultSeenKey(roundResultKey)}>知道了</button>
              )}
            </div>
          </div>
        </div>
      )}
      {waitingForOpponent && (
        <div className="modal-backdrop waiting-backdrop">
          <div className="modal waiting-modal">
            <h3>等待另一位玩家加入</h3>
            <div className="waiting-room-line">
              <span className="waiting-room-code">房间号 {roomState.code}</span>
              <button
                className="chip-action"
                onClick={copyRoomCode}
                title="复制房间号"
              >
                {copied ? "已复制" : "复制"}
              </button>
              <button
                className="chip-action"
                onClick={copyInviteLink}
                title="复制邀请链接"
              >
                {inviteCopied ? "链接已复制" : "邀请链接"}
              </button>
            </div>
            <div className="notice">当前 {connectedPlayersCount}/2 人，双方进入后自动开始游戏。</div>
          </div>
        </div>
      )}
      {roomState && gameState && !waitingForOpponent && (
        <div className="action-history-float">
          {showActionHistory && (
            <aside className="action-history-panel">
              <div className="action-history-head">
                <span>操作历史</span>
                <button
                  className="secondary action-history-close"
                  onClick={() => setShowActionHistory(false)}
                >
                  关闭
                </button>
              </div>
              <div className="action-history-list">
                {actionHistory.length === 0 ? (
                  <div className="action-history-empty">暂无操作记录</div>
                ) : (
                  [...actionHistory].reverse().map((item) => (
                    <div key={item.id} className="action-history-item">
                      <div className="action-history-time">{item.at}</div>
                      <div className="action-history-text">{item.text}</div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          )}
          <button
            className="action-history-fab"
            onClick={() => setShowActionHistory((prev) => !prev)}
            title="查看操作历史"
            aria-label="查看操作历史"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v5l3 2" />
              <path d="M8 4H4v4" />
              <path d="M4 8a9 9 0 1 0 3-6.7" />
            </svg>
          </button>
        </div>
      )}
      {roomState && gameState && (
        <div className="chat-float">
          {showChatPanel && (
            <aside className="chat-panel">
              <div className="chat-head">
                <span>消息</span>
                <button
                  className="secondary chat-close"
                  onClick={() => setShowChatPanel(false)}
                >
                  关闭
                </button>
              </div>
              <div className="chat-quick-list">
                {QUICK_CHAT_MESSAGES.map((item) => (
                  <button
                    key={item}
                    className="secondary chat-quick-btn"
                    onClick={() => sendChatMessage(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div className="chat-list">
                {chatMessages.length === 0 ? (
                  <div className="chat-empty">还没有消息</div>
                ) : (
                  chatMessages.map((item) => {
                    const isSelf = item.senderId === roomState?.you;
                    return (
                      <div key={item.id} className={`chat-item ${isSelf ? "self" : ""}`}>
                        <div className="chat-meta">
                          <span>{isSelf ? "你" : item.senderName}</span>
                          <span>{formatChatTime(item.at)}</span>
                        </div>
                        <div className="chat-text">{item.text}</div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="chat-input-row">
                <input
                  placeholder="输入消息"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendChatMessage(chatInput);
                    }
                  }}
                />
                <button onClick={() => sendChatMessage(chatInput)}>发送</button>
              </div>
            </aside>
          )}
          <button
            className="chat-fab"
            onClick={() => setShowChatPanel((prev) => !prev)}
            title="发送消息"
            aria-label="发送消息"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h16v10H7l-3 3z" />
              <path d="M8 9h8" />
              <path d="M8 12h5" />
            </svg>
          </button>
        </div>
      )}

      <main>
        {!roomState && (
            <div className="lobby-shell">
            <div className="lobby-hero">
              <h2>探索失落的文明</h2>
              <p>两人对战，五条探险路线。用策略押注与出牌，赢得更高的探险收益。</p>
              <button className="secondary" onClick={() => setShowRulesModal(true)}>游戏规则</button>
            </div>
            <div className="panel lobby-actions">
              <div className="room-card">
                <h3>快速开始</h3>
                <input
                  placeholder="昵称"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <div className="stack" style={{ flexDirection: "row", gap: 12 }}>
                  <button onClick={() => setShowCreateModal(true)}>创建房间</button>
                  <button className="secondary" onClick={() => setShowJoinModal(true)}>加入房间</button>
                </div>
              </div>
              <div className="room-card">
                <h3>服务器地址</h3>
                <div className="stack" style={{ gap: 8 }}>
                  <input
                    placeholder={defaultHost}
                    value={pendingHost}
                    onChange={(e) => setPendingHost(e.target.value)}
                  />
                  <input
                    placeholder="8080"
                    value={pendingPort}
                    onChange={(e) => setPendingPort(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => {
                    const host = pendingHost.trim() || defaultHost;
                    const port = pendingPort.trim();
                    setActiveHost(host);
                    setActivePort(port);
                  }}
                >
                  确认服务器地址
                </button>
                {reconnectCode && reconnectToken && (
                  <button className="secondary" onClick={reconnect}>
                    断线重连
                  </button>
                )}
              </div>
            </div>
            {showCreateModal && (
              <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
                <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <h3>创建房间</h3>
                  <label>
                    昵称
                    <input
                      placeholder="昵称"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    局数（0 表示无限）
                    <input
                      placeholder="3"
                      value={roundsTotal}
                      onChange={(e) => setRoundsTotal(e.target.value)}
                    />
                  </label>
                  <div className="modal-actions">
                    <button onClick={createRoom}>创建</button>
                    <button className="secondary" onClick={() => setShowCreateModal(false)}>取消</button>
                  </div>
                </div>
              </div>
            )}
            {showJoinModal && (
              <div className="modal-backdrop" onClick={() => setShowJoinModal(false)}>
                <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <h3>加入房间</h3>
                  {invitedRoomCode && (
                    <div className="notice">邀请房间号：{invitedRoomCode}</div>
                  )}
                  <label>
                    昵称
                    <input
                      placeholder="昵称"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  {!invitedRoomCode && (
                    <label>
                      房间码
                      <input
                        placeholder="输入房间码"
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value)}
                      />
                    </label>
                  )}
                  <div className="modal-actions">
                    <button onClick={joinRoom}>加入</button>
                    <button className="secondary" onClick={() => setShowJoinModal(false)}>取消</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {roomState && gameState && (
          <div className="wood-frame">
            <div className="felt-surface">
              <div className="table-area">
                <section className="table-zone">
                  <h3>对手探险列 · {opponentName}</h3>
                  {COLORS.map((color) => {
                    const opponentExpedition = gameState.opponent.expeditions[color.id];
                    const opponentColorScore = scoreExpedition(opponentExpedition);
                    return (
                    <div key={color.id} className="expedition-row">
                      <div className="row-head">
                        <div className="row-label">{color.name}</div>
                        <div className={`row-score ${opponentColorScore > 0 ? "positive" : opponentColorScore < 0 ? "negative" : ""}`}>
                          {opponentColorScore > 0 ? `+${opponentColorScore}` : opponentColorScore}
                        </div>
                      </div>
                      <div className="expedition-cards">
                        {opponentExpedition.map((card) => (
                          <Card key={card.id} card={card} />
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </section>

                <section className="table-zone center-zone">
                  <div className="center-piles">
                    <div className="stack">
                      <h3>弃牌堆</h3>
                      <div className="pile-grid">
                        {COLORS.map((color) => (
                          <Card
                            key={color.id}
                            card={gameState.discardTops[color.id]}
                            selectable={phaseAction === "draw"}
                            onClick={() => drawCard("discard", color.id)}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="stack">
                      <h3>抽牌堆</h3>
                      <div
                        className={`card card-back deck-pile ${phaseAction === "draw" ? "selectable" : ""}`}
                        onClick={() => phaseAction === "draw" && drawCard("deck")}
                      >
                        <div className="label">抽牌</div>
                        <div className="value">{gameState.deckCount}</div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="table-zone">
                  <h3>你的探险列 · {myName}</h3>
                  {COLORS.map((color) => {
                    const yourExpedition = gameState.your.expeditions[color.id];
                    const yourColorScore = scoreExpedition(yourExpedition);
                    return (
                    <div key={color.id} className="expedition-row">
                      <div className="row-head">
                        <div className="row-label">{color.name}</div>
                        <div className={`row-score ${yourColorScore > 0 ? "positive" : yourColorScore < 0 ? "negative" : ""}`}>
                          {yourColorScore > 0 ? `+${yourColorScore}` : yourColorScore}
                        </div>
                      </div>
                      <div className="expedition-cards">
                        {yourExpedition.map((card) => (
                          <Card key={card.id} card={card} />
                        ))}
                      </div>
                    </div>
                    );
                  })}
                </section>
              </div>

              <div className="stack hand-zone">
                <h3>你的手牌 · {myName}</h3>
                <div className="hand">
                  {sortedHand.map((card) => (
                    <HandCard
                      key={card.id}
                      card={card}
                      active={canPlay}
                      selected={selectedCardId === card.id}
                      onSelect={() => {
                        if (!canPlay) return;
                        setSelectedCardId((prev) => (prev === card.id ? null : card.id));
                      }}
                    />
                  ))}
                </div>
                {selectedCard && (
                  <div className="notice">
                    已选择：{selectedCard.color} {selectedCard.type === "wager" ? "投资" : selectedCard.value}
                    <div className="stack" style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
                      <button onClick={() => playCard("expedition")}>打入探险列</button>
                      <button className="secondary" onClick={() => playCard("discard")}>弃牌</button>
                    </div>
                  </div>
                )}
                {gameState.gameOver && <div className="notice">比赛结束！最终得分已结算。</div>}
                {!isMyTurn && <div className="notice">等待对手操作…</div>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
