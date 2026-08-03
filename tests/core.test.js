const test = require('node:test');
const assert = require('node:assert/strict');

const { Board, NodeType, boardInstance } = require('../utils/board');
const { GameManager, GameMode } = require('../utils/gameManager');
const { Renderer } = require('../utils/renderer');
const { AI, Difficulty } = require('../utils/ai');
const {
  PieceType,
  Side,
  createPiece,
  generateAllPieces
} = require('../utils/pieces');
const {
  CaptureResult,
  GameResult,
  DefaultSettings,
  judgeCapture,
  checkGameResult
} = require('../utils/rules');

test('creates the complete 50-piece set', () => {
  const pieces = generateAllPieces();
  assert.equal(pieces.length, 50);
  assert.equal(pieces.filter((piece) => piece.side === Side.RED).length, 25);
  assert.equal(pieces.filter((piece) => piece.side === Side.BLUE).length, 25);
  assert.equal(new Set(pieces.map((piece) => piece.id)).size, 50);
});

test('board exposes 60 nodes with 10 empty camps and four headquarters', () => {
  const positions = boardInstance.getAllPositions();
  assert.equal(positions.length, 60);
  assert.equal(
    positions.filter(({ col, row }) => boardInstance.getNodeType(col, row) === NodeType.CAMP).length,
    10
  );
  assert.equal(
    positions.filter(({ col, row }) => boardInstance.getNodeType(col, row) === NodeType.HQ).length,
    4
  );
});

test('new game fills every non-camp node with a hidden piece', () => {
  const game = new GameManager();
  game.reset(GameMode.PVE, 'easy', DefaultSettings);

  assert.equal(Object.keys(game.boardState).length, 50);
  assert.equal(Object.values(game.boardState).every((piece) => !piece.revealed), true);

  for (const { col, row } of boardInstance.getAllPositions()) {
    const key = Board.posKey(col, row);
    assert.equal(Boolean(game.boardState[key]), !boardInstance.isCamp(col, row));
  }
});

test('first flip assigns player and AI sides, and undo restores setup', () => {
  const game = new GameManager();
  game.reset(GameMode.PVE, 'medium', DefaultSettings);
  const key = Object.keys(game.boardState)[0];
  const position = Board.parseKey(key);
  const revealedSide = game.boardState[key].side;

  const result = game.handleTap(position.col, position.row);
  assert.equal(result.action, 'flipped');
  assert.equal(game.playerSide, revealedSide);
  assert.equal(game.aiSide, revealedSide === Side.RED ? Side.BLUE : Side.RED);
  assert.equal(game.currentSide, game.aiSide);
  assert.equal(game.totalSteps, 1);

  assert.equal(game.undo(), true);
  assert.equal(game.boardState[key].revealed, false);
  assert.equal(game.sidesAssigned, false);
  assert.equal(game.totalSteps, 0);
});

test('capture rules preserve bomb, mine, and flag behavior', () => {
  const engineer = createPiece(PieceType.ENGINEER, Side.RED, 1);
  const general = createPiece(PieceType.GENERAL, Side.RED, 2);
  const mine = createPiece(PieceType.MINE, Side.BLUE, 3);
  const bomb = createPiece(PieceType.BOMB, Side.BLUE, 4);
  const flag = createPiece(PieceType.FLAG, Side.BLUE, 5);

  assert.equal(judgeCapture(engineer, mine, DefaultSettings, {}), CaptureResult.WIN);
  assert.equal(judgeCapture(general, mine, DefaultSettings, {}), CaptureResult.INVALID);
  assert.equal(judgeCapture(general, bomb, DefaultSettings, {}), CaptureResult.DRAW);
  assert.equal(
    judgeCapture(engineer, flag, DefaultSettings, { mine }),
    CaptureResult.INVALID
  );
  assert.equal(judgeCapture(engineer, flag, DefaultSettings, {}), CaptureResult.WIN);
});

test('renderer converts every node between board and canvas coordinates', () => {
  const sizes = [
    { width: 312, height: 392 },
    { width: 360, height: 493 },
    { width: 382, height: 650 }
  ];

  for (const size of sizes) {
    const renderer = new Renderer({}, size.width, size.height, 2);
    for (const { col, row } of boardInstance.getAllPositions()) {
      const point = renderer.boardToCanvas(col, row);
      assert.deepEqual(renderer.canvasToBoard(point.x, point.y), { col, row });

      const bounds = renderer.getPieceBounds(col, row, 7);
      assert.ok(bounds.left >= 0, `piece clips on left at ${col},${row}`);
      assert.ok(bounds.top >= 0, `piece clips on top at ${col},${row}`);
      assert.ok(bounds.right <= renderer.width, `piece clips on right at ${col},${row}`);
      assert.ok(bounds.bottom <= renderer.height, `piece clips on bottom at ${col},${row}`);
    }
  }
});

test('hard AI takes an immediately available flag', () => {
  const boardState = {
    [Board.posKey(0, 0)]: Object.assign(createPiece(PieceType.ENGINEER, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 2), { revealed: true }),
    [Board.posKey(4, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 3), { revealed: true }),
    [Board.posKey(4, 10)]: Object.assign(createPiece(PieceType.ENGINEER, Side.BLUE, 4), { revealed: true })
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const move = ai.getMove(boardState, Object.assign({}, DefaultSettings, { flagRule: 'any' }));

  assert.equal(move.type, 'capture');
  assert.deepEqual(move.from, { col: 0, row: 0 });
  assert.deepEqual(move.to, { col: 1, row: 0 });
  assert.ok(ai.lastSearchStats.completedDepth >= 1);
});

test('hard AI search keeps legal losing captures for sacrifice analysis', () => {
  const boardState = {
    [Board.posKey(0, 0)]: Object.assign(createPiece(PieceType.PLATOON, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.COMMANDER, Side.BLUE, 2), { revealed: true }),
    [Board.posKey(4, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 3), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 4), { revealed: true })
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const moves = ai._getAllMoves(boardState, DefaultSettings);
  const sacrifice = moves.find(move => move.type === 'capture' && move.to.col === 1 && move.to.row === 0);

  assert.ok(sacrifice);
  assert.equal(sacrifice.captureResult, CaptureResult.LOSE);
  const nextState = ai._simulateMove(boardState, sacrifice);
  assert.equal(nextState[Board.posKey(0, 0)], undefined);
  assert.equal(nextState[Board.posKey(1, 0)].type, PieceType.COMMANDER);
});

test('hard AI does not depend on hidden piece locations', () => {
  const boardState = {
    [Board.posKey(0, 0)]: Object.assign(createPiece(PieceType.COMMANDER, Side.RED, 1), { revealed: true }),
    [Board.posKey(4, 0)]: Object.assign(createPiece(PieceType.GENERAL, Side.BLUE, 2), { revealed: true }),
    [Board.posKey(0, 11)]: createPiece(PieceType.FLAG, Side.RED, 3),
    [Board.posKey(1, 11)]: createPiece(PieceType.ENGINEER, Side.RED, 4),
    [Board.posKey(3, 11)]: createPiece(PieceType.FLAG, Side.BLUE, 5),
    [Board.posKey(4, 11)]: createPiece(PieceType.BOMB, Side.BLUE, 6)
  };
  const swappedState = Object.assign({}, boardState, {
    [Board.posKey(0, 11)]: boardState[Board.posKey(4, 11)],
    [Board.posKey(4, 11)]: boardState[Board.posKey(0, 11)]
  });
  const firstAI = new AI(Side.RED, Difficulty.HARD);
  const secondAI = new AI(Side.RED, Difficulty.HARD);
  const firstMove = firstAI.getMove(boardState, DefaultSettings);
  const secondMove = secondAI.getMove(swappedState, DefaultSettings);
  const flipMove = { type: 'flip', from: { col: 0, row: 11 }, to: { col: 0, row: 11 } };
  const firstOutcomes = firstAI._sampleFlipOutcomes(boardState, flipMove).map(state => {
    const piece = state[Board.posKey(0, 11)];
    return `${piece.side}:${piece.type}`;
  });
  const secondOutcomes = secondAI._sampleFlipOutcomes(swappedState, flipMove).map(state => {
    const piece = state[Board.posKey(0, 11)];
    return `${piece.side}:${piece.type}`;
  });

  assert.deepEqual(
    { type: firstMove.type, from: firstMove.from, to: firstMove.to },
    { type: secondMove.type, from: secondMove.from, to: secondMove.to }
  );
  assert.deepEqual(firstOutcomes, secondOutcomes);
});

test('hard AI search tracks configured draw counters', () => {
  const ai = new AI(Side.RED, Difficulty.HARD);
  const boardState = {
    [Board.posKey(0, 0)]: Object.assign(createPiece(PieceType.ENGINEER, Side.RED, 1), { revealed: true }),
    [Board.posKey(4, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 2), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 3), { revealed: true }),
    [Board.posKey(4, 10)]: Object.assign(createPiece(PieceType.ENGINEER, Side.BLUE, 4), { revealed: true })
  };
  const settings = Object.assign({}, DefaultSettings, { drawSteps: 5 });

  assert.equal(ai._terminalScore(boardState, 0, settings, { totalSteps: 10, noCapSteps: 4 }), null);
  assert.equal(ai._terminalScore(boardState, 0, settings, { totalSteps: 11, noCapSteps: 5 }), 0);
});

test('blocked movable pieces are treated as having no legal move', () => {
  const boardState = {
    [Board.posKey(0, 0)]: Object.assign(createPiece(PieceType.ENGINEER, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.MINE, Side.RED, 2), { revealed: true }),
    [Board.posKey(0, 1)]: Object.assign(createPiece(PieceType.MINE, Side.RED, 3), { revealed: true }),
    [Board.posKey(1, 1)]: Object.assign(createPiece(PieceType.MINE, Side.RED, 4), { revealed: true }),
    [Board.posKey(0, 2)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 5), { revealed: true }),
    [Board.posKey(4, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 6), { revealed: true }),
    [Board.posKey(4, 10)]: Object.assign(createPiece(PieceType.ENGINEER, Side.BLUE, 7), { revealed: true })
  };

  assert.equal(checkGameResult(boardState, Side.RED, 10, 0, DefaultSettings), GameResult.BLUE_WIN);
});

test('game snapshots replay board state and discard undone actions', () => {
  const game = new GameManager();
  game.reset(GameMode.PVP, Difficulty.EASY, Object.assign({}, DefaultSettings, { flagRule: 'any' }));
  game.boardState = {
    [Board.posKey(0, 0)]: Object.assign(createPiece(PieceType.ENGINEER, Side.RED, 1), { revealed: true }),
    [Board.posKey(4, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 2), { revealed: true }),
    [Board.posKey(4, 11)]: Object.assign(createPiece(PieceType.ENGINEER, Side.BLUE, 3), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 4), { revealed: true })
  };
  game.currentSide = Side.RED;
  game.sidesAssigned = true;
  game.playerSide = Side.RED;
  game.replayInitialBoard = game._cloneBoardState();
  game.replayActions = [];

  assert.equal(game.selectPiece(0, 0), true);
  assert.ok(game.movePiece(0, 0, 1, 0));
  assert.equal(game.replayActions.length, 1);

  const snapshot = game.exportSnapshot();
  const replay = new GameManager();
  assert.equal(replay.loadReplaySnapshot(snapshot, 0), true);
  assert.ok(replay.boardState[Board.posKey(0, 0)]);
  assert.equal(replay.boardState[Board.posKey(1, 0)], undefined);

  assert.equal(replay.loadReplaySnapshot(snapshot, 1), true);
  assert.equal(replay.boardState[Board.posKey(0, 0)], undefined);
  assert.equal(replay.boardState[Board.posKey(1, 0)].type, PieceType.ENGINEER);
  assert.equal(replay.totalSteps, 1);

  assert.equal(game.undo(), true);
  assert.equal(game.replayActions.length, 0);
});

test('snapshot store keeps only the newest ten valid games', () => {
  const { appendSnapshot, normalizeSnapshots } = require('../utils/snapshotStore');
  let snapshots = [];
  for (let index = 0; index < 12; index++) {
    snapshots = appendSnapshot(snapshots, {
      version: 1,
      completedAt: index,
      initialBoard: {},
      actions: []
    });
  }

  assert.equal(snapshots.length, 10);
  assert.equal(snapshots[0].completedAt, 11);
  assert.equal(snapshots[9].completedAt, 2);
  assert.deepEqual(normalizeSnapshots([null, { version: 0 }, ...snapshots]), snapshots);
});
