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
  mineRule: 'engineer',  // 'engineer'=仅工兵, 'any'=任意棋子
  flagRule: 'smallest'   // 'smallest'=最小棋子, 'any'=任意棋子
};

/**
 * 判断吃子结果
 * @param {Object} attacker - 攻方棋子
 * @param {Object} defender - 守方棋子
 * @param {Object} settings - 规则配置
 * @param {Object} boardState - 棋盘状态（用于检查地雷是否全部被挖）
 * @returns {string} CaptureResult
 */
function judgeCapture(attacker, defender, settings, boardState) {
  if (!attacker || !defender) return CaptureResult.INVALID;
  if (attacker.side === defender.side) return CaptureResult.INVALID;
  
  settings = settings || DefaultSettings;

  // 炸弹规则: 与任何棋子同归于尽
  if (attacker.type === PieceType.BOMB) {
    return CaptureResult.DRAW;
  }
  if (defender.type === PieceType.BOMB) {
    return CaptureResult.DRAW;
  }

  // 地雷规则
  if (defender.type === PieceType.MINE) {
    if (settings.mineRule === 'engineer') {
      // 仅工兵可以挖雷
      if (attacker.type === PieceType.ENGINEER) {
        return CaptureResult.WIN;
      }
      return CaptureResult.INVALID;
    } else {
      // 任意棋子可以碰地雷 (碰地雷同归于尽, 工兵挖雷存活)
      if (attacker.type === PieceType.ENGINEER) {
        return CaptureResult.WIN;
      }
      return CaptureResult.DRAW;
    }
  }

  // 军旗规则
  if (defender.type === PieceType.FLAG) {
    if (settings.flagRule === 'smallest') {
      // 检查守方地雷是否全部被挖
      const defenderMinesAlive = countAliveMines(defender.side, boardState);
      if (defenderMinesAlive > 0) {
        // 地雷未挖完，只有工兵可以尝试（但实际上不行，因为要先挖雷）
        return CaptureResult.INVALID;
      }
      // 地雷挖完了，最小棋子(工兵)可以扛旗
      return CaptureResult.WIN;
    } else {
      // 任意棋子可以扛旗
      return CaptureResult.WIN;
    }
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
  judgeCapture,
  checkGameResult,
  hasMovablePieces,
  hasUnrevealedPieces,
  isFlagAlive,
  countAliveMines,
  canCaptureInHQ
};
