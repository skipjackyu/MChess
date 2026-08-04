/**
 * gameManager.js - 游戏状态管理器
 * 管理游戏流程、状态、悔棋、历史记录
 */

const { Board } = require('./board');
const { Side, generateAllPieces, canMove, PieceType } = require('./pieces');
const { getReachablePositions, getFlippablePositions } = require('./pathfinder');
const { judgeCapture, CaptureResult, checkGameResult, GameResult, normalizeSettings, canCaptureInHQ } = require('./rules');
const { AI, Difficulty } = require('./ai');

// 游戏模式
const GameMode = {
  PVP: 'pvp',   // 双人对战
  PVE: 'pve',   // 人机对战
  ENDGAME: 'endgame' // 随机残局
};

function isAiMode(mode) {
  return mode === GameMode.PVE || mode === GameMode.ENDGAME;
}

/**
 * 游戏管理器
 */
class GameManager {
  constructor() {
    this.reset();
  }

  /**
   * 重置游戏
   */
  reset(mode, difficulty, settings, options) {
    // 游戏模式
    this.mode = mode || GameMode.PVE;
    
    // AI难度
    this.difficulty = difficulty || Difficulty.EASY;
    
    // 规则设置
    this.settings = normalizeSettings(settings);
    this.random = options && typeof options.random === 'function' ? options.random : Math.random;
    this.scenario = null;
    
    // 棋盘状态: posKey => piece
    this.boardState = {};
    
    // 当前回合方
    this.currentSide = null; // 翻棋模式下，翻第一个棋子后决定
    
    // 先手方
    this.firstSide = null;
    
    // 步数统计
    this.totalSteps = 0;
    this.noCapSteps = 0;
    
    // 历史记录（用于悔棋）
    this.history = [];

    // 对局快照操作日志（用于持久化复盘）
    this.startedAt = Date.now();
    this.replayInitialBoard = null;
    this.replayInitialSide = Side.RED;
    this.replayInitialSidesAssigned = false;
    this.replayInitialPlayerSide = null;
    this.replayInitialAiSide = null;
    this.replayActions = [];
    this.isReplay = false;
    
    // 游戏结果
    this.gameResult = GameResult.PLAYING;
    
    // AI实例
    this.ai = null;
    this.aiSide = null;
    
    // 选中状态
    this.selectedPos = null;
    this.reachablePositions = [];
    
    // 是否已确定阵营
    this.sidesAssigned = false;

    // 玩家阵营
    this.playerSide = null;

    // 初始化棋盘
    this._initBoard();
    this.replayInitialBoard = this._cloneBoardState();
    
    if (this.isAiOpeningTurn()) {
      this.ai = new AI(null, this.difficulty);
    }
  }

  /**
   * 初始化棋盘 - 随机放置所有棋子（翻棋模式）
   */
  _initBoard() {
    const allPieces = generateAllPieces();
    
    // 获取所有可放置位置（排除大本营行以外? 不，翻棋是所有位置都可以放）
    // 在翻棋模式中，所有60个位置都放棋子，但实际上只有50个棋子
    // 实际上标准翻棋只用25+25=50个棋子放在50个位置上
    // 棋盘是5×12=60个位置，但上下阵营各有30个位置，5个行营不放棋子
    // 每方: 30 - 5行营 = 25个位置 = 25个棋子，正好
    
    const upperNonCamp = [];
    const lowerNonCamp = [];
    
    for (let row = 0; row <= 5; row++) {
      for (let col = 0; col < 5; col++) {
        const board = require('./board').boardInstance;
        if (!board.isCamp(col, row)) {
          upperNonCamp.push(Board.posKey(col, row));
        }
      }
    }
    
    for (let row = 6; row <= 11; row++) {
      for (let col = 0; col < 5; col++) {
        const board = require('./board').boardInstance;
        if (!board.isCamp(col, row)) {
          lowerNonCamp.push(Board.posKey(col, row));
        }
      }
    }
    
    // 合并所有非行营位置，随机放棋子
    const allPositions = [...upperNonCamp, ...lowerNonCamp];
    
    // 洗牌
    this._shuffle(allPositions);
    this._shuffle(allPieces);
    
    // 放置棋子
    for (let i = 0; i < allPieces.length && i < allPositions.length; i++) {
      const piece = allPieces[i];
      piece.revealed = false;
      piece.alive = true;
      this.boardState[allPositions[i]] = piece;
    }
    
    // 翻棋模式: 第一步是翻棋，先手尚未确定
    this.currentSide = Side.RED; // 默认蓝方先行（翻棋后可能变化）
  }

  /**
   * 处理翻棋操作
   */
  flipPiece(col, row, actor) {
    if (this.gameResult !== GameResult.PLAYING) return null;
    
    const key = Board.posKey(col, row);
    const piece = this.boardState[key];
    
    if (!piece || piece.revealed) return null;
    
    // 保存历史（用于悔棋）
    this._saveHistory();
    
    // 翻开棋子
    piece.revealed = true;
    
    // 如果是第一次翻棋，确定阵营
    if (!this.sidesAssigned) {
      this.sidesAssigned = true;
      this.firstSide = piece.side;
      this.currentSide = piece.side;

      if (isAiMode(this.mode)) {
        if (actor === 'ai') {
          this.aiSide = piece.side;
          this.playerSide = this._oppositeSide(piece.side);
        } else {
          this.playerSide = piece.side;
          this.aiSide = this._oppositeSide(piece.side);
        }
        this.ai = new AI(this.aiSide, this.difficulty);
      } else {
        this.playerSide = piece.side;
      }
    }
    const actingSide = this.currentSide;
    
    // 切换回合
    this.totalSteps++;
    this.noCapSteps++;
    this._switchSide();

    this._recordReplayAction({
      type: 'flip',
      at: [col, row],
      actorSide: actingSide
    });
    
    // 清除选中
    this.selectedPos = null;
    this.reachablePositions = [];
    
    return {
      type: 'flip',
      piece: piece,
      pos: { col, row }
    };
  }

  /**
   * 处理选中棋子
   */
  selectPiece(col, row) {
    if (this.gameResult !== GameResult.PLAYING) return false;
    
    const key = Board.posKey(col, row);
    const piece = this.boardState[key];
    
    if (!piece || !piece.revealed || piece.side !== this.currentSide) {
      return false;
    }
    
    if (!canMove(piece.type)) return false;

    this.selectedPos = { col, row };
    this.reachablePositions = getReachablePositions(
      col,
      row,
      piece,
      this.boardState,
      this.settings
    ).filter(target => {
      const targetPiece = this.boardState[Board.posKey(target.col, target.row)];
      if (!targetPiece) return true;
      const captureResult = judgeCapture(piece, targetPiece, this.settings, this.boardState);
      return captureResult !== CaptureResult.INVALID && captureResult !== CaptureResult.LOSE;
    });
    
    return true;
  }

  /**
   * 处理移动/吃子操作
   */
  movePiece(fromCol, fromRow, toCol, toRow) {
    if (this.gameResult !== GameResult.PLAYING) return null;
    
    const fromKey = Board.posKey(fromCol, fromRow);
    const toKey = Board.posKey(toCol, toRow);
    const piece = this.boardState[fromKey];
    const targetPiece = this.boardState[toKey];
    
    if (!piece || !piece.revealed || piece.side !== this.currentSide) return null;
    const actingSide = this.currentSide;
    
    // 检查目标位置是否在可达范围内
    const isReachable = this.reachablePositions.some(p => p.col === toCol && p.row === toRow);
    if (!isReachable) return null;
    
    // 保存历史
    this._saveHistory();
    
    let result;
    
    if (targetPiece) {
      // 大本营吃子检查
      if (!canCaptureInHQ(toCol, toRow, this.settings)) {
        this.history.pop(); // 回退历史
        return null;
      }
      
      // 吃子
      const captureResult = judgeCapture(piece, targetPiece, this.settings, this.boardState);
      if (captureResult === CaptureResult.INVALID || captureResult === CaptureResult.LOSE) {
        this.history.pop();
        return null;
      }
      
      if (captureResult === CaptureResult.WIN) {
        // 攻方胜
        delete this.boardState[fromKey];
        this.boardState[toKey] = piece;
        result = { type: 'capture', result: 'win', attacker: piece, defender: targetPiece };
      } else if (captureResult === CaptureResult.DRAW) {
        // 同归于尽
        delete this.boardState[fromKey];
        delete this.boardState[toKey];
        result = { type: 'capture', result: 'draw', attacker: piece, defender: targetPiece };
      } else {
        this.history.pop();
        return null;
      }
      
      this.noCapSteps = 0;
    } else {
      // 普通移动
      delete this.boardState[fromKey];
      this.boardState[toKey] = piece;
      result = { type: 'move', piece: piece };
      this.noCapSteps++;
    }
    
    this.totalSteps++;
    
    // 清除选中
    this.selectedPos = null;
    this.reachablePositions = [];
    
    // 检查游戏结果
    this.gameResult = checkGameResult(this.boardState, this.currentSide, this.totalSteps, this.noCapSteps, this.settings);
    
    if (this.gameResult === GameResult.PLAYING) {
      this._switchSide();
    }

    this._recordReplayAction({
      type: 'move',
      from: [fromCol, fromRow],
      to: [toCol, toRow],
      actorSide: actingSide,
      result: result.type === 'capture' ? result.result : 'move'
    });
    
    return result;
  }

  /**
   * 处理点击事件
   * @returns {Object} 操作结果
   */
  handleTap(col, row) {
    if (this.gameResult !== GameResult.PLAYING) return { action: 'gameover' };

    if (this.isAiOpeningTurn()) {
      return { action: 'ai_turn' };
    }
    
    // PVE模式下，如果是AI的回合，不响应点击
    if (isAiMode(this.mode) && this.sidesAssigned && this.currentSide === this.aiSide) {
      return { action: 'ai_turn' };
    }
    
    const key = Board.posKey(col, row);
    const piece = this.boardState[key];
    
    // 1. 如果有选中棋子，尝试移动
    if (this.selectedPos) {
      const { col: sc, row: sr } = this.selectedPos;
      
      // 点击自己已选中的棋子 → 取消选中
      if (sc === col && sr === row) {
        this.selectedPos = null;
        this.reachablePositions = [];
        return { action: 'deselect' };
      }
      
      // 点击可达位置 → 移动/吃子
      const isReachable = this.reachablePositions.some(p => p.col === col && p.row === row);
      if (isReachable) {
        const moveResult = this.movePiece(sc, sr, col, row);
        if (moveResult) {
          return { action: 'moved', detail: moveResult };
        }
      }
      
      // 点击自己的其他棋子 → 切换选中
      if (piece && piece.revealed && piece.side === this.currentSide && canMove(piece.type)) {
        this.selectPiece(col, row);
        return { action: 'select', pos: { col, row } };
      }
      
      // 点击无效位置 → 取消选中
      this.selectedPos = null;
      this.reachablePositions = [];
      return { action: 'deselect' };
    }
    
    // 2. 点击未翻开的棋子 → 翻棋
    if (piece && !piece.revealed) {
      const flipResult = this.flipPiece(col, row);
      if (flipResult) {
        return { action: 'flipped', detail: flipResult };
      }
    }
    
    // 3. 点击自己的已翻开棋子 → 选中
    if (piece && piece.revealed && piece.side === this.currentSide && canMove(piece.type)) {
      this.selectPiece(col, row);
      return { action: 'select', pos: { col, row } };
    }
    
    return { action: 'none' };
  }

  /**
   * AI走棋
   */
  aiMove() {
    if (this.gameResult !== GameResult.PLAYING) return null;

    if (this.isAiOpeningTurn()) {
      if (!this.ai) this.ai = new AI(null, this.difficulty);
      const openingMove = this.ai.getOpeningMove(this.boardState, this.settings);
      return openingMove
        ? this.flipPiece(openingMove.from.col, openingMove.from.row, 'ai')
        : null;
    }

    if (!this.ai || this.currentSide !== this.aiSide) return null;
    
    const move = this.ai.getMove(this.boardState, this.settings, {
      totalSteps: this.totalSteps,
      noCapSteps: this.noCapSteps
    });
    if (!move) return null;
    
    if (move.type === 'flip') {
      return this.flipPiece(move.from.col, move.from.row, 'ai');
    } else {
      // 先选中再移动
      this.selectPiece(move.from.col, move.from.row);
      return this.movePiece(move.from.col, move.from.row, move.to.col, move.to.row);
    }
  }

  /**
   * 悔棋
   */
  undo() {
    if (this.history.length === 0) return false;
    
    if (isAiMode(this.mode)) {
      // PVE模式: 撤销两步（自己的和AI的）
      if (this.history.length >= 2) {
        this.history.pop(); // AI的步骤
        const snapshot = this.history.pop(); // 玩家的步骤
        this._restoreSnapshot(snapshot);
        return true;
      } else if (this.history.length === 1) {
        const snapshot = this.history.pop();
        this._restoreSnapshot(snapshot);
        return true;
      }
    } else {
      // PVP模式: 撤销一步
      const snapshot = this.history.pop();
      this._restoreSnapshot(snapshot);
      return true;
    }
    
    return false;
  }

  /**
   * 保存历史快照
   */
  _saveHistory() {
    const snapshot = {
      boardState: this._cloneBoardState(),
      currentSide: this.currentSide,
      totalSteps: this.totalSteps,
      noCapSteps: this.noCapSteps,
      gameResult: this.gameResult,
      sidesAssigned: this.sidesAssigned,
      playerSide: this.playerSide,
      aiSide: this.aiSide,
      selectedPos: this.selectedPos ? { ...this.selectedPos } : null,
      replayActionCount: this.replayActions.length
    };
    this.history.push(snapshot);
    
    // 限制历史记录最多100步
    if (this.history.length > 100) {
      this.history.shift();
    }
  }

  /**
   * 恢复快照
   */
  _restoreSnapshot(snapshot) {
    this.boardState = snapshot.boardState;
    this.currentSide = snapshot.currentSide;
    this.totalSteps = snapshot.totalSteps;
    this.noCapSteps = snapshot.noCapSteps;
    this.gameResult = snapshot.gameResult;
    this.sidesAssigned = snapshot.sidesAssigned;
    this.playerSide = snapshot.playerSide;
    this.aiSide = snapshot.aiSide;
    this.selectedPos = null;
    this.reachablePositions = [];
    this.replayActions.length = snapshot.replayActionCount;
    
    this.ai = this.aiSide
      ? new AI(this.aiSide, this.difficulty)
      : this.isAiOpeningTurn()
        ? new AI(null, this.difficulty)
        : null;
  }

  isAiOpeningTurn() {
    return this.mode === GameMode.PVE && !this.sidesAssigned && this.settings.firstMover === 'ai';
  }

  isAiTurn() {
    return this.isAiOpeningTurn() || (
      isAiMode(this.mode) &&
      this.sidesAssigned &&
      this.currentSide === this.aiSide
    );
  }

  _oppositeSide(side) {
    return side === Side.RED ? Side.BLUE : Side.RED;
  }

  /**
   * 深拷贝棋盘状态
   */
  _cloneBoardState() {
    const clone = {};
    for (const key in this.boardState) {
      clone[key] = Object.assign({}, this.boardState[key]);
    }
    return clone;
  }

  _recordReplayAction(action) {
    this.replayActions.push(Object.assign({}, action, {
      currentSide: this.currentSide,
      noCapSteps: this.noCapSteps,
      gameResult: this.gameResult
    }));
  }

  exportSnapshot() {
    return {
      version: 1,
      startedAt: this.startedAt,
      completedAt: Date.now(),
      mode: this.mode,
      difficulty: this.difficulty,
      settings: Object.assign({}, this.settings),
      result: this.gameResult,
      totalSteps: this.totalSteps,
      playerSide: this.playerSide,
      aiSide: this.aiSide,
      initialSide: this.replayInitialSide,
      initialSidesAssigned: this.replayInitialSidesAssigned,
      initialPlayerSide: this.replayInitialPlayerSide,
      initialAiSide: this.replayInitialAiSide,
      scenario: this.scenario ? Object.assign({}, this.scenario) : null,
      initialBoard: this._cloneBoard(this.replayInitialBoard),
      actions: this.replayActions.map(action => Object.assign({}, action, {
        at: action.at ? [...action.at] : undefined,
        from: action.from ? [...action.from] : undefined,
        to: action.to ? [...action.to] : undefined
      }))
    };
  }

  loadScenario(scenario) {
    if (!scenario || !scenario.boardState) return false;
    if (scenario.currentSide !== Side.RED && scenario.currentSide !== Side.BLUE) return false;
    if (scenario.playerSide !== Side.RED && scenario.playerSide !== Side.BLUE) return false;
    if (scenario.aiSide !== Side.RED && scenario.aiSide !== Side.BLUE) return false;
    if (scenario.playerSide === scenario.aiSide) return false;

    this.mode = GameMode.ENDGAME;
    this.difficulty = scenario.difficulty || Difficulty.EASY;
    this.settings = normalizeSettings(scenario.settings);
    this.boardState = this._cloneBoard(scenario.boardState);
    this.currentSide = scenario.currentSide;
    this.firstSide = scenario.playerSide;
    this.totalSteps = 0;
    this.noCapSteps = 0;
    this.history = [];
    this.gameResult = checkGameResult(this.boardState, this.currentSide, 0, 0, this.settings);
    if (this.gameResult !== GameResult.PLAYING) return false;
    this.aiSide = scenario.aiSide;
    this.ai = new AI(this.aiSide, this.difficulty);
    this.selectedPos = null;
    this.reachablePositions = [];
    this.sidesAssigned = true;
    this.playerSide = scenario.playerSide;
    this.startedAt = Date.now();
    this.replayInitialBoard = this._cloneBoard(this.boardState);
    this.replayInitialSide = this.currentSide;
    this.replayInitialSidesAssigned = true;
    this.replayInitialPlayerSide = this.playerSide;
    this.replayInitialAiSide = this.aiSide;
    this.replayActions = [];
    this.isReplay = false;
    this.scenario = {
      version: scenario.version || 1,
      generatorVersion: scenario.generatorVersion || 1,
      seed: scenario.seed || '',
      sourceSteps: scenario.sourceSteps || 0
    };
    return true;
  }

  loadReplaySnapshot(snapshot, step) {
    if (!snapshot || !snapshot.initialBoard || !Array.isArray(snapshot.actions)) {
      return false;
    }

    const replayStep = Math.max(0, Math.min(Number(step) || 0, snapshot.actions.length));
    this.mode = snapshot.mode || GameMode.PVE;
    this.difficulty = snapshot.difficulty || Difficulty.EASY;
    this.settings = normalizeSettings(snapshot.settings);
    this.boardState = this._cloneBoard(snapshot.initialBoard);
    this.currentSide = snapshot.initialSide || Side.RED;
    this.firstSide = null;
    this.totalSteps = 0;
    this.noCapSteps = 0;
    this.history = [];
    this.gameResult = GameResult.PLAYING;
    this.ai = null;
    this.aiSide = null;
    this.selectedPos = null;
    this.reachablePositions = [];
    this.sidesAssigned = Boolean(snapshot.initialSidesAssigned);
    this.playerSide = snapshot.initialPlayerSide || null;
    this.aiSide = snapshot.initialAiSide || null;
    this.startedAt = snapshot.startedAt || Date.now();
    this.replayInitialBoard = this._cloneBoard(snapshot.initialBoard);
    this.replayInitialSide = snapshot.initialSide || Side.RED;
    this.replayInitialSidesAssigned = Boolean(snapshot.initialSidesAssigned);
    this.replayInitialPlayerSide = snapshot.initialPlayerSide || null;
    this.replayInitialAiSide = snapshot.initialAiSide || null;
    this.replayActions = snapshot.actions.map(action => Object.assign({}, action));
    this.isReplay = true;
    this.scenario = snapshot.scenario ? Object.assign({}, snapshot.scenario) : null;

    for (let index = 0; index < replayStep; index++) {
      this._applyReplayAction(snapshot.actions[index]);
    }

    if (replayStep > 0) {
      const frame = snapshot.actions[replayStep - 1];
      this.currentSide = frame.currentSide;
      this.noCapSteps = frame.noCapSteps;
      this.gameResult = frame.gameResult;
      this.sidesAssigned = true;
      this.playerSide = snapshot.playerSide;
      this.aiSide = snapshot.aiSide;
    }
    this.totalSteps = replayStep;
    return true;
  }

  _applyReplayAction(action) {
    if (action.type === 'flip' && action.at) {
      const piece = this.boardState[Board.posKey(action.at[0], action.at[1])];
      if (piece) piece.revealed = true;
      return;
    }

    if (action.type !== 'move' || !action.from || !action.to) return;
    const fromKey = Board.posKey(action.from[0], action.from[1]);
    const toKey = Board.posKey(action.to[0], action.to[1]);
    const piece = this.boardState[fromKey];

    if (action.result === 'draw') {
      delete this.boardState[fromKey];
      delete this.boardState[toKey];
    } else if (action.result === 'lose') {
      delete this.boardState[fromKey];
    } else if (piece) {
      delete this.boardState[fromKey];
      this.boardState[toKey] = piece;
    }
  }

  _cloneBoard(boardState) {
    const clone = {};
    for (const key in boardState || {}) {
      clone[key] = Object.assign({}, boardState[key]);
    }
    return clone;
  }

  /**
   * 切换回合方
   */
  _switchSide() {
    this.currentSide = this.currentSide === Side.RED ? Side.BLUE : Side.RED;
  }

  /**
   * 洗牌
   */
  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * 获取当前游戏状态摘要（用于UI显示）
   */
  getStatusText() {
    if (this.gameResult === GameResult.RED_WIN) return '蓝方获胜！';
    if (this.gameResult === GameResult.BLUE_WIN) return '橙方获胜！';
    if (this.gameResult === GameResult.DRAW) return '和棋！';
    
    if (!this.sidesAssigned) return '请翻开一个棋子';
    
    if (isAiMode(this.mode) && this.currentSide === this.aiSide) {
      return 'AI思考中...';
    }
    
    const sideName = this.currentSide === Side.RED ? '蓝方' : '橙方';
    return `${sideName}走棋`;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let redCount = 0, blueCount = 0;
    let redRevealed = 0, blueRevealed = 0;
    
    for (const key in this.boardState) {
      const piece = this.boardState[key];
      if (!piece || !piece.alive) continue;
      
      if (piece.side === Side.RED) {
        redCount++;
        if (piece.revealed) redRevealed++;
      } else {
        blueCount++;
        if (piece.revealed) blueRevealed++;
      }
    }
    
    return {
      totalSteps: this.totalSteps,
      noCapSteps: this.noCapSteps,
      redCount,
      blueCount,
      redRevealed,
      blueRevealed,
      unrevealedCount: (redCount - redRevealed) + (blueCount - blueRevealed)
    };
  }
}

module.exports = {
  GameManager,
  GameMode,
  isAiMode
};
