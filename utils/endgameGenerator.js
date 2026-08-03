const { AI, Difficulty } = require('./ai');
const { GameManager, GameMode } = require('./gameManager');
const { PieceType, PieceValue, Side, canMove } = require('./pieces');
const { CaptureResult, DefaultSettings, GameResult, checkGameResult, isFlagAlive } = require('./rules');

const GENERATOR_VERSION = 1;
const MAX_ATTEMPTS = 12;
const MAX_SIMULATION_STEPS = 220;

const DifficultyProfile = {
  [Difficulty.EASY]: {
    minPieces: 18,
    maxPieces: 28,
    minHidden: 1,
    maxHidden: 7,
    targetScore: 45
  },
  [Difficulty.MEDIUM]: {
    minPieces: 16,
    maxPieces: 26,
    minHidden: 2,
    maxHidden: 8,
    targetScore: 0
  },
  [Difficulty.HARD]: {
    minPieces: 14,
    maxPieces: 24,
    minHidden: 2,
    maxHidden: 9,
    targetScore: -35
  }
};

function createEndgameSeed() {
  const timePart = Date.now().toString(36).toUpperCase();
  const randomPart = Math.floor(Math.random() * 0x1000000).toString(36).padStart(5, '0').toUpperCase();
  return `${timePart}-${randomPart}`;
}

function createSeededRandom(seed) {
  let state = 2166136261;
  const text = String(seed || 'MCHESS');
  for (let index = 0; index < text.length; index++) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  state >>>= 0;

  return function random() {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneBoard(boardState) {
  const clone = {};
  for (const key in boardState) {
    clone[key] = Object.assign({}, boardState[key]);
  }
  return clone;
}

function countBoard(boardState) {
  let pieces = 0;
  let hidden = 0;
  for (const key in boardState) {
    const piece = boardState[key];
    if (!piece || !piece.alive) continue;
    pieces++;
    if (!piece.revealed) hidden++;
  }
  return { pieces, hidden };
}

function sideScore(side, boardState, settings) {
  let score = 0;
  const moveCounter = new AI(side, Difficulty.EASY);
  for (const key in boardState) {
    const piece = boardState[key];
    if (!piece || !piece.alive || piece.side !== side) continue;
    if (piece.type !== PieceType.FLAG) score += PieceValue[piece.type] || 0;
    if (piece.revealed && canMove(piece.type)) score += 3;
  }
  const legalMoves = moveCounter._getAllMoves(boardState, settings, side);
  score += Math.min(legalMoves.length, 20);
  return score;
}

function evaluateForSide(side, boardState, settings) {
  const opponent = side === Side.RED ? Side.BLUE : Side.RED;
  return sideScore(side, boardState, settings) - sideScore(opponent, boardState, settings);
}

function chooseMove(game, random, targetHidden) {
  const moveSource = new AI(game.currentSide, Difficulty.EASY);
  const moves = moveSource._getAllMoves(game.boardState, game.settings, game.currentSide);
  if (moves.length === 0) return null;

  const captures = moves.filter(move => (
    move.type === 'capture' &&
    move.targetPiece &&
    move.targetPiece.type !== PieceType.FLAG &&
    move.captureResult !== CaptureResult.INVALID
  ));
  const safeCaptures = captures.filter(move => move.captureResult !== CaptureResult.LOSE);
  const flips = moves.filter(move => move.type === 'flip');
  const regularMoves = moves.filter(move => move.type === 'move');
  const hiddenCount = countBoard(game.boardState).hidden;

  if (safeCaptures.length > 0 && (hiddenCount <= targetHidden || random() < 0.82)) {
    safeCaptures.sort((left, right) => {
      const leftValue = left.targetPiece ? PieceValue[left.targetPiece.type] || 0 : 0;
      const rightValue = right.targetPiece ? PieceValue[right.targetPiece.type] || 0 : 0;
      return rightValue - leftValue;
    });
    return safeCaptures[Math.floor(random() * Math.min(3, safeCaptures.length))];
  }

  if (flips.length > 0 && (hiddenCount > targetHidden || regularMoves.length === 0 || random() < 0.38)) {
    return flips[Math.floor(random() * flips.length)];
  }

  if (captures.length > 0 && random() < 0.25) {
    return captures[Math.floor(random() * captures.length)];
  }

  const candidates = regularMoves.length > 0 ? regularMoves : flips;
  return candidates[Math.floor(random() * candidates.length)] || null;
}

function applyMove(game, move) {
  if (!move) return false;
  if (move.type === 'flip') {
    return Boolean(game.flipPiece(move.from.col, move.from.row));
  }
  if (!game.selectPiece(move.from.col, move.from.row)) return false;
  return Boolean(game.movePiece(move.from.col, move.from.row, move.to.col, move.to.row));
}

function candidatePenalty(candidate, profile) {
  const piecePenalty = candidate.pieces < profile.minPieces
    ? (profile.minPieces - candidate.pieces) * 20
    : candidate.pieces > profile.maxPieces
      ? (candidate.pieces - profile.maxPieces) * 20
      : 0;
  const hiddenPenalty = candidate.hidden < profile.minHidden
    ? (profile.minHidden - candidate.hidden) * 12
    : candidate.hidden > profile.maxHidden
      ? (candidate.hidden - profile.maxHidden) * 12
      : 0;
  return piecePenalty + hiddenPenalty + Math.abs(candidate.score - profile.targetScore);
}

function buildCandidate(game, seed, difficulty, settings, sourceSteps) {
  const counts = countBoard(game.boardState);
  if (!game.sidesAssigned || game.gameResult !== GameResult.PLAYING) return null;
  if (!isFlagAlive(Side.RED, game.boardState) || !isFlagAlive(Side.BLUE, game.boardState)) return null;

  const currentMoves = new AI(game.currentSide, Difficulty.EASY)
    ._getAllMoves(game.boardState, settings, game.currentSide);
  const opponent = game.currentSide === Side.RED ? Side.BLUE : Side.RED;
  const opponentMoves = new AI(opponent, Difficulty.EASY)
    ._getAllMoves(game.boardState, settings, opponent);
  if (currentMoves.length === 0 || opponentMoves.length === 0) return null;
  if (checkGameResult(game.boardState, game.currentSide, 0, 0, settings) !== GameResult.PLAYING) return null;

  return {
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    seed,
    difficulty,
    settings: Object.assign({}, settings),
    boardState: cloneBoard(game.boardState),
    currentSide: game.currentSide,
    playerSide: game.currentSide,
    aiSide: opponent,
    sourceSteps,
    pieces: counts.pieces,
    hidden: counts.hidden,
    score: evaluateForSide(game.currentSide, game.boardState, settings)
  };
}

function generateEndgame(options) {
  const difficulty = options && DifficultyProfile[options.difficulty]
    ? options.difficulty
    : Difficulty.MEDIUM;
  const settings = Object.assign({}, DefaultSettings, options && options.settings || {});
  const seed = options && options.seed ? String(options.seed) : createEndgameSeed();
  const profile = DifficultyProfile[difficulty];
  let bestCandidate = null;
  let bestPenalty = Infinity;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const random = createSeededRandom(`${seed}:${attempt}`);
    const generationSettings = Object.assign({}, settings, { drawSteps: 0 });
    const game = new GameManager();
    game.reset(GameMode.PVP, Difficulty.EASY, generationSettings, { random });
    const targetHidden = profile.minHidden + Math.floor(random() * (profile.maxHidden - profile.minHidden + 1));
    let sourceSteps = 0;

    while (sourceSteps < MAX_SIMULATION_STEPS && game.gameResult === GameResult.PLAYING) {
      const move = chooseMove(game, random, targetHidden);
      if (!applyMove(game, move)) break;
      sourceSteps++;

      const counts = countBoard(game.boardState);
      if (
        sourceSteps >= 45 &&
        counts.pieces <= profile.maxPieces &&
        counts.hidden <= profile.maxHidden
      ) {
        break;
      }
    }

    const candidate = buildCandidate(game, seed, difficulty, settings, sourceSteps);
    if (!candidate) continue;
    const penalty = candidatePenalty(candidate, profile);
    if (penalty < bestPenalty) {
      bestCandidate = candidate;
      bestPenalty = penalty;
    }
    if (penalty === 0) break;
  }

  if (!bestCandidate) {
    throw new Error('无法生成合法残局');
  }
  return bestCandidate;
}

module.exports = {
  GENERATOR_VERSION,
  createEndgameSeed,
  createSeededRandom,
  generateEndgame
};
