const { GameManager, GameMode } = require('./utils/gameManager');
const { Renderer } = require('./utils/renderer');
const { GameResult, DefaultSettings } = require('./utils/rules');
const { Side, SideColor } = require('./utils/pieces');
const { AI, Difficulty } = require('./utils/ai');
const { normalizeSnapshots, appendSnapshot } = require('./utils/snapshotStore');

const SETTINGS_STORAGE_KEY = 'mchess.settings';
const STATS_STORAGE_KEY = 'mchess.stats';
const DIFFICULTY_STORAGE_KEY = 'mchess.difficulty';
const SNAPSHOTS_STORAGE_KEY = 'mchess.snapshots';
const VERSION = '1.1.0';

const COLORS = {
  skyTop: '#9BE0F5',
  skyBottom: '#43B9E8',
  skyGlow: 'rgba(255,255,255,0.34)',
  wood: '#D7B879',
  woodDark: '#5B4933',
  woodMid: '#9D7B4A',
  panel: 'rgba(14, 23, 18, 0.9)',
  panelBorder: 'rgba(226, 239, 231, 0.72)',
  blueTop: '#55B9F1',
  blueBottom: '#0878C4',
  blueBorder: '#8ED5FF',
  text: '#FFFFFF',
  mutedText: 'rgba(255,255,255,0.72)'
};

const DIFFICULTY_OPTIONS = [
  { value: Difficulty.EASY, label: '简单', detail: '随机策略，适合熟悉规则' },
  { value: Difficulty.MEDIUM, label: '中等', detail: '优先吃子，攻守更积极' },
  { value: Difficulty.HARD, label: '困难', detail: '概率搜索，挑战更高' }
];

const RULE_PAGES = [
  {
    title: '棋盘',
    content: '细线是公路，棋子每次只能走一步；粗线是铁路。铁路无阻挡时，工兵可沿铁路转弯并连续行走，其他棋子只能沿直线行走。\n\n行营是安全位置，营内棋子不能被吃；大本营用于军旗和地雷相关规则。'
  },
  {
    title: '翻棋规则',
    content: '双方轮流翻棋。玩家翻出的第一枚棋子决定玩家阵营，另一阵营由对手或电脑控制。翻棋、走棋或吃子后切换回合。'
  },
  {
    title: '吃子规则',
    content: '司令 > 军长 > 师长 > 旅长 > 团长 > 营长 > 连长 > 排长 > 工兵。\n\n炸弹与任何棋子相遇时同归于尽。默认只有工兵可以挖地雷；军旗规则可在设置中调整。'
  },
  {
    title: '胜负判定',
    content: '军旗被扛、没有可移动棋子且没有未翻棋子时判负。连续无吃子步数达到设置值时判和；总步数达到 1000 步时判和。'
  }
];

const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

const state = {
  screen: 'home',
  mode: GameMode.PVE,
  difficulty: loadDifficulty(),
  settings: loadObject(SETTINGS_STORAGE_KEY, DefaultSettings),
  stats: loadObject(STATS_STORAGE_KEY, {
    totalGames: 0,
    wins: 0,
    losses: 0,
    draws: 0
  }),
  snapshots: loadSnapshots(),
  gameManager: null,
  renderer: null,
  boardRect: null,
  hitAreas: [],
  overlay: null,
  settingsDraft: null,
  aiTimer: null,
  resultModalOpen: false,
  resultRecorded: false,
  replay: null,
  snapshotPage: 0
};

let metrics = readWindowMetrics();

function readWindowMetrics() {
  const info = typeof wx.getWindowInfo === 'function'
    ? wx.getWindowInfo()
    : wx.getSystemInfoSync();
  const width = info.windowWidth || info.screenWidth;
  const height = info.windowHeight || info.screenHeight;
  const safeArea = info.safeArea || {
    top: 0,
    bottom: height,
    left: 0,
    right: width
  };

  let menuButton = null;
  try {
    menuButton = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuButton = null;
  }

  return {
    width,
    height,
    dpr: Math.min(info.pixelRatio || 1, 2),
    safeArea,
    menuButton
  };
}

function loadObject(key, defaults) {
  try {
    const value = wx.getStorageSync(key);
    if (value && typeof value === 'object') {
      return Object.assign({}, defaults, value);
    }
  } catch (error) {
    console.warn(`读取本地数据失败: ${key}`, error);
  }
  return Object.assign({}, defaults);
}

function loadDifficulty() {
  try {
    const value = wx.getStorageSync(DIFFICULTY_STORAGE_KEY);
    if (DIFFICULTY_OPTIONS.some((option) => option.value === value)) {
      return value;
    }
  } catch (error) {
    console.warn('读取难度设置失败', error);
  }
  return Difficulty.EASY;
}

function loadSnapshots() {
  try {
    return normalizeSnapshots(wx.getStorageSync(SNAPSHOTS_STORAGE_KEY));
  } catch (error) {
    console.warn('读取对局快照失败', error);
    return [];
  }
}

function saveObject(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    console.warn(`保存本地数据失败: ${key}`, error);
  }
}

function configureCanvas() {
  metrics = readWindowMetrics();
  canvas.width = metrics.width * metrics.dpr;
  canvas.height = metrics.height * metrics.dpr;
  ctx.scale(metrics.dpr, metrics.dpr);

  const safeTop = metrics.safeArea.top || 0;
  const menuBottom = metrics.menuButton ? metrics.menuButton.bottom : 0;
  const contentTop = Math.max(safeTop + 8, menuBottom + 8);
  const bottomInset = metrics.height - (metrics.safeArea.bottom || metrics.height);
  const statusHeight = 54;
  const boardTop = contentTop + statusHeight;
  const boardBottom = metrics.height - bottomInset - 4;

  state.boardRect = {
    x: 4,
    y: boardTop,
    width: metrics.width - 8,
    height: Math.max(300, boardBottom - boardTop)
  };
  state.renderer = new Renderer(
    ctx,
    state.boardRect.width,
    state.boardRect.height,
    metrics.dpr
  );
  render();
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.arcTo(x + width, y, x + width, y + r, r);
  context.lineTo(x + width, y + height - r);
  context.arcTo(x + width, y + height, x + width - r, y + height, r);
  context.lineTo(x + r, y + height);
  context.arcTo(x, y + height, x, y + height - r, r);
  context.lineTo(x, y + r);
  context.arcTo(x, y, x + r, y, r);
  context.closePath();
}

function drawText(text, x, y, size, color, align, weight, maxWidth) {
  ctx.fillStyle = color || '#FFFFFF';
  ctx.font = `${weight || 'normal'} ${size}px 'PingFang SC', 'Heiti SC', 'STHeiti', 'Arial Unicode MS', sans-serif`;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  if (maxWidth) {
    ctx.fillText(text, x, y, maxWidth);
  } else {
    ctx.fillText(text, x, y);
  }
}

function drawButton(rect, title, subtitle, colors) {
  const palette = colors || {
    top: COLORS.blueTop,
    bottom: COLORS.blueBottom,
    border: COLORS.blueBorder
  };
  const fill = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
  fill.addColorStop(0, palette.top || palette.fill || COLORS.blueTop);
  fill.addColorStop(1, palette.bottom || palette.fill || COLORS.blueBottom);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = fill;
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 14);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = palette.border || COLORS.blueBorder;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.x + 14, rect.y + 3);
  ctx.lineTo(rect.x + rect.width - 14, rect.y + 3);
  ctx.stroke();

  const titleY = subtitle ? rect.y + rect.height * 0.4 : rect.y + rect.height / 2;
  drawText(title, rect.x + rect.width / 2, titleY, 18, '#FFFFFF', 'center', 'bold');
  if (subtitle) {
    drawText(
      subtitle,
      rect.x + rect.width / 2,
      rect.y + rect.height * 0.72,
      12,
      'rgba(255,255,255,0.78)'
    );
  }
}

function drawWoodPanel(rect) {
  ctx.fillStyle = COLORS.wood;
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 8);
  ctx.fill();

  ctx.fillStyle = 'rgba(118, 76, 32, 0.07)';
  const stripeWidth = Math.max(18, rect.width / 12);
  for (let x = rect.x + 10; x < rect.x + rect.width - 10; x += stripeWidth * 2) {
    ctx.fillRect(x, rect.y + 8, stripeWidth, rect.height - 16);
  }

  ctx.strokeStyle = COLORS.woodDark;
  ctx.lineWidth = 6;
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 8);
  ctx.stroke();
  ctx.strokeStyle = '#B79761';
  ctx.lineWidth = 2;
  roundedRect(ctx, rect.x + 8, rect.y + 8, rect.width - 16, rect.height - 16, 4);
  ctx.stroke();
}

function drawPill(rect, label, active) {
  ctx.fillStyle = active ? 'rgba(12, 73, 104, 0.78)' : 'rgba(42, 56, 48, 0.55)';
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, rect.height / 2);
  ctx.fill();
  ctx.strokeStyle = active ? '#8FE4FF' : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = active ? 1.5 : 1;
  ctx.stroke();
  drawText(label, rect.x + rect.width / 2, rect.y + rect.height / 2, 12, COLORS.text, 'center', 'bold');
}

function difficultyLabel(value) {
  const option = DIFFICULTY_OPTIONS.find((item) => item.value === value);
  return option ? option.label : '简单';
}

function registerHitArea(id, rect) {
  state.hitAreas.push({ id, rect });
}

function findHitArea(point) {
  for (let index = state.hitAreas.length - 1; index >= 0; index--) {
    const area = state.hitAreas[index];
    const rect = area.rect;
    if (
      point.x >= rect.x && point.x <= rect.x + rect.width &&
      point.y >= rect.y && point.y <= rect.y + rect.height
    ) {
      return area.id;
    }
  }
  return null;
}

function render() {
  ctx.clearRect(0, 0, metrics.width, metrics.height);
  state.hitAreas = [];

  const background = ctx.createLinearGradient(0, 0, 0, metrics.height);
  background.addColorStop(0, COLORS.skyTop);
  background.addColorStop(1, COLORS.skyBottom);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, metrics.width, metrics.height);

  ctx.fillStyle = COLORS.skyGlow;
  ctx.beginPath();
  ctx.arc(metrics.width * 0.18, metrics.height * 0.12, metrics.width * 0.34, 0, Math.PI * 2);
  ctx.fill();

  if (state.screen === 'home') {
    renderHome();
    if (state.overlay) renderOverlay();
  } else {
    renderGame();
  }
}

function renderHome() {
  const safeTop = Math.max(
    metrics.safeArea.top || 0,
    metrics.menuButton ? metrics.menuButton.bottom : 0
  );
  drawText('军 棋', metrics.width / 2, safeTop + 36, 38, '#4A311B', 'center', 'bold');
  drawText('陆战棋 · 翻棋模式', metrics.width / 2, safeTop + 70, 15, '#315A6D', 'center', 'bold');

  const bottomInset = metrics.height - (metrics.safeArea.bottom || metrics.height);
  const panelTop = Math.max(safeTop + 94, metrics.height * 0.22);
  const panelHeight = Math.min(370, metrics.height - panelTop - bottomInset - 52);
  const panel = {
    x: 16,
    y: panelTop,
    width: metrics.width - 32,
    height: Math.max(300, panelHeight)
  };
  drawWoodPanel(panel);
  drawHomeBoardDecoration(panel);

  const buttonWidth = panel.width - 58;
  const buttonHeight = 64;
  const gap = 12;
  const startY = panel.y + (panel.height - buttonHeight * 3 - gap * 2) / 2;
  const x = panel.x + 29;
  const choices = [
    ['start:pve', '人机对战', `当前难度：${difficultyLabel(state.difficulty)} · 对局中可调整`, '#178AC8'],
    ['start:pvp', '双人同屏', '与好友轮流翻棋走棋', '#D46A13'],
    ['snapshots:open', '快照复盘', `回溯最近 ${state.snapshots.length} 局完整对局`, '#2B8F63']
  ];

  choices.forEach((choice, index) => {
    const rect = {
      x,
      y: startY + index * (buttonHeight + gap),
      width: buttonWidth,
      height: buttonHeight
    };
    drawButton(rect, choice[1], choice[2], {
      top: choice[3] === '#178AC8'
        ? '#57C3F3'
        : choice[3] === '#D46A13' ? '#F6A345' : '#58B987',
      bottom: choice[3],
      border: 'rgba(255,255,255,0.65)'
    });
    registerHitArea(choice[0], rect);
  });

  drawText(
    `v${VERSION} · 难度可在功能设置中调整`,
    metrics.width / 2,
    metrics.height - 24 - bottomInset,
    12,
    'rgba(42, 67, 77, 0.72)',
    'center',
    'bold'
  );
}

function drawHomeBoardDecoration(panel) {
  const topY = panel.y + 44;
  const bottomY = panel.y + panel.height - 44;
  const spacing = (panel.width - 58) / 4;
  ctx.strokeStyle = 'rgba(92, 57, 26, 0.46)';
  ctx.lineWidth = 1.5;

  for (let index = 0; index < 5; index++) {
    const x = panel.x + 29 + spacing * index;
    if (index < 4) {
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x + spacing, topY);
      ctx.moveTo(x, bottomY);
      ctx.lineTo(x + spacing, bottomY);
      ctx.stroke();
    }
    ctx.fillStyle = '#5C9900';
    roundedRect(ctx, x - 18, topY - 10, 36, 20, 3);
    ctx.fill();
    roundedRect(ctx, x - 18, bottomY - 10, 36, 20, 3);
    ctx.fill();
  }
}

function renderGame() {
  const game = state.gameManager;
  if (!game || !state.renderer) return;

  renderStatusBar(game);

  ctx.save();
  ctx.translate(state.boardRect.x, state.boardRect.y);
  state.renderer.render(
    game.boardState,
    game.selectedPos,
    game.reachablePositions,
    game.gameResult
  );
  ctx.restore();

  if (state.overlay) {
    renderOverlay();
  }
}

function renderStatusBar(game) {
  const y = state.boardRect.y - 50;
  const height = 42;
  const sideWidth = 70;
  const activeSide = game.sidesAssigned ? game.currentSide : null;

  const leftRect = { x: 6, y, width: sideWidth, height };
  const rightRect = { x: metrics.width - sideWidth - 6, y, width: sideWidth, height };
  drawSideStatus(leftRect, '蓝方', SideColor[Side.RED], activeSide === Side.RED);
  drawSideStatus(rightRect, '橙方', SideColor[Side.BLUE], activeSide === Side.BLUE);

  const statusText = state.replay
    ? `复盘第 ${state.replay.index}/${state.replay.record.actions.length} 手`
    : game.getStatusText();
  drawText(statusText, metrics.width / 2, y + 13, 13, '#294A58', 'center', 'bold', metrics.width - 160);
  const centerLabel = state.replay
    ? '点棋盘下一手 · 回退键上一手'
    : state.mode === GameMode.PVE
      ? `AI ${difficultyLabel(state.difficulty)} · ${game.totalSteps}步`
      : `双人对战 · 第 ${game.totalSteps} 步`;
  const pill = { x: metrics.width / 2 - 55, y: y + 23, width: 110, height: 22 };
  drawPill(pill, centerLabel, false);
}

function drawSideStatus(rect, label, colors, active) {
  ctx.fillStyle = active ? colors.bg : 'rgba(255,255,255,0.42)';
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 12);
  ctx.fill();
  ctx.strokeStyle = active ? '#FFF2A8' : colors.border;
  ctx.lineWidth = active ? 2.5 : 1;
  ctx.stroke();
  drawText(label, rect.x + rect.width / 2, rect.y + rect.height / 2, 14, '#FFFFFF', 'center', 'bold');
}

function renderOverlay() {
  const fullScreen = { x: 0, y: 0, width: metrics.width, height: metrics.height };
  ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
  ctx.fillRect(0, 0, metrics.width, metrics.height);
  registerHitArea('overlay:close', fullScreen);

  if (state.overlay === 'menu') renderMenuOverlay();
  if (state.overlay === 'settings') renderSettingsOverlay();
  if (state.overlay === 'snapshots') renderSnapshotsOverlay();
}

function drawOverlayPanel(rect, title, subtitle) {
  ctx.fillStyle = COLORS.panel;
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 8);
  ctx.fill();
  ctx.strokeStyle = COLORS.panelBorder;
  ctx.lineWidth = 2;
  ctx.stroke();
  registerHitArea('overlay:block', rect);

  const header = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + 54);
  header.addColorStop(0, 'rgba(255,255,255,0.96)');
  header.addColorStop(1, 'rgba(220,232,226,0.78)');
  ctx.fillStyle = header;
  ctx.fillRect(rect.x + 2, rect.y + 2, rect.width - 4, 52);
  drawText(title, rect.x + 22, rect.y + 28, 21, '#263B34', 'left', 'bold');
  if (subtitle) {
    drawText(subtitle, rect.x + rect.width - 38, rect.y + 29, 11, '#597169', 'right', 'bold');
  }

  const closeRect = { x: rect.x + rect.width - 42, y: rect.y + 10, width: 30, height: 30 };
  drawText('×', closeRect.x + 15, closeRect.y + 15, 24, '#455A54', 'center', 'bold');
  registerHitArea('overlay:close', closeRect);
}

function renderMenuOverlay() {
  const items = state.replay
    ? [
        ['menu:replay-prev', '退', '上一手'],
        ['menu:replay-next', '进', '下一手'],
        ['menu:snapshots', '照', '快照列表'],
        ['menu:home', '首', '返回首页'],
        ['menu:about', 'i', '软件信息']
      ]
    : state.mode === GameMode.PVE
      ? [
        ['menu:restart', '新', '重新开始'],
        ['menu:ai', '走', '电脑走'],
        ['menu:home', '首', '返回首页'],
        ['menu:rules', '规', '规则说明'],
        ['menu:settings', '设', '功能设置'],
        ['menu:stats', '统', '战况统计'],
        ['menu:about', 'i', '软件信息']
      ]
    : [
        ['menu:restart', '新', '重新开始'],
        ['menu:home', '首', '返回首页'],
        ['menu:rules', '规', '规则说明'],
        ['menu:settings', '设', '功能设置'],
        ['menu:stats', '统', '战况统计'],
        ['menu:about', 'i', '软件信息']
      ];
  const columns = 4;
  const panel = {
    x: 14,
    y: Math.max(state.boardRect.y + 54, (metrics.height - 246) / 2),
    width: metrics.width - 28,
    height: 246
  };
  const subtitle = state.replay
    ? '复盘模式'
    : state.mode === GameMode.PVE ? `AI ${difficultyLabel(state.difficulty)}` : '双人对战';
  drawOverlayPanel(panel, '对局菜单', subtitle);

  const contentTop = panel.y + 66;
  const cellWidth = (panel.width - 24) / columns;
  const cellHeight = 82;
  items.forEach((item, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const rect = {
      x: panel.x + 12 + col * cellWidth,
      y: contentTop + row * cellHeight,
      width: cellWidth,
      height: cellHeight
    };
    ctx.fillStyle = index % 2 === 0 ? '#249CDB' : '#4BB85B';
    ctx.beginPath();
    ctx.arc(rect.x + rect.width / 2, rect.y + 27, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.68)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawText(item[1], rect.x + rect.width / 2, rect.y + 27, 20, '#FFFFFF', 'center', 'bold');
    drawText(item[2], rect.x + rect.width / 2, rect.y + 62, 12, '#FFFFFF', 'center', 'bold');
    registerHitArea(item[0], rect);
  });
}

function renderSnapshotsOverlay() {
  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(state.snapshots.length / pageSize));
  state.snapshotPage = Math.min(state.snapshotPage, pageCount - 1);
  const panelHeight = Math.min(430, metrics.height - Math.max(metrics.safeArea.top || 0, 20) - 30);
  const panel = {
    x: 14,
    y: Math.max(metrics.safeArea.top || 12, (metrics.height - panelHeight) / 2),
    width: metrics.width - 28,
    height: panelHeight
  };
  drawOverlayPanel(panel, '快照复盘', `${state.snapshotPage + 1}/${pageCount}`);

  if (state.snapshots.length === 0) {
    drawText('暂无已完成对局', metrics.width / 2, panel.y + panel.height / 2 - 8, 18, COLORS.text, 'center', 'bold');
    drawText('完成一局后会自动保留快照', metrics.width / 2, panel.y + panel.height / 2 + 24, 13, COLORS.mutedText, 'center', 'bold');
    return;
  }

  const start = state.snapshotPage * pageSize;
  const visible = state.snapshots.slice(start, start + pageSize);
  const rowTop = panel.y + 66;
  const rowHeight = 54;
  visible.forEach((snapshot, offset) => {
    const index = start + offset;
    const rect = {
      x: panel.x + 14,
      y: rowTop + offset * 58,
      width: panel.width - 28,
      height: rowHeight
    };
    drawButton(rect, snapshotTitle(snapshot), snapshotSubtitle(snapshot), {
      top: offset % 2 === 0 ? '#42A8D8' : '#4EB16A',
      bottom: offset % 2 === 0 ? '#176E9B' : '#267943',
      border: 'rgba(255,255,255,0.62)'
    });
    registerHitArea(`snapshot:open:${index}`, rect);
  });

  const navY = panel.y + panel.height - 52;
  const previousRect = { x: panel.x + 14, y: navY, width: 92, height: 38 };
  const nextRect = { x: panel.x + panel.width - 106, y: navY, width: 92, height: 38 };
  drawButton(previousRect, '上一页', null, { top: '#778A84', bottom: '#465650', border: '#AFBDB8' });
  drawButton(nextRect, '下一页', null, { top: '#778A84', bottom: '#465650', border: '#AFBDB8' });
  registerHitArea('snapshot:prev', previousRect);
  registerHitArea('snapshot:next', nextRect);
}

function snapshotTitle(snapshot) {
  const date = new Date(snapshot.completedAt || snapshot.startedAt || Date.now());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const mode = snapshot.mode === GameMode.PVE ? `人机·${difficultyLabel(snapshot.difficulty)}` : '双人同屏';
  return `${month}-${day} ${hour}:${minute}  ${mode}`;
}

function snapshotSubtitle(snapshot) {
  const result = snapshot.result === GameResult.RED_WIN
    ? '蓝方胜'
    : snapshot.result === GameResult.BLUE_WIN
      ? '橙方胜'
      : '和棋';
  return `${result} · ${snapshot.totalSteps || snapshot.actions.length} 手`;
}

function renderSettingsOverlay() {
  const draft = state.settingsDraft || Object.assign({}, state.settings);
  const includeDifficulty = state.mode === GameMode.PVE;
  const panelHeight = includeDifficulty ? 492 : 430;
  const panel = {
    x: 16,
    y: Math.max(62, (metrics.height - panelHeight) / 2),
    width: metrics.width - 32,
    height: panelHeight
  };
  drawOverlayPanel(panel, '功能设置', '点击蓝色选项切换');

  const rows = [];
  if (includeDifficulty) {
    rows.push(['settings:difficulty', 'AI难度', difficultyLabel(draft.difficulty)]);
  }
  rows.push(
    ['settings:draw', '和棋', draft.drawSteps ? `${draft.drawSteps} 步` : '不限步数'],
    ['settings:hq', '大本营', draft.hqCapture ? '允许吃子' : '禁止吃子'],
    ['settings:mine', '吃地雷', draft.mineRule === 'engineer' ? '仅工兵' : '任意棋子'],
    ['settings:flag', '吃军旗', draft.flagRule === 'smallest' ? '清雷后可扛' : '任意棋子']
  );

  rows.forEach((row, index) => {
    const y = panel.y + 72 + index * 62;
    drawText(`${row[1]}：`, panel.x + 26, y + 24, 17, '#FFFFFF', 'left', 'bold');
    const valueRect = { x: panel.x + 130, y, width: panel.width - 154, height: 48 };
    drawButton(valueRect, row[2], null, {
      top: COLORS.blueTop,
      bottom: COLORS.blueBottom,
      border: COLORS.blueBorder
    });
    registerHitArea(row[0], valueRect);
  });

  const buttonY = panel.y + panel.height - 68;
  const confirmRect = { x: panel.x + 24, y: buttonY, width: (panel.width - 60) / 2, height: 48 };
  const cancelRect = { x: confirmRect.x + confirmRect.width + 12, y: buttonY, width: confirmRect.width, height: 48 };
  drawButton(confirmRect, '确定', null, { top: '#58C5F4', bottom: '#0878C4', border: '#BCEEFF' });
  drawButton(cancelRect, '取消', null, { top: '#7E8B86', bottom: '#46544F', border: '#A9B7B1' });
  registerHitArea('settings:confirm', confirmRect);
  registerHitArea('settings:cancel', cancelRect);
}

function startGame(mode, difficulty) {
  clearAiTimer();
  state.mode = mode;
  if (mode === GameMode.PVE && difficulty) {
    state.difficulty = difficulty;
  }
  state.gameManager = new GameManager();
  state.gameManager.reset(mode, state.difficulty, state.settings);
  state.screen = 'game';
  state.overlay = null;
  state.settingsDraft = null;
  state.resultModalOpen = false;
  state.resultRecorded = false;
  state.replay = null;
  render();
}

function restartGame() {
  startGame(state.mode, state.difficulty);
}

function returnHome() {
  clearAiTimer();
  state.screen = 'home';
  state.gameManager = null;
  state.overlay = null;
  state.settingsDraft = null;
  state.resultModalOpen = false;
  state.replay = null;
  render();
}

function handleTouch(point) {
  const hit = findHitArea(point);

  if (state.overlay) {
    handleOverlayHit(hit);
    return;
  }

  if (state.screen === 'home') {
    if (hit === 'start:pve') startGame(GameMode.PVE);
    if (hit === 'start:pvp') startGame(GameMode.PVP);
    if (hit === 'snapshots:open') openSnapshots();
    return;
  }

  const localPoint = {
    x: point.x - state.boardRect.x,
    y: point.y - state.boardRect.y
  };
  if (
    localPoint.x < 0 || localPoint.x > state.boardRect.width ||
    localPoint.y < 0 || localPoint.y > state.boardRect.height
  ) {
    return;
  }

  const boardButton = state.renderer.hitTestButton(localPoint.x, localPoint.y);
  if (boardButton === 'menu') {
    showGameMenu();
    return;
  }
  if (boardButton === 'undo') {
    if (state.replay) changeReplayStep(-1);
    else undoMove();
    return;
  }

  if (state.replay) {
    changeReplayStep(1);
    return;
  }

  const boardPosition = state.renderer.canvasToBoard(localPoint.x, localPoint.y);
  if (!boardPosition) return;

  const result = state.gameManager.handleTap(boardPosition.col, boardPosition.row);
  render();
  handleActionResult(result);
}

function handleOverlayHit(hit) {
  if (!hit || hit === 'overlay:block') return;
  if (hit === 'overlay:close' || hit === 'settings:cancel') {
    closeOverlay();
    return;
  }

  if (hit === 'settings:difficulty') {
    const index = DIFFICULTY_OPTIONS.findIndex((option) => option.value === state.settingsDraft.difficulty);
    state.settingsDraft.difficulty = DIFFICULTY_OPTIONS[(index + 1) % DIFFICULTY_OPTIONS.length].value;
    render();
    return;
  }
  if (hit === 'settings:draw') {
    const options = [0, 70, 100];
    const index = options.indexOf(state.settingsDraft.drawSteps);
    state.settingsDraft.drawSteps = options[(index + 1) % options.length];
    render();
    return;
  }
  if (hit === 'settings:hq') {
    state.settingsDraft.hqCapture = !state.settingsDraft.hqCapture;
    render();
    return;
  }
  if (hit === 'settings:mine') {
    state.settingsDraft.mineRule = state.settingsDraft.mineRule === 'engineer' ? 'any' : 'engineer';
    render();
    return;
  }
  if (hit === 'settings:flag') {
    state.settingsDraft.flagRule = state.settingsDraft.flagRule === 'smallest' ? 'any' : 'smallest';
    render();
    return;
  }
  if (hit === 'settings:confirm') {
    const nextDifficulty = state.settingsDraft.difficulty;
    delete state.settingsDraft.difficulty;
    state.settings = Object.assign({}, state.settingsDraft);
    saveObject(SETTINGS_STORAGE_KEY, state.settings);
    if (state.gameManager) {
      state.gameManager.settings = Object.assign({}, state.settings);
    }
    if (nextDifficulty) setDifficulty(nextDifficulty);
    closeOverlay(false);
    render();
    showToast('规则设置已保存');
    scheduleAiMove();
    return;
  }

  if (hit === 'snapshot:prev') {
    const pageCount = Math.max(1, Math.ceil(state.snapshots.length / 5));
    state.snapshotPage = (state.snapshotPage - 1 + pageCount) % pageCount;
    render();
    return;
  }
  if (hit === 'snapshot:next') {
    const pageCount = Math.max(1, Math.ceil(state.snapshots.length / 5));
    state.snapshotPage = (state.snapshotPage + 1) % pageCount;
    render();
    return;
  }
  if (hit.startsWith('snapshot:open:')) {
    const index = Number(hit.slice('snapshot:open:'.length));
    startReplay(index);
    return;
  }

  if (hit.startsWith('menu:')) {
    const action = hit.slice(5);
    closeOverlay(false);
    if (action === 'restart') restartGame();
    if (action === 'ai') manualAiMove();
    if (action === 'snapshots') openSnapshots();
    if (action === 'replay-prev') changeReplayStep(-1);
    if (action === 'replay-next') changeReplayStep(1);
    if (action === 'home') returnHome();
    if (action === 'rules') showRules();
    if (action === 'settings') showSettings();
    if (action === 'stats') showStats();
    if (action === 'about') showAbout();
  }
}

function openOverlay(type) {
  clearAiTimer();
  state.overlay = type;
  state.settingsDraft = type === 'settings'
    ? Object.assign({ difficulty: state.difficulty }, state.settings)
    : null;
  render();
}

function openSnapshots() {
  clearAiTimer();
  state.snapshotPage = 0;
  state.overlay = 'snapshots';
  state.settingsDraft = null;
  render();
}

function startReplay(index) {
  const record = state.snapshots[index];
  if (!record) return;
  clearAiTimer();
  const game = new GameManager();
  if (!game.loadReplaySnapshot(record, 0)) {
    showToast('快照已损坏');
    return;
  }
  state.mode = record.mode || GameMode.PVE;
  state.gameManager = game;
  state.screen = 'game';
  state.overlay = null;
  state.settingsDraft = null;
  state.resultModalOpen = false;
  state.resultRecorded = true;
  state.replay = { record, index: 0 };
  render();
  showToast('点棋盘前进，回退键后退');
}

function changeReplayStep(delta) {
  if (!state.replay || !state.gameManager) return;
  const maxStep = state.replay.record.actions.length;
  const nextIndex = Math.max(0, Math.min(maxStep, state.replay.index + delta));
  if (nextIndex === state.replay.index) {
    showToast(nextIndex === 0 ? '已到开局' : '已到终局');
    return;
  }
  state.replay.index = nextIndex;
  state.gameManager.loadReplaySnapshot(state.replay.record, nextIndex);
  render();
}

function closeOverlay(resumeAi) {
  state.overlay = null;
  state.settingsDraft = null;
  render();
  if (resumeAi !== false) scheduleAiMove();
}

function setDifficulty(difficulty) {
  if (!DIFFICULTY_OPTIONS.some((option) => option.value === difficulty)) return;
  state.difficulty = difficulty;
  try {
    wx.setStorageSync(DIFFICULTY_STORAGE_KEY, difficulty);
  } catch (error) {
    console.warn('保存难度设置失败', error);
  }

  const game = state.gameManager;
  if (game && state.mode === GameMode.PVE) {
    game.difficulty = difficulty;
    if (game.aiSide) {
      game.ai = new AI(game.aiSide, difficulty);
    }
  }
}

function handleActionResult(result) {
  if (!result) return;
  if (result.action === 'gameover') {
    showGameResult();
    return;
  }
  if (result.action === 'flipped' || result.action === 'moved') {
    if (state.gameManager.gameResult !== GameResult.PLAYING) {
      showGameResult();
    } else {
      scheduleAiMove();
    }
  }
}

function clearAiTimer() {
  if (state.aiTimer) {
    clearTimeout(state.aiTimer);
    state.aiTimer = null;
  }
}

function scheduleAiMove() {
  clearAiTimer();
  const game = state.gameManager;
  if (
    state.screen !== 'game' ||
    state.overlay ||
    state.replay ||
    state.mode !== GameMode.PVE ||
    !game ||
    game.gameResult !== GameResult.PLAYING ||
    !game.sidesAssigned ||
    game.currentSide !== game.aiSide
  ) {
    return;
  }

  render();
  state.aiTimer = setTimeout(() => {
    state.aiTimer = null;
    if (state.screen !== 'game' || !state.gameManager) return;
    const result = state.gameManager.aiMove();
    render();
    if (!result) {
      showToast('电脑暂无可用走法');
      return;
    }
    if (state.gameManager.gameResult !== GameResult.PLAYING) {
      showGameResult();
    }
  }, 650);
}

function undoMove() {
  clearAiTimer();
  if (!state.gameManager) return;
  const success = state.gameManager.undo();
  render();
  showToast(success ? '已悔棋' : '当前无法悔棋');
  if (success) scheduleAiMove();
}

function manualAiMove() {
  clearAiTimer();
  const game = state.gameManager;
  if (!game || game.gameResult !== GameResult.PLAYING) return;

  const ai = new AI(game.currentSide, state.difficulty);
  const move = ai.getMove(game.boardState, game.settings, {
    totalSteps: game.totalSteps,
    noCapSteps: game.noCapSteps
  });
  if (!move) {
    showToast('没有可用走法');
    return;
  }

  let result;
  if (move.type === 'flip') {
    result = game.flipPiece(move.from.col, move.from.row);
  } else {
    game.selectPiece(move.from.col, move.from.row);
    result = game.movePiece(move.from.col, move.from.row, move.to.col, move.to.row);
  }
  render();

  if (result && game.gameResult !== GameResult.PLAYING) {
    showGameResult();
  } else {
    scheduleAiMove();
  }
}

function showGameMenu() {
  openOverlay('menu');
}

function showRules() {
  wx.showActionSheet({
    itemList: RULE_PAGES.map((page) => page.title),
    success(result) {
      const page = RULE_PAGES[result.tapIndex];
      if (!page) return;
      wx.showModal({
        title: page.title,
        content: page.content,
        showCancel: false,
        confirmText: '知道了'
      });
    }
  });
}

function showSettings() {
  openOverlay('settings');
}

function showAbout() {
  wx.showModal({
    title: '关于军棋',
    content: `军棋陆战棋 v${VERSION}\n微信小游戏 Canvas 版\n\n支持人机对战、双人同屏、三级 AI 难度和最近 10 局快照复盘。`,
    showCancel: false,
    confirmText: '确定'
  });
}

function showStats() {
  const gameStats = state.gameManager ? state.gameManager.getStats() : null;
  const current = gameStats
    ? `本局第 ${gameStats.totalSteps} 步\n蓝方剩余 ${gameStats.redCount} 子\n橙方剩余 ${gameStats.blueCount} 子\n未翻开 ${gameStats.unrevealedCount} 子\n\n`
    : '';
  const history = `历史总场次 ${state.stats.totalGames}\n胜 ${state.stats.wins}  负 ${state.stats.losses}  和 ${state.stats.draws}`;
  wx.showModal({
    title: '战况统计',
    content: current + history,
    showCancel: false,
    confirmText: '确定'
  });
}

function recordGameResult() {
  if (state.resultRecorded || !state.gameManager) return;
  state.resultRecorded = true;
  const snapshot = state.gameManager.exportSnapshot();
  state.snapshots = appendSnapshot(state.snapshots, snapshot);
  saveObject(SNAPSHOTS_STORAGE_KEY, state.snapshots);
  state.stats.totalGames++;

  if (state.mode === GameMode.PVE) {
    const result = state.gameManager.gameResult;
    const playerSide = state.gameManager.playerSide;
    const playerWon =
      (result === GameResult.RED_WIN && playerSide === Side.RED) ||
      (result === GameResult.BLUE_WIN && playerSide === Side.BLUE);
    if (playerWon) state.stats.wins++;
    else if (result === GameResult.DRAW) state.stats.draws++;
    else state.stats.losses++;
  }
  saveObject(STATS_STORAGE_KEY, state.stats);
}

function showGameResult() {
  if (state.resultModalOpen || !state.gameManager) return;
  const result = state.gameManager.gameResult;
  if (result === GameResult.PLAYING) return;

  clearAiTimer();
  recordGameResult();
  state.resultModalOpen = true;
  const resultText = result === GameResult.RED_WIN
    ? '蓝方获胜！'
    : result === GameResult.BLUE_WIN
      ? '橙方获胜！'
      : '本局和棋';

  wx.showModal({
    title: '对局结束',
    content: `${resultText}\n共进行了 ${state.gameManager.totalSteps} 步`,
    confirmText: '再来一局',
    cancelText: '返回首页',
    success(modalResult) {
      state.resultModalOpen = false;
      if (modalResult.confirm) restartGame();
      else returnHome();
    },
    fail() {
      state.resultModalOpen = false;
    }
  });
}

function showToast(title) {
  wx.showToast({
    title,
    icon: 'none',
    duration: 900
  });
}

function getTouchPoint(event) {
  const touches = event && (event.changedTouches || event.touches);
  if (!touches || touches.length === 0) return null;
  const touch = touches[0];
  return {
    x: typeof touch.clientX === 'number' ? touch.clientX : touch.x,
    y: typeof touch.clientY === 'number' ? touch.clientY : touch.y
  };
}

wx.onTouchEnd((event) => {
  const point = getTouchPoint(event);
  if (point) handleTouch(point);
});

wx.onHide(() => {
  clearAiTimer();
});

wx.onShow(() => {
  render();
  scheduleAiMove();
});

if (typeof wx.onWindowResize === 'function') {
  wx.onWindowResize(() => {
    configureCanvas();
  });
}

configureCanvas();

module.exports = {
  __test: {
    state,
    handleTouch,
    render,
    setDifficulty,
    startReplay,
    changeReplayStep,
    recordGameResult
  }
};
