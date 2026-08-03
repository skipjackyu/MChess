/**
 * pieces.js - 棋子定义与常量
 * 定义所有棋子类型、等级、数量、颜色等属性
 */

// 棋子类型枚举
const PieceType = {
  COMMANDER: 'commander',   // 司令
  GENERAL: 'general',       // 军长
  DIVISION: 'division',     // 师长
  BRIGADE: 'brigade',       // 旅长
  REGIMENT: 'regiment',     // 团长
  BATTALION: 'battalion',   // 营长
  COMPANY: 'company',       // 连长
  PLATOON: 'platoon',       // 排长
  ENGINEER: 'engineer',     // 工兵
  BOMB: 'bomb',             // 炸弹
  MINE: 'mine',             // 地雷
  FLAG: 'flag'              // 军旗
};

// 棋子中文名称
const PieceName = {
  [PieceType.COMMANDER]: '司令',
  [PieceType.GENERAL]: '军长',
  [PieceType.DIVISION]: '师长',
  [PieceType.BRIGADE]: '旅长',
  [PieceType.REGIMENT]: '团长',
  [PieceType.BATTALION]: '营长',
  [PieceType.COMPANY]: '连长',
  [PieceType.PLATOON]: '排长',
  [PieceType.ENGINEER]: '工兵',
  [PieceType.BOMB]: '炸弹',
  [PieceType.MINE]: '地雷',
  [PieceType.FLAG]: '军旗'
};

// 棋子等级 (用于比较大小)
const PieceRank = {
  [PieceType.COMMANDER]: 9,
  [PieceType.GENERAL]: 8,
  [PieceType.DIVISION]: 7,
  [PieceType.BRIGADE]: 6,
  [PieceType.REGIMENT]: 5,
  [PieceType.BATTALION]: 4,
  [PieceType.COMPANY]: 3,
  [PieceType.PLATOON]: 2,
  [PieceType.ENGINEER]: 1,
  [PieceType.BOMB]: 0,
  [PieceType.MINE]: -1,
  [PieceType.FLAG]: -2
};

// 棋子价值 (用于AI评估)
const PieceValue = {
  [PieceType.COMMANDER]: 100,
  [PieceType.GENERAL]: 85,
  [PieceType.DIVISION]: 70,
  [PieceType.BRIGADE]: 55,
  [PieceType.REGIMENT]: 45,
  [PieceType.BATTALION]: 35,
  [PieceType.COMPANY]: 25,
  [PieceType.PLATOON]: 15,
  [PieceType.ENGINEER]: 50,  // 工兵价值高是因为可以挖雷扛旗
  [PieceType.BOMB]: 60,
  [PieceType.MINE]: 40,
  [PieceType.FLAG]: 1000     // 军旗是无限价值
};

// 每方棋子配置 (type: count)
const PieceConfig = [
  { type: PieceType.COMMANDER, count: 1 },
  { type: PieceType.GENERAL, count: 1 },
  { type: PieceType.DIVISION, count: 2 },
  { type: PieceType.BRIGADE, count: 2 },
  { type: PieceType.REGIMENT, count: 2 },
  { type: PieceType.BATTALION, count: 2 },
  { type: PieceType.COMPANY, count: 3 },
  { type: PieceType.PLATOON, count: 3 },
  { type: PieceType.ENGINEER, count: 3 },
  { type: PieceType.BOMB, count: 2 },
  { type: PieceType.MINE, count: 3 },
  { type: PieceType.FLAG, count: 1 }
];

// 阵营颜色
const Side = {
  RED: 'red',     // 蓝方 (上方)
  BLUE: 'blue'    // 橙方 (下方)
};

// 棋子颜色配置
const SideColor = {
  [Side.RED]: {
    bg: '#1565C0',
    text: '#FFFFFF',
    border: '#0D47A1',
    name: '蓝方'
  },
  [Side.BLUE]: {
    bg: '#E65100',
    text: '#FFFFFF',
    border: '#BF360C',
    name: '橙方'
  }
};

// 未翻开棋子颜色
const HiddenColor = {
  bg: '#689F38',
  border: '#558B2F',
  shadow: '#33691E'
};

/**
 * 创建一个棋子对象
 */
function createPiece(type, side, id) {
  return {
    id: id,
    type: type,
    side: side,
    rank: PieceRank[type],
    name: PieceName[type],
    value: PieceValue[type],
    revealed: false,   // 是否已翻开
    alive: true        // 是否存活
  };
}

/**
 * 生成一方的所有棋子
 */
function generateSidePieces(side, startId) {
  const pieces = [];
  let id = startId;
  for (const config of PieceConfig) {
    for (let i = 0; i < config.count; i++) {
      pieces.push(createPiece(config.type, side, id++));
    }
  }
  return pieces;
}

/**
 * 生成所有棋子（双方共50枚）
 */
function generateAllPieces() {
  const redPieces = generateSidePieces(Side.RED, 0);
  const bluePieces = generateSidePieces(Side.BLUE, 25);
  return [...redPieces, ...bluePieces];
}

/**
 * 判断棋子是否可以移动
 */
function canMove(pieceType) {
  return pieceType !== PieceType.MINE && pieceType !== PieceType.FLAG;
}

module.exports = {
  PieceType,
  PieceName,
  PieceRank,
  PieceValue,
  PieceConfig,
  Side,
  SideColor,
  HiddenColor,
  createPiece,
  generateSidePieces,
  generateAllPieces,
  canMove
};
