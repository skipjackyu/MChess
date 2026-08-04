const test = require('node:test');
const assert = require('node:assert/strict');

const { Board, NodeType, boardInstance } = require('../utils/board');
const { GameManager, GameMode } = require('../utils/gameManager');
const { Renderer } = require('../utils/renderer');
const { AI, Difficulty } = require('../utils/ai');
const { generateEndgame } = require('../utils/endgameGenerator');
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
  normalizeSettings,
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

test('upper board node types and roads mirror the lower board', () => {
  for (const { col, row } of boardInstance.getAllPositions()) {
    const mirrorRow = 11 - row;
    assert.equal(
      boardInstance.getNodeType(col, row),
      boardInstance.getNodeType(col, mirrorRow),
      `node type is not mirrored at ${col},${row}`
    );

    const mirroredLinks = boardInstance.getAdjacentPositions(col, row)
      .map(link => {
        const target = Board.parseKey(link.pos);
        return `${target.col},${11 - target.row}:${link.type}`;
      })
      .sort();
    const oppositeLinks = boardInstance.getAdjacentPositions(col, mirrorRow)
      .map(link => `${link.pos}:${link.type}`)
      .sort();
    assert.deepEqual(mirroredLinks, oppositeLinks, `roads are not mirrored at ${col},${row}`);
  }
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

test('computer can take the opening flip and receives the revealed side', () => {
  const game = new GameManager();
  game.reset(GameMode.PVE, Difficulty.EASY, Object.assign({}, DefaultSettings, { firstMover: 'ai' }));

  assert.equal(game.isAiOpeningTurn(), true);
  const result = game.aiMove();

  assert.equal(result.type, 'flip');
  assert.equal(game.sidesAssigned, true);
  assert.equal(game.aiSide, result.piece.side);
  assert.equal(game.playerSide, result.piece.side === Side.RED ? Side.BLUE : Side.RED);
  assert.equal(game.currentSide, game.playerSide);
  assert.equal(game.totalSteps, 1);
});

test('computer-first setting can take effect before the first flip', () => {
  const game = new GameManager();
  game.reset(GameMode.PVE, Difficulty.EASY, DefaultSettings);
  game.settings.firstMover = 'ai';

  assert.equal(game.ai, null);
  assert.ok(game.aiMove());
  assert.ok(game.ai);
  assert.equal(game.sidesAssigned, true);
});

test('AI prioritizes hidden pieces beside camps during flip-only openings', () => {
  const game = new GameManager();
  game.reset(GameMode.PVE, Difficulty.EASY, DefaultSettings);
  const ai = new AI(Side.RED, Difficulty.EASY);
  const move = ai.getMove(game.boardState, DefaultSettings);
  const besideCamp = boardInstance.getAdjacentPositions(move.to.col, move.to.row).some(link => {
    const position = Board.parseKey(link.pos);
    return boardInstance.isCamp(position.col, position.row);
  });

  assert.equal(move.type, 'flip');
  assert.equal(besideCamp, true);
});

test('hard AI flips beside its occupied camp before an empty camp', () => {
  const boardState = {
    [Board.posKey(1, 2)]: Object.assign(createPiece(PieceType.MINE, Side.RED, 1), { revealed: true }),
    [Board.posKey(0, 1)]: createPiece(PieceType.FLAG, Side.RED, 2),
    [Board.posKey(4, 4)]: createPiece(PieceType.FLAG, Side.BLUE, 3)
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const move = ai.getMove(boardState, DefaultSettings);

  assert.equal(move.type, 'flip');
  assert.deepEqual(move.to, { col: 0, row: 1 });
});

test('hard AI avoids revealing an enemy route into another empty camp', () => {
  const boardState = {
    [Board.posKey(1, 2)]: Object.assign(createPiece(PieceType.MINE, Side.RED, 1), { revealed: true }),
    [Board.posKey(0, 1)]: createPiece(PieceType.FLAG, Side.RED, 2),
    [Board.posKey(2, 2)]: createPiece(PieceType.FLAG, Side.BLUE, 3)
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const safeFlip = { type: 'flip', from: { col: 0, row: 1 }, to: { col: 0, row: 1 } };
  const exposedFlip = { type: 'flip', from: { col: 2, row: 2 }, to: { col: 2, row: 2 } };

  assert.deepEqual(ai._campAdjacency(0, 1, boardState, Side.RED), {
    own: 1,
    empty: 0,
    opponent: 0
  });
  assert.deepEqual(ai._campAdjacency(2, 2, boardState, Side.RED), {
    own: 1,
    empty: 2,
    opponent: 0
  });
  assert.ok(
    ai._moveOrderScore(safeFlip, boardState, DefaultSettings, Side.RED) >
      ai._moveOrderScore(exposedFlip, boardState, DefaultSettings, Side.RED)
  );
  assert.deepEqual(ai.getMove(boardState, DefaultSettings).to, { col: 0, row: 1 });
});

test('hard AI falls back to normal flip scoring when no safe occupied-camp flip exists', () => {
  const occupiedCampState = {
    [Board.posKey(1, 2)]: Object.assign(createPiece(PieceType.MINE, Side.RED, 1), { revealed: true }),
    [Board.posKey(2, 2)]: createPiece(PieceType.FLAG, Side.BLUE, 2)
  };
  const emptyCampState = {
    [Board.posKey(2, 2)]: createPiece(PieceType.FLAG, Side.BLUE, 2)
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const exposedFlip = { type: 'flip', from: { col: 2, row: 2 }, to: { col: 2, row: 2 } };

  assert.deepEqual(ai._campAdjacency(2, 2, occupiedCampState, Side.RED), {
    own: 1,
    empty: 2,
    opponent: 0
  });
  assert.equal(ai._hardStrategyBonus(exposedFlip, occupiedCampState, Side.RED), 0);
  assert.equal(
    ai._moveOrderScore(exposedFlip, occupiedCampState, DefaultSettings, Side.RED),
    ai._moveOrderScore(exposedFlip, emptyCampState, DefaultSettings, Side.RED)
  );
});

test('hard AI gives entering an empty camp a strong safety bonus', () => {
  const boardState = {
    [Board.posKey(1, 1)]: Object.assign(createPiece(PieceType.PLATOON, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 2), { revealed: true }),
    [Board.posKey(0, 1)]: Object.assign(createPiece(PieceType.MINE, Side.RED, 3), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 4), { revealed: true })
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const moves = ai._getAllMoves(boardState, DefaultSettings);
  const campMove = moves.find(move => move.type === 'move' && move.to.col === 1 && move.to.row === 2);
  const normalMove = moves.find(move => move.type === 'move' && move.to.col === 2 && move.to.row === 1);

  assert.ok(campMove);
  assert.ok(normalMove);
  assert.ok(
    ai._moveOrderScore(campMove, boardState, DefaultSettings, Side.RED) >=
      ai._moveOrderScore(normalMove, boardState, DefaultSettings, Side.RED) + 15
  );
  assert.deepEqual(ai.getMove(boardState, DefaultSettings).to, { col: 1, row: 2 });
});

test('medium AI occupies a camp before flipping another hidden piece', () => {
  const boardState = {
    [Board.posKey(1, 1)]: Object.assign(createPiece(PieceType.PLATOON, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 2), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 3), { revealed: true }),
    [Board.posKey(4, 4)]: createPiece(PieceType.GENERAL, Side.BLUE, 4)
  };
  const ai = new AI(Side.RED, Difficulty.MEDIUM);
  const originalRandom = Math.random;
  Math.random = () => 0.99;

  try {
    const move = ai.getMove(boardState, DefaultSettings);
    assert.equal(move.type, 'move');
    assert.deepEqual(move.to, { col: 1, row: 2 });
  } finally {
    Math.random = originalRandom;
  }
});

test('easy AI also occupies a camp before flipping another hidden piece', () => {
  const boardState = {
    [Board.posKey(1, 1)]: Object.assign(createPiece(PieceType.PLATOON, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 2), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 3), { revealed: true }),
    [Board.posKey(4, 4)]: createPiece(PieceType.GENERAL, Side.BLUE, 4)
  };
  const ai = new AI(Side.RED, Difficulty.EASY);
  const originalRandom = Math.random;
  Math.random = () => 0.99;

  try {
    const move = ai.getMove(boardState, DefaultSettings);
    assert.equal(move.type, 'move');
    assert.equal(boardInstance.isCamp(move.to.col, move.to.row), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('AI vacates a camp into the middle camp so an adjacent company can expand camp control', () => {
  const boardState = {
    [Board.posKey(3, 4)]: Object.assign(createPiece(PieceType.COMMANDER, Side.RED, 1), { revealed: true }),
    [Board.posKey(3, 5)]: Object.assign(createPiece(PieceType.COMPANY, Side.RED, 2), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 3), { revealed: true }),
    [Board.posKey(1, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 4), { revealed: true }),
    [Board.posKey(4, 0)]: createPiece(PieceType.PLATOON, Side.BLUE, 5)
  };

  for (const difficulty of [Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD]) {
    const ai = new AI(Side.RED, difficulty);
    const move = ai.getMove(boardState, DefaultSettings, { totalSteps: 23, noCapSteps: 1 });

    assert.equal(move.type, 'move');
    assert.deepEqual(move.from, { col: 3, row: 4 });
    assert.deepEqual(move.to, { col: 2, row: 3 });
    assert.equal(ai._campExpansionPotential(move, boardState, DefaultSettings, Side.RED), 1);
  }
});

test('AI fills the vacated camp with the waiting company before flipping', () => {
  const boardState = {
    [Board.posKey(2, 3)]: Object.assign(createPiece(PieceType.COMMANDER, Side.RED, 1), { revealed: true }),
    [Board.posKey(3, 5)]: Object.assign(createPiece(PieceType.COMPANY, Side.RED, 2), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 3), { revealed: true }),
    [Board.posKey(1, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 4), { revealed: true }),
    [Board.posKey(4, 0)]: createPiece(PieceType.PLATOON, Side.BLUE, 5)
  };

  for (const difficulty of [Difficulty.EASY, Difficulty.MEDIUM, Difficulty.HARD]) {
    const ai = new AI(Side.RED, difficulty);
    const move = ai.getMove(boardState, DefaultSettings, { totalSteps: 25, noCapSteps: 3 });

    assert.equal(move.type, 'move');
    assert.deepEqual(move.from, { col: 3, row: 5 });
    assert.deepEqual(move.to, { col: 3, row: 4 });
  }
});

test('hard AI occupies a camp that creates a safe adjacent flip', () => {
  const boardState = {
    [Board.posKey(1, 1)]: Object.assign(createPiece(PieceType.PLATOON, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 2), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 3), { revealed: true }),
    [Board.posKey(0, 1)]: createPiece(PieceType.GENERAL, Side.BLUE, 4)
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const move = ai.getMove(boardState, DefaultSettings);

  assert.equal(move.type, 'move');
  assert.deepEqual(move.to, { col: 1, row: 2 });
  assert.equal(ai._campSetupPotential(move, boardState, Side.RED), 1);
});

test('medium AI protects a threatened piece before occupying a camp with another piece', () => {
  const boardState = {
    [Board.posKey(2, 2)]: Object.assign(createPiece(PieceType.PLATOON, Side.RED, 1), { revealed: true }),
    [Board.posKey(4, 4)]: Object.assign(createPiece(PieceType.COMPANY, Side.RED, 2), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 3), { revealed: true }),
    [Board.posKey(2, 1)]: Object.assign(createPiece(PieceType.GENERAL, Side.BLUE, 4), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 5), { revealed: true })
  };
  const ai = new AI(Side.RED, Difficulty.MEDIUM);
  const move = ai.getMove(boardState, DefaultSettings);

  assert.equal(move.type, 'move');
  assert.deepEqual(move.from, { col: 2, row: 2 });
  assert.equal(boardInstance.isCamp(move.to.col, move.to.row), true);
  assert.equal(ai._threatenedPieceScore(boardState, DefaultSettings, Side.RED), 15);
  assert.equal(
    ai._threatenedPieceScore(ai._simulateMove(boardState, move), DefaultSettings, Side.RED),
    0
  );
});

test('AI excludes losing engineer captures from legal moves', () => {
  const boardState = {
    [Board.posKey(4, 9)]: Object.assign(createPiece(PieceType.ENGINEER, Side.BLUE, 1), { revealed: true }),
    [Board.posKey(4, 10)]: Object.assign(createPiece(PieceType.REGIMENT, Side.RED, 2), { revealed: true }),
    [Board.posKey(3, 9)]: Object.assign(createPiece(PieceType.PLATOON, Side.BLUE, 3), { revealed: true }),
    [Board.posKey(4, 8)]: createPiece(PieceType.GENERAL, Side.RED, 4),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 5), { revealed: true }),
    [Board.posKey(1, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 6), { revealed: true }),
    [Board.posKey(0, 0)]: createPiece(PieceType.DIVISION, Side.BLUE, 7)
  };

  for (const difficulty of [Difficulty.MEDIUM, Difficulty.HARD]) {
    const ai = new AI(Side.BLUE, difficulty);
    const losingCapture = ai._getAllMoves(boardState, DefaultSettings).find(move =>
      move.type === 'capture' &&
      move.piece.type === PieceType.ENGINEER &&
      move.to.col === 4 &&
      move.to.row === 10
    );

    assert.equal(losingCapture, undefined);
    const move = ai.getMove(boardState, DefaultSettings, { totalSteps: 18, noCapSteps: 5 });
    assert.ok(move);
    assert.notDeepEqual(
      { from: move.from, to: move.to },
      { from: { col: 4, row: 9 }, to: { col: 4, row: 10 } }
    );
  }
});

test('mine and flag rules support engineer-only and current-smallest pieces independently', () => {
  const engineer = createPiece(PieceType.ENGINEER, Side.RED, 1);
  const platoon = createPiece(PieceType.PLATOON, Side.RED, 2);
  const general = createPiece(PieceType.GENERAL, Side.RED, 3);
  const bomb = createPiece(PieceType.BOMB, Side.RED, 4);
  const mine = createPiece(PieceType.MINE, Side.BLUE, 5);
  const enemyBomb = createPiece(PieceType.BOMB, Side.BLUE, 6);
  const flag = createPiece(PieceType.FLAG, Side.BLUE, 7);
  const enemyGeneral = createPiece(PieceType.GENERAL, Side.BLUE, 8);
  const withEngineer = { engineer, platoon, general };
  const withoutEngineer = { platoon, general };
  const smallestRules = Object.assign({}, DefaultSettings, { mineRule: 'smallest', flagRule: 'smallest' });
  const engineerRules = Object.assign({}, DefaultSettings, { mineRule: 'engineer', flagRule: 'engineer' });

  assert.equal(judgeCapture(engineer, mine, engineerRules, withEngineer), CaptureResult.WIN);
  assert.equal(judgeCapture(platoon, mine, engineerRules, withoutEngineer), CaptureResult.INVALID);
  assert.equal(judgeCapture(engineer, flag, engineerRules, withEngineer), CaptureResult.WIN);
  assert.equal(judgeCapture(platoon, flag, engineerRules, withoutEngineer), CaptureResult.INVALID);

  assert.equal(judgeCapture(engineer, mine, smallestRules, withEngineer), CaptureResult.WIN);
  assert.equal(judgeCapture(platoon, mine, smallestRules, withEngineer), CaptureResult.INVALID);
  assert.equal(judgeCapture(platoon, mine, smallestRules, withoutEngineer), CaptureResult.WIN);
  assert.equal(judgeCapture(general, mine, smallestRules, withoutEngineer), CaptureResult.INVALID);
  assert.equal(judgeCapture(platoon, flag, smallestRules, withoutEngineer), CaptureResult.WIN);
  assert.equal(judgeCapture(general, flag, smallestRules, withoutEngineer), CaptureResult.INVALID);
  assert.equal(judgeCapture(bomb, mine, smallestRules, { bomb }), CaptureResult.DRAW);
  assert.equal(judgeCapture(bomb, mine, engineerRules, { bomb }), CaptureResult.DRAW);
  assert.equal(judgeCapture(bomb, enemyGeneral, DefaultSettings, { bomb, enemyGeneral }), CaptureResult.DRAW);
  assert.equal(judgeCapture(bomb, flag, DefaultSettings, { bomb, flag }), CaptureResult.INVALID);
  assert.equal(judgeCapture(general, enemyBomb, DefaultSettings, {}), CaptureResult.DRAW);
});

test('smaller pieces cannot select or execute a losing capture', () => {
  const game = new GameManager();
  game.reset(GameMode.PVP, Difficulty.EASY, DefaultSettings);
  const engineerKey = Board.posKey(4, 9);
  const regimentKey = Board.posKey(4, 10);
  game.boardState = {
    [engineerKey]: Object.assign(createPiece(PieceType.ENGINEER, Side.BLUE, 1), { revealed: true }),
    [regimentKey]: Object.assign(createPiece(PieceType.REGIMENT, Side.RED, 2), { revealed: true })
  };
  game.currentSide = Side.BLUE;
  game.sidesAssigned = true;

  assert.equal(game.selectPiece(4, 9), true);
  assert.equal(
    game.reachablePositions.some(position => position.col === 4 && position.row === 10),
    false
  );

  game.reachablePositions = [{ col: 4, row: 10 }];
  assert.equal(game.movePiece(4, 9, 4, 10), null);
  assert.equal(game.boardState[engineerKey].type, PieceType.ENGINEER);
  assert.equal(game.boardState[regimentKey].type, PieceType.REGIMENT);
  assert.equal(game.totalSteps, 0);
  assert.equal(game.currentSide, Side.BLUE);
});

test('legacy unrestricted settings migrate to the replacement rule choices', () => {
  const settings = normalizeSettings({ mineRule: 'any', flagRule: 'any' });

  assert.equal(settings.mineRule, 'smallest');
  assert.equal(settings.flagRule, 'engineer');
});

test('stored settings normalize every configurable value', () => {
  assert.deepEqual(normalizeSettings({
    drawSteps: 70,
    hqCapture: false,
    mineRule: 'smallest',
    flagRule: 'engineer',
    firstMover: 'ai'
  }), {
    drawSteps: 70,
    hqCapture: false,
    mineRule: 'smallest',
    flagRule: 'engineer',
    firstMover: 'ai'
  });

  assert.deepEqual(normalizeSettings({
    drawSteps: 12,
    hqCapture: 'false',
    mineRule: 'invalid',
    flagRule: 'invalid',
    firstMover: 'invalid'
  }), DefaultSettings);
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

test('renderer uses piece shadows without top highlight bars', () => {
  const fillSnapshots = [];
  const fillRects = [];
  const context = {
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    closePath() {},
    stroke() {},
    fillText() {},
    fill() {
      fillSnapshots.push({
        shadowBlur: context.shadowBlur,
        shadowOffsetX: context.shadowOffsetX,
        shadowOffsetY: context.shadowOffsetY
      });
    },
    fillRect(...args) { fillRects.push(args); }
  };
  const renderer = new Renderer(context, 360, 493, 2);
  const revealed = createPiece(PieceType.GENERAL, Side.RED, 100);
  revealed.revealed = true;

  renderer._drawSinglePiece(100, 100, revealed, false);
  assert.equal(fillSnapshots.length, 1);
  assert.deepEqual(fillSnapshots[0], { shadowBlur: 7, shadowOffsetX: 0, shadowOffsetY: 3 });
  assert.equal(fillRects.length, 0);
  assert.equal(context.shadowBlur, 0);

  fillSnapshots.length = 0;
  renderer._drawSinglePiece(100, 100, createPiece(PieceType.GENERAL, Side.RED, 101), false);
  assert.equal(fillSnapshots.length, 1);
  assert.equal(fillRects.length, 0);
});

test('hard AI takes an immediately available flag', () => {
  const boardState = {
    [Board.posKey(0, 0)]: Object.assign(createPiece(PieceType.ENGINEER, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 2), { revealed: true }),
    [Board.posKey(4, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 3), { revealed: true }),
    [Board.posKey(4, 10)]: Object.assign(createPiece(PieceType.ENGINEER, Side.BLUE, 4), { revealed: true })
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const move = ai.getMove(boardState, Object.assign({}, DefaultSettings, { flagRule: 'smallest' }));

  assert.equal(move.type, 'capture');
  assert.deepEqual(move.from, { col: 0, row: 0 });
  assert.deepEqual(move.to, { col: 1, row: 0 });
  assert.ok(ai.lastSearchStats.completedDepth >= 1);
});

test('hard AI search excludes losing captures', () => {
  const boardState = {
    [Board.posKey(0, 0)]: Object.assign(createPiece(PieceType.PLATOON, Side.RED, 1), { revealed: true }),
    [Board.posKey(1, 0)]: Object.assign(createPiece(PieceType.COMMANDER, Side.BLUE, 2), { revealed: true }),
    [Board.posKey(4, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.RED, 3), { revealed: true }),
    [Board.posKey(3, 11)]: Object.assign(createPiece(PieceType.FLAG, Side.BLUE, 4), { revealed: true })
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const moves = ai._getAllMoves(boardState, DefaultSettings);
  const sacrifice = moves.find(move => move.type === 'capture' && move.to.col === 1 && move.to.row === 0);

  assert.equal(sacrifice, undefined);
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

test('hard AI chance nodes use exact remaining-piece probabilities', () => {
  const boardState = {
    [Board.posKey(0, 0)]: createPiece(PieceType.ENGINEER, Side.RED, 1),
    [Board.posKey(1, 0)]: createPiece(PieceType.ENGINEER, Side.RED, 2),
    [Board.posKey(2, 0)]: createPiece(PieceType.BOMB, Side.BLUE, 3)
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const flipMove = { type: 'flip', from: { col: 0, row: 0 }, to: { col: 0, row: 0 } };
  const outcomes = ai._getFlipOutcomes(boardState, flipMove);

  assert.deepEqual(
    outcomes.map(outcome => ({
      piece: `${outcome.side}:${outcome.type}`,
      count: outcome.count,
      probability: outcome.probability
    })),
    [
      { piece: `${Side.BLUE}:${PieceType.BOMB}`, count: 1, probability: 1 / 3 },
      { piece: `${Side.RED}:${PieceType.ENGINEER}`, count: 2, probability: 2 / 3 }
    ]
  );
  assert.equal(
    outcomes.reduce((total, outcome) => total + outcome.probability, 0),
    1
  );
});

test('hard AI flip search computes a probability-weighted expectation', () => {
  const boardState = {
    [Board.posKey(0, 0)]: createPiece(PieceType.ENGINEER, Side.RED, 1),
    [Board.posKey(1, 0)]: createPiece(PieceType.ENGINEER, Side.RED, 2),
    [Board.posKey(2, 0)]: createPiece(PieceType.BOMB, Side.BLUE, 3)
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const flipMove = { type: 'flip', from: { col: 0, row: 0 }, to: { col: 0, row: 0 } };
  ai._alphaBeta = (state) => {
    const revealed = state[Board.posKey(0, 0)];
    return revealed.type === PieceType.ENGINEER ? 30 : -60;
  };

  const score = ai._searchMove(
    boardState,
    flipMove,
    0,
    -Infinity,
    Infinity,
    Side.BLUE,
    DefaultSettings,
    {},
    new Map(),
    { totalSteps: 1, noCapSteps: 1 }
  );

  assert.equal(score, 0);
});

test('hard AI caches exact chance-node expectations', () => {
  const boardState = {
    [Board.posKey(0, 0)]: createPiece(PieceType.ENGINEER, Side.RED, 1),
    [Board.posKey(1, 0)]: createPiece(PieceType.ENGINEER, Side.RED, 2),
    [Board.posKey(2, 0)]: createPiece(PieceType.BOMB, Side.BLUE, 3)
  };
  const ai = new AI(Side.RED, Difficulty.HARD);
  const flipMove = { type: 'flip', from: { col: 0, row: 0 }, to: { col: 0, row: 0 } };
  const context = {};
  const table = new Map();
  let evaluations = 0;
  ai._alphaBeta = (state) => {
    evaluations++;
    const revealed = state[Board.posKey(0, 0)];
    return revealed.type === PieceType.ENGINEER ? 30 : -60;
  };

  const args = [
    boardState,
    flipMove,
    1,
    Side.BLUE,
    DefaultSettings,
    context,
    table,
    { totalSteps: 1, noCapSteps: 1 }
  ];
  assert.equal(ai._chanceNode(...args), 0);
  assert.equal(ai._chanceNode(...args), 0);
  assert.equal(evaluations, 2);
  assert.equal(context.chanceNodes, 2);
  assert.equal(context.chanceTableHits, 1);
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
  game.reset(GameMode.PVP, Difficulty.EASY, Object.assign({}, DefaultSettings, { flagRule: 'smallest' }));
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

test('random endgames are deterministic, legal, and playable', () => {
  const first = generateEndgame({ seed: 'ENDGAME-TEST', difficulty: Difficulty.MEDIUM });
  const second = generateEndgame({ seed: 'ENDGAME-TEST', difficulty: Difficulty.MEDIUM });

  assert.deepEqual(first.boardState, second.boardState);
  assert.equal(first.currentSide, second.currentSide);
  assert.equal(first.playerSide, first.currentSide);
  assert.notEqual(first.playerSide, first.aiSide);
  assert.ok(first.sourceSteps >= 45);

  const pieces = Object.values(first.boardState);
  assert.ok(pieces.length < 50);
  assert.ok(pieces.length >= 10);
  assert.equal(pieces.some((piece) => piece.side === Side.RED && piece.type === PieceType.FLAG), true);
  assert.equal(pieces.some((piece) => piece.side === Side.BLUE && piece.type === PieceType.FLAG), true);
  assert.equal(checkGameResult(first.boardState, first.currentSide, 0, 0, first.settings), GameResult.PLAYING);

  const game = new GameManager();
  assert.equal(game.loadScenario(first), true);
  assert.equal(game.mode, GameMode.ENDGAME);
  assert.equal(game.sidesAssigned, true);
  assert.equal(game.currentSide, game.playerSide);
  assert.ok(game.ai);

  const snapshot = game.exportSnapshot();
  const replay = new GameManager();
  assert.equal(replay.loadReplaySnapshot(snapshot, 0), true);
  assert.equal(replay.sidesAssigned, true);
  assert.equal(replay.currentSide, first.currentSide);
  assert.deepEqual(replay.boardState, first.boardState);
});

test('random endgame samples avoid terminal or full-board starts', () => {
  for (let index = 0; index < 12; index++) {
    const scenario = generateEndgame({
      seed: `ENDGAME-SAMPLE-${index}`,
      difficulty: index % 3 === 0
        ? Difficulty.EASY
        : index % 3 === 1 ? Difficulty.MEDIUM : Difficulty.HARD
    });
    const pieceCount = Object.keys(scenario.boardState).length;
    assert.ok(pieceCount >= 10 && pieceCount <= 30, `unexpected piece count: ${pieceCount}`);
    assert.equal(checkGameResult(
      scenario.boardState,
      scenario.currentSide,
      0,
      0,
      scenario.settings
    ), GameResult.PLAYING);
  }
});
