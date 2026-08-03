/**
 * rules.js - 规则引擎
 * 处理吃子判定、胜负判定、规则配置
 */

const { PieceType, PieceRank, Side, canMove } = require('./pieces');
const { boardInstance, Board, NodeType } = require('./board');
const { getReachablePositions } = require('./pathfinder');

// 吃子结果
const CaptureResult = {
  WIN: 'win',       // 攻方胜
  LOSE: 'lose',     // 攻方败
  DRAW: 'draw',     // 同归于尽
  INVALID: 'invalid' // 不能吃
};

// 游戏结果
const GameResult = {
  PLAYING: 'playing',
  RED_WIN: 'red_win',
  BLUE_WIN: 'blue_win',
  DRAW: 'draw'
};

// 默认规则配置
const DefaultSettings = {
  drawSteps: 0,         // 0=不限, 70, 100 连续无吃子判和的步数
  hqCapture: true,      // 大本营是否允许吃子
  mineRule: 'engineer',  // 'engineer'=仅工兵, 'smallest'=当前最小棋子
  flagRule: 'smallest',  // 'engineer'=仅工兵, 'smallest'=当前最小棋子
  firstMover: 'human'    // 'human'=玩家先手, 'ai'=电脑先手
};

function normalizeSettings(settings) {
  const normalized = Object.assign({}, DefaultSettings, settings || {});
  normalized.drawSteps = normalized.drawSteps === 70 || normalized.drawSteps === 100
    ? normalized.drawSteps
    : 0;
  normalized.hqCapture = normalized.hqCapture !== false;
  normalized.mineRule = normalized.mineRule === 'smallest' || normalized.mineRule === 'any'
    ? 'smallest'
    : 'engineer';
  normalized.flagRule = normalized.flagRule === 'engineer' || normalized.flagRule === 'any'
    ? 'engineer'
    : 'smallest';
  normalized.firstMover = normalized.firstMover === 'ai' ? 'ai' : 'human';
  return normalized;
}

function isCurrentSmallestPiece(piece, boardState) {
  const pieceRank = piece && PieceRank[piece.type];
  if (!piece || !piece.alive || !canMove(piece.type) || pieceRank < PieceRank[PieceType.ENGINEER]) {
    return false;
  }

  let smallestRank = pieceRank;
  for (const key in boardState) {
    const candidate = boardState[key];
    if (!candidate || !candidate.alive || candidate.side !== piece.side || !canMove(candidate.type)) continue;
    const candidateRank = PieceRank[candidate.type];
    if (candidateRank >= PieceRank[PieceType.ENGINEER]) {
      smallestRank = Math.min(smallestRank, candidateRank);
    }
  }
  return pieceRank === smallestRank;
}

/**
 * 判断吃子结果
 * @param {Object} attacker - 攻方棋子
 * @param {Object} defender - 守方棋子
 * @param {Object} settings - 规则配置
 * @param {Object} boardState - 棋盘状态（用于判断攻方当前最小棋子）
 * @returns {string} CaptureResult
 */
function judgeCapture(attacker, defender, settings, boardState) {
  if (!attacker || !defender) return CaptureResult.INVALID;
  if (attacker.side === defender.side) return CaptureResult.INVALID;
  
  settings = normalizeSettings(settings);

  // 地雷规则
  if (defender.type === PieceType.MINE) {
    if (settings.mineRule === 'engineer') {
      return attacker.type === PieceType.ENGINEER ? CaptureResult.WIN : CaptureResult.INVALID;
    }
    return isCurrentSmallestPiece(attacker, boardState) ? CaptureResult.WIN : CaptureResult.INVALID;
  }

  // 军旗规则
  if (defender.type === PieceType.FLAG) {
    if (settings.flagRule === 'engineer') {
      return attacker.type === PieceType.ENGINEER ? CaptureResult.WIN : CaptureResult.INVALID;
    }
    return isCurrentSmallestPiece(attacker, boardState) ? CaptureResult.WIN : CaptureResult.INVALID;
  }

  // 炸弹规则: 与任何普通棋子同归于尽
  if (attacker.type === PieceType.BOMB || defender.type === PieceType.BOMB) {
    return CaptureResult.DRAW;
  }

  // 攻方是不可移动的棋子（地雷/军旗）不能攻击
  if (!canMove(attacker.type)) {
    return CaptureResult.INVALID;
  }

  // 普通棋子比较等级
  const attackRank = PieceRank[attacker.type];
  const defendRank = PieceRank[defender.type];

  if (attackRank > defendRank) {
    return CaptureResult.WIN;
  } else if (attackRank === defendRank) {
    return CaptureResult.DRAW;
  } else {
    return CaptureResult.LOSE;
  }
}

/**
 * 统计一方存活的地雷数量
 */
function countAliveMines(side, boardState) {
  let count = 0;
  for (const key in boardState) {
    const piece = boardState[key];
    if (piece && piece.side === side && piece.type === PieceType.MINE && piece.alive) {
      count++;
    }
  }
  return count;
}

/**
 * 检查一方是否还有可移动的棋子
 */
function hasMovablePieces(side, boardState, settings) {
  for (const key in boardState) {
    const piece = boardState[key];
    if (!piece || piece.side !== side || !piece.alive || !piece.revealed || !canMove(piece.type)) continue;

    const { col, row } = Board.parseKey(key);
    const reachable = getReachablePositions(col, row, piece, boardState, settings);
    const hasLegalMove = reachable.some(target => {
      const targetPiece = boardState[Board.posKey(target.col, target.row)];
      return !targetPiece || judgeCapture(piece, targetPiece, settings, boardState) !== CaptureResult.INVALID;
    });
    if (hasLegalMove) return true;
  }
  return false;
}

/**
 * 检查一方是否还有未翻开的棋子
 */
function hasUnrevealedPieces(side, boardState) {
  for (const key in boardState) {
    const piece = boardState[key];
    if (piece && piece.side === side && piece.alive && !piece.revealed) {
      return true;
    }
  }
  return false;
}

/**
 * 检查一方的军旗是否还存活
 */
function isFlagAlive(side, boardState) {
  for (const key in boardState) {
    const piece = boardState[key];
    if (piece && piece.side === side && piece.type === PieceType.FLAG && piece.alive) {
      return true;
    }
  }
  return false;
}

/**
 * 判断游戏结果
 * @param {Object} boardState - 棋盘状态
 * @param {string} currentSide - 当前回合方
 * @param {number} totalSteps - 总步数
 * @param {number} noCapSteps - 连续无吃子步数
 * @param {Object} settings - 规则配置
 * @returns {string} GameResult
 */
function checkGameResult(boardState, currentSide, totalSteps, noCapSteps, settings) {
  settings = settings || DefaultSettings;

  // 军旗被扛
  if (!isFlagAlive(Side.RED, boardState)) {
    return GameResult.BLUE_WIN;
  }
  if (!isFlagAlive(Side.BLUE, boardState)) {
    return GameResult.RED_WIN;
  }

  // 检查是否还有未翻开的棋子（翻棋模式，有未翻开棋子则游戏继续）
  const hasUnrevealed = hasUnrevealedPieces(Side.RED, boardState) || 
                        hasUnrevealedPieces(Side.BLUE, boardState);

  // 没有可移动棋子，且没有未翻开的棋子
  if (!hasUnrevealed) {
    const redCanMove = hasMovablePieces(Side.RED, boardState, settings);
    const blueCanMove = hasMovablePieces(Side.BLUE, boardState, settings);

    if (!redCanMove && !blueCanMove) {
      return GameResult.DRAW;
    }
    if (!redCanMove) {
      return GameResult.BLUE_WIN;
    }
    if (!blueCanMove) {
      return GameResult.RED_WIN;
    }
  }

  // 和棋判定（步数限制）
  if (settings.drawSteps > 0 && noCapSteps >= settings.drawSteps) {
    return GameResult.DRAW;
  }

  // 总步数上限
  if (totalSteps >= 1000) {
    return GameResult.DRAW;
  }

  return GameResult.PLAYING;
}

/**
 * 检查是否可以在大本营吃子
 */
function canCaptureInHQ(col, row, settings) {
  if (!boardInstance.isHQ(col, row)) return true;
  return settings.hqCapture;
}

module.exports = {
  CaptureResult,
  GameResult,
  DefaultSettings,
  normalizeSettings,
  judgeCapture,
  checkGameResult,
  hasMovablePieces,
  hasUnrevealedPieces,
  isFlagAlive,
  countAliveMines,
  canCaptureInHQ
};
