/**
 * ai.js - AI 引擎
 * 三级难度的AI：简单(随机)、中等(贪心)、困难(隐藏信息搜索)
 */

const { Board, boardInstance } = require('./board');
const { PieceType, PieceValue, Side, canMove } = require('./pieces');
const { getReachablePositions, getFlippablePositions } = require('./pathfinder');
const { judgeCapture, CaptureResult, checkGameResult, GameResult } = require('./rules');

const Difficulty = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard'
};

const WIN_SCORE = 100000;
const HARD_NODE_BUDGET = 60000;
const HARD_BRANCH_LIMIT = 14;
const HARD_ROOT_LIMIT = 12;
const HARD_TIME_BUDGET_MS = 700;
const FLIP_OUTCOME_SAMPLES = 4;

class AI {
  constructor(side, difficulty) {
    this.side = side;
    this.difficulty = difficulty || Difficulty.EASY;
    this.lastSearchStats = null;
  }

  getMove(boardState, settings, searchState) {
    switch (this.difficulty) {
      case Difficulty.EASY:
        return this._easyMove(boardState, settings);
      case Difficulty.MEDIUM:
        return this._mediumMove(boardState, settings);
      case Difficulty.HARD:
        return this._hardMove(boardState, settings, searchState);
      default:
        return this._easyMove(boardState, settings);
    }
  }

  getOpeningMove(boardState, settings) {
    const flips = this._getAllMoves(boardState, settings).filter(move => move.type === 'flip');
    return this._pickPreferredFlip(flips, boardState, null);
  }

  _getAllMoves(boardState, settings, side) {
    const currentSide = side || this.side;
    const moves = [];

    for (const pos of getFlippablePositions(boardState)) {
      moves.push({
        type: 'flip',
        from: { col: pos.col, row: pos.row },
        to: { col: pos.col, row: pos.row },
        score: 0
      });
    }

    for (const key in boardState) {
      const piece = boardState[key];
      if (!piece || piece.side !== currentSide || !piece.revealed || !piece.alive) continue;
      if (!canMove(piece.type)) continue;

      const { col, row } = Board.parseKey(key);
      const reachable = getReachablePositions(col, row, piece, boardState, settings);

      for (const target of reachable) {
        const targetKey = Board.posKey(target.col, target.row);
        const targetPiece = boardState[targetKey];
        const move = {
          type: targetPiece ? 'capture' : 'move',
          from: { col, row },
          to: target,
          piece,
          targetPiece,
          score: 0
        };

        if (targetPiece) {
          move.captureResult = judgeCapture(piece, targetPiece, settings, boardState);
          if (move.captureResult === CaptureResult.INVALID) continue;
        }

        moves.push(move);
      }
    }

    return moves;
  }

  _easyMove(boardState, settings) {
    const moves = this._getAllMoves(boardState, settings);
    if (moves.length === 0) return null;

    const safeMoves = moves.filter(move =>
      move.type !== 'capture' || move.captureResult !== CaptureResult.LOSE
    );
    const candidates = safeMoves.length > 0 ? safeMoves : moves;
    this._shuffle(candidates);
    const captures = candidates.filter(move => move.type === 'capture');
    const flips = candidates.filter(move => move.type === 'flip');
    const preferredFlip = this._pickPreferredFlip(flips, boardState, this.side);

    if (captures.length > 0 && Math.random() > 0.3) return captures[0];
    if (flips.length === candidates.length) return preferredFlip;
    if (preferredFlip && Math.random() > 0.2) return preferredFlip;
    return candidates[0];
  }

  _mediumMove(boardState, settings) {
    const moves = this._getAllMoves(boardState, settings);
    if (moves.length === 0) return null;

    for (const move of moves) {
      move.score = this._evaluateMove(move, boardState, settings);
    }

    moves.sort((a, b) => b.score - a.score);
    return moves[Math.floor(Math.random() * Math.min(3, moves.length))];
  }

  _hardMove(boardState, settings, searchState) {
    const rootMoves = this._selectRootMoves(this._orderMoves(
      this._getAllMoves(boardState, settings),
      boardState,
      settings,
      this.side
    ));
    if (rootMoves.length === 0) return null;

    const hiddenCount = getFlippablePositions(boardState).length;
    const targetDepth = hiddenCount > 40 ? 2 : hiddenCount > 24 ? 3 : 4;
    const context = {
      nodes: 0,
      maxNodes: HARD_NODE_BUDGET,
      deadline: Date.now() + HARD_TIME_BUDGET_MS,
      aborted: false,
      tableHits: 0
    };
    const rootSearchState = Object.assign({ totalSteps: 0, noCapSteps: 0 }, searchState);
    let bestMove = rootMoves[0];
    let completedDepth = 0;

    for (let depth = 1; depth <= targetDepth; depth++) {
      const totals = new Array(rootMoves.length).fill(0);
      let completed = true;

      try {
        const table = new Map();
        for (let index = 0; index < rootMoves.length; index++) {
          totals[index] = this._searchMove(
            boardState,
            rootMoves[index],
            depth - 1,
            -Infinity,
            Infinity,
            this._oppositeSide(this.side),
            settings,
            context,
            table,
            this._nextSearchState(rootSearchState, rootMoves[index])
          );
        }
      } catch (error) {
        if (!error || error.code !== 'AI_NODE_BUDGET') throw error;
        completed = false;
      }

      if (!completed) break;

      completedDepth = depth;
      let bestIndex = 0;
      for (let index = 1; index < totals.length; index++) {
        if (totals[index] > totals[bestIndex]) bestIndex = index;
      }
      bestMove = rootMoves[bestIndex];
    }

    this.lastSearchStats = {
      nodes: context.nodes,
      completedDepth,
      targetDepth,
      sampleCount: hiddenCount > 0 ? this._flipSampleCount(hiddenCount) : 0,
      tableHits: context.tableHits,
      hiddenCount,
      aborted: context.aborted
    };
    return bestMove;
  }

  _searchMove(boardState, move, depth, alpha, beta, nextSide, settings, context, table, searchState) {
    if (move.type !== 'flip') {
      return this._alphaBeta(
        this._simulateMove(boardState, move),
        depth,
        alpha,
        beta,
        nextSide,
        settings,
        context,
        table,
        searchState
      );
    }

    const outcomes = this._sampleFlipOutcomes(boardState, move);
    if (outcomes.length === 0) return this._evaluateBoard(boardState, settings);

    let total = 0;
    for (const outcomeState of outcomes) {
      total += this._alphaBeta(
        outcomeState,
        depth,
        -Infinity,
        Infinity,
        nextSide,
        settings,
        context,
        table,
        searchState
      );
    }
    return total / outcomes.length;
  }

  _alphaBeta(boardState, depth, alpha, beta, sideToMove, settings, context, table, searchState) {
    this._visitNode(context);

    const terminalScore = this._terminalScore(boardState, depth, settings, searchState);
    if (terminalScore !== null) return terminalScore;
    if (depth <= 0) {
      return this._quiescence(boardState, alpha, beta, sideToMove, settings, context, 1, searchState);
    }

    const originalAlpha = alpha;
    const originalBeta = beta;
    const key = `${sideToMove}|${depth}|${searchState.totalSteps}|${searchState.noCapSteps}|${this._stateKey(boardState)}`;
    const cached = table.get(key);
    if (cached) {
      context.tableHits++;
      if (cached.flag === 'exact') return cached.score;
      if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
      if (cached.flag === 'upper') beta = Math.min(beta, cached.score);
      if (alpha >= beta) return cached.score;
    }

    const moves = this._selectSearchMoves(this._orderMoves(
      this._getAllMoves(boardState, settings, sideToMove),
      boardState,
      settings,
      sideToMove
    ));
    if (moves.length === 0) return sideToMove === this.side ? -WIN_SCORE + depth : WIN_SCORE - depth;

    const maximizing = sideToMove === this.side;
    let bestScore = maximizing ? -Infinity : Infinity;

    for (const move of moves) {
      const score = this._searchMove(
        boardState,
        move,
        depth - 1,
        alpha,
        beta,
        this._oppositeSide(sideToMove),
        settings,
        context,
        table,
        this._nextSearchState(searchState, move)
      );

      if (maximizing) {
        bestScore = Math.max(bestScore, score);
        alpha = Math.max(alpha, bestScore);
      } else {
        bestScore = Math.min(bestScore, score);
        beta = Math.min(beta, bestScore);
      }
      if (alpha >= beta) break;
    }

    let flag = 'exact';
    if (bestScore <= originalAlpha) flag = 'upper';
    if (bestScore >= originalBeta) flag = 'lower';
    table.set(key, { score: bestScore, flag });
    return bestScore;
  }

  _quiescence(boardState, alpha, beta, sideToMove, settings, context, remainingDepth, searchState) {
    const standingScore = this._evaluateBoard(boardState, settings);
    if (remainingDepth <= 0) return standingScore;

    const maximizing = sideToMove === this.side;
    if (maximizing) {
      if (standingScore >= beta) return standingScore;
      alpha = Math.max(alpha, standingScore);
    } else {
      if (standingScore <= alpha) return standingScore;
      beta = Math.min(beta, standingScore);
    }

    const captures = this._orderMoves(
      this._getAllMoves(boardState, settings, sideToMove).filter(move => move.type === 'capture'),
      boardState,
      settings,
      sideToMove
    ).slice(0, 8);
    let bestScore = standingScore;

    for (const move of captures) {
      this._visitNode(context);
      const childState = this._simulateMove(boardState, move);
      const terminalScore = this._terminalScore(
        childState,
        0,
        settings,
        this._nextSearchState(searchState, move)
      );
      const score = terminalScore === null
        ? this._evaluateBoard(childState, settings)
        : terminalScore;

      if (maximizing) {
        bestScore = Math.max(bestScore, score);
        alpha = Math.max(alpha, bestScore);
      } else {
        bestScore = Math.min(bestScore, score);
        beta = Math.min(beta, bestScore);
      }
      if (alpha >= beta) break;
    }

    return bestScore;
  }

  _visitNode(context) {
    context.nodes++;
    const withinNodeBudget = context.nodes <= context.maxNodes;
    const withinTimeBudget = context.nodes % 128 !== 0 || Date.now() <= context.deadline;
    if (withinNodeBudget && withinTimeBudget) return;
    context.aborted = true;
    const error = new Error('AI node budget reached');
    error.code = 'AI_NODE_BUDGET';
    throw error;
  }

  _terminalScore(boardState, depth, settings, searchState) {
    const result = checkGameResult(
      boardState,
      this.side,
      searchState.totalSteps,
      searchState.noCapSteps,
      settings
    );
    if (result === GameResult.PLAYING) return null;
    if (result === GameResult.DRAW) return 0;

    const won = (result === GameResult.RED_WIN && this.side === Side.RED) ||
      (result === GameResult.BLUE_WIN && this.side === Side.BLUE);
    return won ? WIN_SCORE + depth : -WIN_SCORE - depth;
  }

  _orderMoves(moves, boardState, settings, side) {
    return moves
      .map((move, index) => ({
        move,
        index,
        score: this._moveOrderScore(move, boardState, settings, side)
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(item => item.move);
  }

  _selectSearchMoves(orderedMoves) {
    if (orderedMoves.length <= HARD_BRANCH_LIMIT) return orderedMoves;

    const selected = [];
    const addMoves = (type, limit) => {
      for (const move of orderedMoves) {
        if (move.type !== type || selected.includes(move)) continue;
        selected.push(move);
        if (selected.filter(item => item.type === type).length >= limit) break;
      }
    };

    addMoves('capture', 6);
    addMoves('move', 4);
    addMoves('flip', 4);
    for (const move of orderedMoves) {
      if (selected.length >= HARD_BRANCH_LIMIT) break;
      if (!selected.includes(move)) selected.push(move);
    }
    const selectedSet = new Set(selected);
    return orderedMoves.filter(move => selectedSet.has(move));
  }

  _selectRootMoves(orderedMoves) {
    if (orderedMoves.length <= HARD_ROOT_LIMIT) return orderedMoves;

    const tactical = orderedMoves.filter(move => move.type === 'capture').slice(0, 6);
    const quiet = orderedMoves.filter(move => move.type === 'move').slice(0, 4);
    const flips = orderedMoves.filter(move => move.type === 'flip').slice(0, 2);
    const selected = new Set([...tactical, ...quiet, ...flips]);
    for (const move of orderedMoves) {
      if (selected.size >= HARD_ROOT_LIMIT) break;
      selected.add(move);
    }
    return orderedMoves.filter(move => selected.has(move));
  }

  _moveOrderScore(move, boardState, settings, side) {
    if (move.type === 'capture') {
      const targetValue = PieceValue[move.targetPiece.type];
      const attackerValue = PieceValue[move.piece.type];
      if (move.targetPiece.type === PieceType.FLAG) return 100000;
      if (move.captureResult === CaptureResult.WIN) return 20000 + targetValue * 10 - attackerValue;
      if (move.captureResult === CaptureResult.DRAW) return 10000 + targetValue * 5 - attackerValue * 4;
      return 1000 - attackerValue * 5;
    }

    if (move.type === 'flip') {
      return this._flipPositionScore(move.to.col, move.to.row, boardState, side);
    }

    const before = this._positionValue(move.from.col, move.from.row, move.piece);
    const after = this._positionValue(move.to.col, move.to.row, move.piece);
    return 100 + after - before;
  }

  _flipPositionScore(col, row, boardState, side) {
    let score = 400 - Math.abs(col - 2) * 12 - Math.abs(row - 5.5) * 2;
    if (boardInstance.isOnRail(col, row)) score += 20;

    for (const link of boardInstance.getAdjacentPositions(col, row)) {
      const adjacent = Board.parseKey(link.pos);
      if (boardInstance.isCamp(adjacent.col, adjacent.row)) {
        score += 90;
        continue;
      }

      const piece = boardState[link.pos];
      if (!piece || !piece.revealed || !side) continue;
      score += piece.side === side ? 12 : -8;
    }
    return score;
  }

  _pickPreferredFlip(flips, boardState, side) {
    if (flips.length === 0) return null;

    const ranked = flips.map(move => ({
      move,
      score: this._flipPositionScore(move.to.col, move.to.row, boardState, side)
    })).sort((a, b) => b.score - a.score);
    const bestScore = ranked[0].score;
    const preferred = ranked.filter(item => item.score >= bestScore - 8);
    return preferred[Math.floor(Math.random() * preferred.length)].move;
  }

  _evaluateMove(move, boardState, settings) {
    if (move.type === 'flip') return this._moveOrderScore(move, boardState, settings, this.side) / 20;
    if (move.type === 'move') return this._moveOrderScore(move, boardState, settings, this.side) / 5;

    const targetValue = PieceValue[move.targetPiece.type];
    const attackerValue = PieceValue[move.piece.type];
    if (move.captureResult === CaptureResult.WIN) return targetValue * 2 - attackerValue * 0.1;
    if (move.captureResult === CaptureResult.DRAW) return targetValue - attackerValue;
    return -attackerValue;
  }

  _evaluateBoard(boardState, settings) {
    let score = 0;

    for (const key in boardState) {
      const piece = boardState[key];
      if (!piece || !piece.alive) continue;

      const sign = piece.side === this.side ? 1 : -1;
      score += sign * PieceValue[piece.type];
      if (!piece.revealed) continue;

      const { col, row } = Board.parseKey(key);
      score += sign * (8 + this._positionValue(col, row, piece));
      if (piece.type === PieceType.FLAG) score -= sign * 35;
    }
    return score;
  }

  _positionValue(col, row, piece) {
    let value = 10 - Math.abs(col - 2) * 2 - Math.abs(row - 5.5) * 0.5;
    if (boardInstance.isOnRail(col, row) && canMove(piece.type)) value += 5;
    if (boardInstance.isCamp(col, row)) value += 8;
    if (piece.type === PieceType.ENGINEER && boardInstance.isOnRail(col, row)) value += 5;
    return value;
  }

  _sampleFlipOutcomes(boardState, move) {
    const hidden = Object.keys(boardState)
      .filter(key => boardState[key] && !boardState[key].revealed)
      .map(key => ({ key, piece: boardState[key] }))
      .sort((a, b) =>
        `${a.piece.side}:${a.piece.type}:${a.piece.id}`.localeCompare(
          `${b.piece.side}:${b.piece.type}:${b.piece.id}`
        )
      );
    if (hidden.length === 0) return [];

    const sampleCount = Math.min(this._flipSampleCount(hidden.length), hidden.length);
    const offset = this._hashText(
      `${this._stateKey(boardState)}|${move.from.col},${move.from.row}`
    ) % hidden.length;
    const outcomes = [];
    for (let sample = 0; sample < sampleCount; sample++) {
      const index = Math.floor(
        (offset + ((sample + 0.5) * hidden.length) / sampleCount) % hidden.length
      );
      outcomes.push(this._simulateFlipOutcome(boardState, move, hidden[index].key));
    }
    return outcomes;
  }

  _flipSampleCount(hiddenCount) {
    return hiddenCount > 24 ? 3 : FLIP_OUTCOME_SAMPLES;
  }

  _hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  _simulateFlipOutcome(boardState, move, sourceKey) {
    const state = this._cloneState(boardState);
    const targetKey = Board.posKey(move.from.col, move.from.row);
    if (!state[targetKey] || !state[sourceKey]) return state;

    if (sourceKey !== targetKey) {
      const targetPiece = state[targetKey];
      state[targetKey] = state[sourceKey];
      state[sourceKey] = targetPiece;
    }
    state[targetKey].revealed = true;
    return state;
  }

  _nextSearchState(searchState, move) {
    return {
      totalSteps: searchState.totalSteps + 1,
      noCapSteps: move.type === 'capture' ? 0 : searchState.noCapSteps + 1
    };
  }

  _stateKey(boardState) {
    const hiddenPool = [];
    const positions = Object.keys(boardState).sort().map(key => {
      const piece = boardState[key];
      if (!piece.revealed) {
        hiddenPool.push(`${piece.side}:${piece.type}`);
        return `${key}:hidden`;
      }
      return `${key}:${piece.side}:${piece.type}`;
    });
    hiddenPool.sort();
    return `${positions.join('|')}#${hiddenPool.join('|')}`;
  }

  _cloneState(boardState) {
    const state = {};
    for (const key in boardState) state[key] = Object.assign({}, boardState[key]);
    return state;
  }

  _simulateMove(boardState, move) {
    const newState = this._cloneState(boardState);
    const fromKey = Board.posKey(move.from.col, move.from.row);

    if (move.type === 'flip') {
      if (newState[fromKey]) newState[fromKey].revealed = true;
      return newState;
    }

    const toKey = Board.posKey(move.to.col, move.to.row);
    if (move.type === 'move') {
      newState[toKey] = newState[fromKey];
      delete newState[fromKey];
      return newState;
    }

    if (move.captureResult === CaptureResult.WIN) {
      newState[toKey] = newState[fromKey];
      delete newState[fromKey];
    } else if (move.captureResult === CaptureResult.DRAW) {
      delete newState[fromKey];
      delete newState[toKey];
    } else if (move.captureResult === CaptureResult.LOSE) {
      delete newState[fromKey];
    }
    return newState;
  }

  _oppositeSide(side) {
    const currentSide = side || this.side;
    return currentSide === Side.RED ? Side.BLUE : Side.RED;
  }

  _shuffle(arr) {
    for (let index = arr.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [arr[index], arr[swapIndex]] = [arr[swapIndex], arr[index]];
    }
    return arr;
  }
}

module.exports = {
  AI,
  Difficulty
};
