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
const HARD_ROOT_LIMIT = 14;
const HARD_TIME_BUDGET_MS = 700;
const CAMP_POSITION_BONUS = 36;
const HARD_CAMP_MOVE_BONUS = 220;
const HARD_CAMP_SETUP_BONUS = 40;
const HARD_SAFE_OWN_CAMP_FLIP_BONUS = 120;
const HARD_CAMP_LEAVE_PENALTY = 140;
const PROTECTION_BONUS_SCALE = 3;
const FLAG_EXPOSURE_PENALTY = 80;

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
          if (
            move.captureResult === CaptureResult.INVALID ||
            move.captureResult === CaptureResult.LOSE
          ) continue;
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
    const campExpansion = this._pickCampExpansionMove(candidates, boardState, settings, this.side);
    const campMoves = candidates.filter(move =>
      move.type === 'move' &&
      boardInstance.isCamp(move.to.col, move.to.row) &&
      !boardInstance.isCamp(move.from.col, move.from.row)
    ).sort((a, b) =>
      this._campSetupPotential(b, boardState, this.side) -
      this._campSetupPotential(a, boardState, this.side)
    );
    const flips = candidates.filter(move => move.type === 'flip');
    const preferredFlip = this._pickPreferredFlip(flips, boardState, this.side);

    if (captures.length > 0 && Math.random() > 0.3) return captures[0];
    if (campExpansion) return campExpansion;
    if (campMoves.length > 0) return campMoves[0];
    if (flips.length === candidates.length) return preferredFlip;
    if (preferredFlip && Math.random() > 0.2) return preferredFlip;
    return candidates[0];
  }

  _mediumMove(boardState, settings) {
    const moves = this._getAllMoves(boardState, settings);
    if (moves.length === 0) return null;
    const threatenedScore = this._threatenedPieceScore(boardState, settings, this.side);
    const hasCapture = moves.some(move => move.type === 'capture');
    const campExpansion = this._pickCampExpansionMove(moves, boardState, settings, this.side);
    if (!hasCapture && threatenedScore === 0 && campExpansion) return campExpansion;
    const campEntry = this._pickCampEntryMove(moves, boardState, settings, this.side);
    if (!hasCapture && threatenedScore === 0 && campEntry) return campEntry;

    for (const move of moves) {
      move.score = this._evaluateMove(move, boardState, settings) +
        this._hardStrategyBonus(move, boardState, this.side, settings, threatenedScore);
    }

    moves.sort((a, b) => b.score - a.score);
    const bestScore = moves[0].score;
    const preferred = moves.filter(move => move.score >= bestScore - 2);
    return preferred[Math.floor(Math.random() * preferred.length)];
  }

  _hardMove(boardState, settings, searchState) {
    const allMoves = this._getAllMoves(boardState, settings);
    const threatenedScore = this._threatenedPieceScore(boardState, settings, this.side);
    const hasCapture = allMoves.some(move => move.type === 'capture');
    const campExpansion = this._pickCampExpansionMove(allMoves, boardState, settings, this.side);
    if (!hasCapture && threatenedScore === 0 && campExpansion) return campExpansion;
    const campEntry = this._pickCampEntryMove(allMoves, boardState, settings, this.side);
    if (!hasCapture && threatenedScore === 0 && campEntry) return campEntry;
    const strategyBonuses = new Map(allMoves.map(move => [
      move,
      this._hardStrategyBonus(move, boardState, this.side, settings, threatenedScore)
    ]));
    const rootMoves = this._selectRootMoves(this._orderMoves(
      allMoves,
      boardState,
      settings,
      this.side,
      strategyBonuses
    ));
    if (rootMoves.length === 0) return null;

    const hiddenCount = getFlippablePositions(boardState).length;
    const targetDepth = hiddenCount > 40 ? 2 : hiddenCount > 24 ? 3 : hiddenCount > 10 ? 4 : 5;
    const context = {
      nodes: 0,
      maxNodes: HARD_NODE_BUDGET,
      deadline: Date.now() + HARD_TIME_BUDGET_MS,
      aborted: false,
      tableHits: 0,
      chanceNodes: 0,
      chanceTableHits: 0
    };
    const rootSearchState = Object.assign({ totalSteps: 0, noCapSteps: 0 }, searchState);
    const table = new Map();
    let bestMove = rootMoves[0];
    let completedDepth = 0;

    for (let depth = 1; depth <= targetDepth; depth++) {
      const totals = new Array(rootMoves.length).fill(0);
      let completed = true;

      try {
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
          ) + strategyBonuses.get(rootMoves[index]);
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
      sampleCount: hiddenCount > 0 ? this._getHiddenPieceGroups(boardState).length : 0,
      exactChance: true,
      tableHits: context.tableHits,
      chanceNodes: context.chanceNodes,
      chanceTableHits: context.chanceTableHits,
      tableSize: table.size,
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

    return this._chanceNode(
      boardState,
      move,
      depth,
      nextSide,
      settings,
      context,
      table,
      searchState
    );
  }

  _chanceNode(boardState, move, depth, nextSide, settings, context, table, searchState) {
    context.chanceNodes = (context.chanceNodes || 0) + 1;
    const key = `chance|${nextSide}|${depth}|${searchState.totalSteps}|${searchState.noCapSteps}|` +
      `${move.from.col},${move.from.row}|${this._stateKey(boardState)}`;
    const cached = table.get(key);
    if (cached && cached.flag === 'exact') {
      context.chanceTableHits = (context.chanceTableHits || 0) + 1;
      return cached.score;
    }

    const outcomes = this._getFlipOutcomes(boardState, move);
    if (outcomes.length === 0) return this._evaluateBoard(boardState, settings);

    let expectedScore = 0;
    for (const outcome of outcomes) {
      expectedScore += outcome.probability * this._alphaBeta(
        outcome.state,
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
    table.set(key, { score: expectedScore, flag: 'exact' });
    return expectedScore;
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

  _orderMoves(moves, boardState, settings, side, strategyBonuses) {
    return moves
      .map((move, index) => ({
        move,
        index,
        score: this._moveOrderScore(move, boardState, settings, side) +
          (strategyBonuses ? strategyBonuses.get(move) || 0 : 0)
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
    const regularMoveCount = tactical.length + quiet.length;
    const flipLimit = regularMoveCount === 0 ? 8 : 4;
    const rootLimit = regularMoveCount === 0 ? flipLimit : HARD_ROOT_LIMIT;
    const flips = orderedMoves.filter(move => move.type === 'flip').slice(0, flipLimit);
    const selected = new Set([...tactical, ...quiet, ...flips]);
    for (const move of orderedMoves) {
      if (selected.size >= rootLimit) break;
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

    const campAdjacency = this._campAdjacency(col, row, boardState, side);
    const adjacentCampCount = campAdjacency.own + campAdjacency.empty + campAdjacency.opponent;
    score += adjacentCampCount * 90;
    if (campAdjacency.own > 0 && campAdjacency.empty === 0) {
      score += 320 + campAdjacency.own * 40;
    }

    for (const link of boardInstance.getAdjacentPositions(col, row)) {
      const adjacent = Board.parseKey(link.pos);
      if (boardInstance.isCamp(adjacent.col, adjacent.row)) continue;

      const piece = boardState[link.pos];
      if (!piece || !piece.revealed || !side) continue;
      score += piece.side === side ? 12 : -8;
    }
    return score;
  }

  _campAdjacency(col, row, boardState, side) {
    const counts = { own: 0, empty: 0, opponent: 0 };

    for (const link of boardInstance.getAdjacentPositions(col, row)) {
      const adjacent = Board.parseKey(link.pos);
      if (!boardInstance.isCamp(adjacent.col, adjacent.row)) continue;

      const occupant = boardState[link.pos];
      if (!occupant) {
        counts.empty++;
      } else if (occupant.revealed && side) {
        counts[occupant.side === side ? 'own' : 'opponent']++;
      }
    }
    return counts;
  }

  _hardStrategyBonus(move, boardState, side, settings, threatenedScore) {
    if (move.type === 'flip') {
      const campAdjacency = this._campAdjacency(move.to.col, move.to.row, boardState, side);
      return campAdjacency.own > 0 && campAdjacency.empty === 0
        ? HARD_SAFE_OWN_CAMP_FLIP_BONUS + (campAdjacency.own - 1) * 4
        : 0;
    }

    let bonus = 0;
    if (move.type === 'move') {
      const entersCamp = boardInstance.isCamp(move.to.col, move.to.row) &&
        !boardInstance.isCamp(move.from.col, move.from.row);
      const leavesCamp = boardInstance.isCamp(move.from.col, move.from.row) &&
        !boardInstance.isCamp(move.to.col, move.to.row);
      if (entersCamp) {
        bonus += HARD_CAMP_MOVE_BONUS +
          this._campSetupPotential(move, boardState, side) * HARD_CAMP_SETUP_BONUS;
      }
      if (leavesCamp) bonus -= HARD_CAMP_LEAVE_PENALTY;
    }

    const movingPieceSurvives = move.type === 'move' ||
      (move.type === 'capture' && move.captureResult === CaptureResult.WIN);
    if (movingPieceSurvives && settings && Number.isFinite(threatenedScore)) {
      const nextState = this._simulateMove(boardState, move);
      const nextThreatenedScore = this._threatenedPieceScore(nextState, settings, side);
      bonus += (threatenedScore - nextThreatenedScore) * PROTECTION_BONUS_SCALE;
    }
    return bonus;
  }

  _campSetupPotential(move, boardState, side) {
    if (move.type !== 'move' || !boardInstance.isCamp(move.to.col, move.to.row)) return 0;

    const nextState = this._simulateMove(boardState, move);
    let safeHiddenCount = 0;
    for (const link of boardInstance.getAdjacentPositions(move.to.col, move.to.row)) {
      const piece = nextState[link.pos];
      if (!piece || piece.revealed || !piece.alive) continue;

      const position = Board.parseKey(link.pos);
      const campAdjacency = this._campAdjacency(position.col, position.row, nextState, side);
      if (campAdjacency.own > 0 && campAdjacency.empty === 0) safeHiddenCount++;
    }
    return safeHiddenCount;
  }

  _pickCampExpansionMove(moves, boardState, settings, side) {
    const candidates = moves.map((move, index) => ({
      move,
      index,
      potential: this._campExpansionPotential(move, boardState, settings, side)
    })).filter(item => item.potential > 0);
    if (candidates.length === 0) return null;

    candidates.sort((a, b) =>
      b.potential - a.potential ||
      this._moveOrderScore(b.move, boardState, settings, side) -
        this._moveOrderScore(a.move, boardState, settings, side) ||
      a.index - b.index
    );
    return candidates[0].move;
  }

  _pickCampEntryMove(moves, boardState, settings, side) {
    const candidates = moves.map((move, index) => ({
      move,
      index,
      setupPotential: this._campSetupPotential(move, boardState, side)
    })).filter(item =>
      item.move.type === 'move' &&
      boardInstance.isCamp(item.move.to.col, item.move.to.row) &&
      !boardInstance.isCamp(item.move.from.col, item.move.from.row)
    );
    if (candidates.length === 0) return null;

    candidates.sort((a, b) =>
      b.setupPotential - a.setupPotential ||
      this._moveOrderScore(b.move, boardState, settings, side) -
        this._moveOrderScore(a.move, boardState, settings, side) ||
      a.index - b.index
    );
    return candidates[0].move;
  }

  _campExpansionPotential(move, boardState, settings, side) {
    if (
      move.type !== 'move' ||
      !boardInstance.isCamp(move.from.col, move.from.row) ||
      !boardInstance.isCamp(move.to.col, move.to.row)
    ) return 0;

    const nextState = this._simulateMove(boardState, move);
    let readyPieces = 0;
    for (const link of boardInstance.getAdjacentPositions(move.from.col, move.from.row)) {
      const piece = nextState[link.pos];
      if (
        !piece ||
        !piece.alive ||
        !piece.revealed ||
        piece.side !== side ||
        !canMove(piece.type)
      ) continue;

      const position = Board.parseKey(link.pos);
      if (boardInstance.isCamp(position.col, position.row)) continue;
      const canFillVacatedCamp = getReachablePositions(
        position.col,
        position.row,
        piece,
        nextState,
        settings
      ).some(target => target.col === move.from.col && target.row === move.from.row);
      if (canFillVacatedCamp) readyPieces++;
    }
    return readyPieces;
  }

  _threatenedPieceScore(boardState, settings, side) {
    const threatened = new Map();
    const opponent = this._oppositeSide(side);

    for (const key in boardState) {
      const attacker = boardState[key];
      if (!attacker || !attacker.alive || !attacker.revealed || attacker.side !== opponent) continue;
      if (!canMove(attacker.type)) continue;

      const from = Board.parseKey(key);
      const reachable = getReachablePositions(from.col, from.row, attacker, boardState, settings);
      for (const target of reachable) {
        const targetKey = Board.posKey(target.col, target.row);
        const defender = boardState[targetKey];
        if (!defender || !defender.alive || !defender.revealed || defender.side !== side) continue;

        const result = judgeCapture(attacker, defender, settings, boardState);
        if (result !== CaptureResult.WIN && result !== CaptureResult.DRAW) continue;
        const risk = PieceValue[defender.type] * (result === CaptureResult.WIN ? 1 : 0.75);
        threatened.set(targetKey, Math.max(threatened.get(targetKey) || 0, risk));
      }
    }
    return Array.from(threatened.values()).reduce((total, value) => total + value, 0);
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
      score += sign * (this._revealedPieceValue(piece) + this._positionValue(col, row, piece));
      if (piece.type === PieceType.FLAG) score -= sign * FLAG_EXPOSURE_PENALTY;
    }
    return score;
  }

  _revealedPieceValue(piece) {
    if (!canMove(piece.type)) return 0;
    let value = 6 + Math.min(18, PieceValue[piece.type] * 0.12);
    if (piece.type === PieceType.ENGINEER) value += 8;
    if (piece.type === PieceType.BOMB) value += 5;
    return value;
  }

  _positionValue(col, row, piece) {
    let value = 10 - Math.abs(col - 2) * 2 - Math.abs(row - 5.5) * 0.5;
    if (boardInstance.isOnRail(col, row) && canMove(piece.type)) value += 5;
    if (boardInstance.isCamp(col, row)) value += CAMP_POSITION_BONUS;
    if (piece.type === PieceType.ENGINEER && boardInstance.isOnRail(col, row)) value += 5;
    return value;
  }

  _getHiddenPieceGroups(boardState) {
    const groups = new Map();
    const hidden = Object.keys(boardState)
      .filter(key => boardState[key] && boardState[key].alive && !boardState[key].revealed)
      .map(key => ({ key, piece: boardState[key] }))
      .sort((a, b) => {
        const categoryCompare = `${a.piece.side}:${a.piece.type}`.localeCompare(
          `${b.piece.side}:${b.piece.type}`
        );
        if (categoryCompare !== 0) return categoryCompare;
        return String(a.piece.id).localeCompare(String(b.piece.id));
      });

    for (const entry of hidden) {
      const category = `${entry.piece.side}:${entry.piece.type}`;
      const group = groups.get(category);
      if (group) {
        group.count++;
      } else {
        groups.set(category, {
          side: entry.piece.side,
          type: entry.piece.type,
          count: 1,
          sourceKey: entry.key
        });
      }
    }
    return Array.from(groups.values());
  }

  _getFlipOutcomes(boardState, move) {
    const groups = this._getHiddenPieceGroups(boardState);
    const totalCount = groups.reduce((total, group) => total + group.count, 0);
    if (totalCount === 0) return [];

    return groups.map(group => ({
      side: group.side,
      type: group.type,
      count: group.count,
      probability: group.count / totalCount,
      state: this._simulateFlipOutcome(boardState, move, group.sourceKey)
    }));
  }

  _sampleFlipOutcomes(boardState, move) {
    return this._getFlipOutcomes(boardState, move).map(outcome => outcome.state);
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
