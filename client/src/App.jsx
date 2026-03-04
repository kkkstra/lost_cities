import React, { useEffect, useMemo, useState } from "react";

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

function HandCard({ card, onSelect, active }) {
  const colorClass = `color-${card.color}`;
  return (
    <div className={`card ${card.color} ${colorClass} ${active ? "selectable" : ""}`} onClick={onSelect}>
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
  const [pendingHost, setPendingHost] = useState(defaultHost);
  const [pendingPort, setPendingPort] = useState(defaultPort);
  const serverUrl = useMemo(() => {
    const portPart = activePort ? `:${activePort}` : "";
    return `${socketProtocol}://${activeHost}${portPart}/ws/`;
  }, [socketProtocol, activeHost, activePort]);
  const { socket, connected } = useSocket(serverUrl);
  const [roomState, setRoomState] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [message, setMessage] = useState("");
  const [phaseAction, setPhaseAction] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [roundsTotal, setRoundsTotal] = useState("3");
  const [copied, setCopied] = useState(false);
  const [reconnectToken, setReconnectToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("lostcities-token") || "";
  });
  const [reconnectCode, setReconnectCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("lostcities-code") || "";
  });

  const playerIndex = roomState?.playerIndex ?? -1;
  const isMyTurn = gameState && gameState.turn === playerIndex;
  const liveRoundScores = useMemo(() => {
    if (!gameState) return null;
    return {
      you: scoreAll(gameState.your.expeditions),
      opponent: scoreAll(gameState.opponent.expeditions)
    };
  }, [gameState]);
  const sortedHand = useMemo(() => sortHand(gameState?.your.hand), [gameState?.your.hand]);

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
        setMessage(msg.payload?.message || "未知错误");
      }
    };
    socket.addEventListener("message", handler);
    return () => socket.removeEventListener("message", handler);
  }, [socket]);

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

  const canPlay = isMyTurn && gameState?.phase === "play";

  const send = (type, payload) => {
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ type, payload }));
  };

  const createRoom = () => {
    setMessage("");
    send("room:create", { name: name || "Guest", roundsTotal });
  };

  const joinRoom = () => {
    setMessage("");
    if (!roomCode) {
      setMessage("请输入房间码");
      return;
    }
    send("room:join", { code: roomCode.trim().toUpperCase(), name: name || "Guest" });
  };

  const reconnect = () => {
    if (!reconnectCode || !reconnectToken) return;
    send("room:reconnect", { code: reconnectCode, token: reconnectToken });
  };

  const playCard = (target) => {
    if (!selectedCardId) return;
    send("game:action", { type: "play_card", payload: { cardId: selectedCardId, target } });
    setSelectedCardId(null);
  };

  const drawCard = (source, color) => {
    send("game:action", { type: "draw_card", payload: { source, color } });
  };

  const selectedCard = useMemo(() => {
    if (!gameState || !selectedCardId) return null;
    return gameState.your.hand.find((c) => c.id === selectedCardId) || null;
  }, [gameState, selectedCardId]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

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
                  onClick={() => {
                    navigator.clipboard?.writeText(roomState.code);
                    setCopied(true);
                  }}
                  title="复制房间号"
                >
                  {copied ? "已复制" : "复制"}
                </button>
                <span className="chip-meta">
                  {gameState.roundIndex}/{gameState.roundsTotal === 0 ? "∞" : gameState.roundsTotal}
                </span>
              </div>
              <div className={`info-chip header-chip header-score ${isMyTurn ? "highlight" : ""}`}>
                总分 你 {gameState.scores[playerIndex]} : 对手 {gameState.scores[playerIndex === 0 ? 1 : 0]} · 本局 你 {liveRoundScores?.you ?? 0} : 对手 {liveRoundScores?.opponent ?? 0}
              </div>
            </div>
          )}
          <div className="badge">{connected ? "已连接" : "未连接"}</div>
        </div>
      </header>

      <main>
        {!roomState && (
          <div className="lobby-shell">
            <div className="lobby-hero">
              <h2>探索失落的文明</h2>
              <p>两人对战，五条探险路线。用策略押注与出牌，赢得更高的探险收益。</p>
              <div className="notice">实时联机 · 房间码对战 · 3 局累计</div>
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
                  <label>
                    昵称
                    <input
                      placeholder="昵称"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    房间码
                    <input
                      placeholder="输入房间码"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value)}
                    />
                  </label>
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
                  <h3>对手探险列</h3>
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
                  <h3>你的探险列</h3>
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
                <h3>你的手牌</h3>
                <div className="hand">
                  {sortedHand.map((card) => (
                    <HandCard
                      key={card.id}
                      card={card}
                      active={canPlay}
                      onSelect={() => canPlay && setSelectedCardId(card.id)}
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
                {message && <div className="notice">{message}</div>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
