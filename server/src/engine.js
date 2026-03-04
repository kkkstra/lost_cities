const COLORS = ["red", "green", "blue", "yellow", "white"];
const NUMBERS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createDeck() {
  const deck = [];
  let id = 1;
  for (const color of COLORS) {
    for (let i = 0; i < 3; i += 1) {
      deck.push({ id: id++, color, type: "wager", value: 0 });
    }
    for (const value of NUMBERS) {
      deck.push({ id: id++, color, type: "number", value });
    }
  }
  return shuffle(deck);
}

function dealHands(deck) {
  const hands = [[], []];
  for (let i = 0; i < 8; i += 1) {
    hands[0].push(deck.pop());
    hands[1].push(deck.pop());
  }
  return hands;
}

function createEmptyExpeditions() {
  const expeditions = {};
  for (const color of COLORS) {
    expeditions[color] = [];
  }
  return expeditions;
}

function createEmptyDiscards() {
  const discards = {};
  for (const color of COLORS) {
    discards[color] = [];
  }
  return discards;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function getTopDiscard(discardPiles, color) {
  const pile = discardPiles[color];
  if (!pile || pile.length === 0) return null;
  return pile[pile.length - 1];
}

function canPlayToExpedition(expedition, card) {
  if (card.type === "wager") {
    if (expedition.length === 0) return true;
    return expedition.every((c) => c.type === "wager");
  }
  // number card
  const lastNumber = [...expedition].reverse().find((c) => c.type === "number");
  if (!lastNumber) return true;
  return card.value > lastNumber.value;
}

function scoreExpedition(expedition) {
  if (!expedition || expedition.length === 0) return 0;
  const wagers = expedition.filter((c) => c.type === "wager").length;
  const numbers = expedition.filter((c) => c.type === "number");
  const sum = numbers.reduce((acc, c) => acc + c.value, 0);
  let score = sum - 20;
  const multiplier = wagers === 0 ? 1 : 1 + wagers;
  score *= multiplier;
  if (expedition.length >= 8) score += 20;
  return score;
}

function scoreAll(expeditions) {
  const scores = {};
  let total = 0;
  for (const color of COLORS) {
    const score = scoreExpedition(expeditions[color]);
    scores[color] = score;
    total += score;
  }
  return { scores, total };
}

function calcMatchWins(history) {
  const wins = [0, 0];
  for (const round of history || []) {
    const score0 = round?.scores?.[0] ?? 0;
    const score1 = round?.scores?.[1] ?? 0;
    if (score0 > score1) wins[0] += 1;
    if (score1 > score0) wins[1] += 1;
  }
  return wins;
}

function roundWinner(score0, score1) {
  if (score0 > score1) return 0;
  if (score1 > score0) return 1;
  return -1;
}

function createRoundState(startingPlayer = 0) {
  const deck = createDeck();
  const [handA, handB] = dealHands(deck);
  return {
    deck,
    discardPiles: createEmptyDiscards(),
    hands: [handA, handB],
    expeditions: [createEmptyExpeditions(), createEmptyExpeditions()],
    turn: startingPlayer,
    startingPlayer,
    phase: "play",
    lastDiscard: null,
    finished: false
  };
}

function createGameState(roundsTotal = 3) {
  return {
    roundsTotal,
    roundIndex: 1,
    round: createRoundState(0),
    scores: [0, 0],
    history: [],
    roundResult: null
  };
}

function isGameOver(state) {
  return state.roundIndex === state.roundsTotal && state.round.finished;
}

function getPlayerView(state, playerIndex) {
  const opponent = playerIndex === 0 ? 1 : 0;
  const round = state.round;
  const matchWins = calcMatchWins(state.history);
  const roundScores = [
    scoreAll(round.expeditions[0]).total,
    scoreAll(round.expeditions[1]).total
  ];
  return {
    you: playerIndex,
    roundsTotal: state.roundsTotal,
    roundIndex: state.roundIndex,
    scores: state.scores,
    matchWins,
    history: state.history,
    roundScores,
    roundResult: state.roundResult
      ? {
          roundIndex: state.roundResult.roundIndex,
          scores: state.roundResult.scores,
          winner: state.roundResult.winner,
          matchWins: state.roundResult.matchWins,
          canContinue: state.roundResult.canContinue,
          readyCount: state.roundResult.ready.length,
          youReady: state.roundResult.ready.includes(playerIndex)
        }
      : null,
    gameOver: isGameOver(state),
    turn: round.turn,
    phase: round.phase,
    deckCount: round.deck.length,
    discardTops: COLORS.reduce((acc, color) => {
      acc[color] = getTopDiscard(round.discardPiles, color);
      return acc;
    }, {}),
    your: {
      hand: round.hands[playerIndex],
      expeditions: round.expeditions[playerIndex]
    },
    opponent: {
      handCount: round.hands[opponent].length,
      expeditions: round.expeditions[opponent]
    },
    lastDiscard: round.lastDiscard,
    finished: round.finished
  };
}

function applyAction(state, playerIndex, action) {
  const round = state.round;
  if (action.type === "continue_round") {
    if (!state.roundResult || !state.roundResult.canContinue) {
      return { ok: false, error: "No round to continue" };
    }
    if (!state.roundResult.ready.includes(playerIndex)) {
      state.roundResult.ready.push(playerIndex);
    }
    if (state.roundResult.ready.length < 2) {
      return { ok: true };
    }
    const nextStarter = state.round?.startingPlayer === 0 ? 1 : 0;
    state.roundIndex += 1;
    state.round = createRoundState(nextStarter);
    state.roundResult = null;
    return { ok: true };
  }

  if (state.roundResult?.canContinue) {
    return { ok: false, error: "Waiting players to continue" };
  }
  if (round.finished) return { ok: false, error: "Round finished" };
  if (round.turn !== playerIndex) return { ok: false, error: "Not your turn" };
  if (action.type === "play_card") {
    if (round.phase !== "play") return { ok: false, error: "Must play before drawing" };
    const { cardId, target } = action.payload || {};
    const hand = round.hands[playerIndex];
    const cardIndex = hand.findIndex((c) => c.id === cardId);
    if (cardIndex === -1) return { ok: false, error: "Card not in hand" };
    const card = hand[cardIndex];
    if (target === "expedition") {
      const expedition = round.expeditions[playerIndex][card.color];
      if (!canPlayToExpedition(expedition, card)) return { ok: false, error: "Invalid expedition play" };
      expedition.push(card);
      hand.splice(cardIndex, 1);
      round.lastDiscard = null;
    } else if (target === "discard") {
      round.discardPiles[card.color].push(card);
      hand.splice(cardIndex, 1);
      round.lastDiscard = { playerIndex, cardId: card.id, color: card.color };
    } else {
      return { ok: false, error: "Invalid target" };
    }
    round.phase = "draw";
    return { ok: true };
  }

  if (action.type === "draw_card") {
    if (round.phase !== "draw") return { ok: false, error: "Must play before drawing" };
    const { source, color } = action.payload || {};
    let drawn = null;
    if (source === "deck") {
      if (round.deck.length === 0) return { ok: false, error: "Deck empty" };
      drawn = round.deck.pop();
    } else if (source === "discard") {
      if (!color || !round.discardPiles[color] || round.discardPiles[color].length === 0) {
        return { ok: false, error: "Discard empty" };
      }
      if (round.lastDiscard && round.lastDiscard.playerIndex === playerIndex && round.lastDiscard.color === color) {
        return { ok: false, error: "Cannot draw your just-discarded card" };
      }
      drawn = round.discardPiles[color].pop();
    } else {
      return { ok: false, error: "Invalid draw source" };
    }

    round.hands[playerIndex].push(drawn);
    round.phase = "play";
    round.turn = playerIndex === 0 ? 1 : 0;
    round.lastDiscard = null;

    if (round.deck.length === 0) {
      round.finished = true;
      const score0 = scoreAll(round.expeditions[0]).total;
      const score1 = scoreAll(round.expeditions[1]).total;
      state.scores[0] += score0;
      state.scores[1] += score1;
      state.history.push({
        roundIndex: state.roundIndex,
        scores: [score0, score1]
      });
      state.roundResult = {
        roundIndex: state.roundIndex,
        scores: [score0, score1],
        winner: roundWinner(score0, score1),
        matchWins: calcMatchWins(state.history),
        canContinue: state.roundIndex < state.roundsTotal,
        ready: []
      };
    }

    return { ok: true };
  }

  return { ok: false, error: "Unknown action" };
}

export {
  COLORS,
  createGameState,
  applyAction,
  getPlayerView,
  scoreAll,
  cloneState,
  isGameOver
};
