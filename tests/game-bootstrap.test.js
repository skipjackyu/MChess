const test = require('node:test');
const assert = require('node:assert/strict');

function createContext() {
  const gradient = { addColorStop() {} };
  return {
    arc() {},
    arcTo() {},
    beginPath() {},
    clearRect() {},
    closePath() {},
    createLinearGradient() { return gradient; },
    fill() {},
    fillRect() {},
    fillText() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    scale() {},
    setLineDash() {},
    stroke() {},
    strokeRect() {},
    translate() {}
  };
}

test('game.js boots as a Mini Game and responds to canvas touch input', () => {
  const context = createContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext() { return context; }
  };
  const handlers = {};
  const storage = {};

  global.wx = {
    createCanvas() { return canvas; },
    getWindowInfo() {
      return {
        windowWidth: 375,
        windowHeight: 667,
        pixelRatio: 2,
        safeArea: { top: 44, bottom: 633, left: 0, right: 375 }
      };
    },
    getMenuButtonBoundingClientRect() { return { bottom: 56 }; },
    getStorageSync(key) { return storage[key] || null; },
    setStorageSync(key, value) { storage[key] = value; },
    onTouchEnd(handler) { handlers.touchEnd = handler; },
    onHide(handler) { handlers.hide = handler; },
    onShow(handler) { handlers.show = handler; },
    onWindowResize(handler) { handlers.resize = handler; },
    showActionSheet() {},
    showModal() {},
    showToast() {}
  };

  let gameModule;
  assert.doesNotThrow(() => {
    gameModule = require('../game').__test;
  });
  assert.equal(canvas.width, 750);
  assert.equal(canvas.height, 1334);
  assert.equal(typeof handlers.touchEnd, 'function');

  const homeIds = gameModule.state.hitAreas.map((area) => area.id);
  assert.deepEqual(homeIds, ['start:pve', 'start:endgame', 'start:pvp', 'snapshots:open']);

  function tapArea(id) {
    const area = [...gameModule.state.hitAreas].reverse().find((candidate) => candidate.id === id);
    assert.ok(area, `missing hit area: ${id}`);
    handlers.touchEnd({
      changedTouches: [{
        clientX: area.rect.x + area.rect.width / 2,
        clientY: area.rect.y + area.rect.height / 2
      }]
    });
  }

  tapArea('snapshots:open');
  assert.equal(gameModule.state.overlay, 'snapshots');
  assert.equal(gameModule.state.snapshots.length, 0);
  tapArea('overlay:close');
  assert.equal(gameModule.state.overlay, null);

  tapArea('start:pve');
  assert.equal(gameModule.state.screen, 'game');
  assert.equal(gameModule.state.difficulty, 'easy');
  assert.ok(gameModule.state.boardRect.height > 500);
  assert.ok(gameModule.state.boardRect.y + gameModule.state.boardRect.height <= 633);
  assert.ok(gameModule.state.boardRect.y + gameModule.state.boardRect.height >= 620);
  assert.deepEqual(gameModule.state.hitAreas, []);

  const firstPosition = Object.keys(gameModule.state.gameManager.boardState)[0]
    .split(',')
    .map(Number);
  gameModule.state.gameManager.handleTap(firstPosition[0], firstPosition[1]);
  assert.ok(gameModule.state.gameManager.ai);

  function tapBoardButton(name) {
    const area = gameModule.state.renderer[`${name}BtnArea`];
    assert.ok(area, `missing board button: ${name}`);
    handlers.touchEnd({
      changedTouches: [{
        clientX: gameModule.state.boardRect.x + area.x + area.w / 2,
        clientY: gameModule.state.boardRect.y + area.y + area.h / 2
      }]
    });
  }

  tapBoardButton('menu');
  assert.equal(gameModule.state.overlay, 'menu');
  assert.ok(gameModule.state.hitAreas.some((area) => area.id === 'menu:home'));
  assert.equal(gameModule.state.hitAreas.some((area) => area.id === 'menu:undo'), false);
  assert.equal(gameModule.state.hitAreas.some((area) => area.id === 'menu:difficulty'), false);

  tapArea('menu:settings');
  assert.equal(gameModule.state.overlay, 'settings');
  assert.ok(gameModule.state.hitAreas.some((area) => area.id === 'settings:difficulty'));
  tapArea('settings:difficulty');
  tapArea('settings:difficulty');
  tapArea('settings:confirm');
  assert.equal(gameModule.state.overlay, null);
  assert.equal(gameModule.state.difficulty, 'hard');
  assert.equal(gameModule.state.gameManager.difficulty, 'hard');
  assert.equal(gameModule.state.gameManager.ai.difficulty, 'hard');
  assert.equal(storage['mchess.difficulty'], 'hard');

  gameModule.state.gameManager.gameResult = 'draw';
  gameModule.recordGameResult();
  assert.equal(gameModule.state.snapshots.length, 1);
  assert.equal(storage['mchess.snapshots'].length, 1);
  assert.equal(storage['mchess.snapshots'][0].actions.length, 1);

  tapBoardButton('menu');
  assert.equal(gameModule.state.overlay, 'menu');
  tapArea('menu:home');
  assert.equal(gameModule.state.screen, 'home');

  tapArea('start:endgame');
  assert.equal(gameModule.state.screen, 'game');
  assert.equal(gameModule.state.mode, 'endgame');
  assert.equal(gameModule.state.gameManager.sidesAssigned, true);
  assert.equal(gameModule.state.gameManager.playerSide, gameModule.state.gameManager.currentSide);
  assert.ok(gameModule.state.gameManager.ai);
  assert.ok(Object.keys(gameModule.state.gameManager.boardState).length < 50);
  const endgameBoard = JSON.stringify(gameModule.state.gameManager.boardState);
  tapBoardButton('menu');
  tapArea('menu:restart');
  assert.equal(JSON.stringify(gameModule.state.gameManager.boardState), endgameBoard);

  delete global.wx;
});
