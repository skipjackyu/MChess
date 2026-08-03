/**
 * pathfinder.js - 路径查找算法
 * 计算棋子的合法移动目标位置
 */

const { boardInstance, Board, LinkType, NodeType } = require('./board');
const { PieceType, canMove } = require('./pieces');

/**
 * 获取棋子的所有可达位置
 * @param {number} col - 棋子当前列
 * @param {number} row - 棋子当前行
 * @param {Object} piece - 棋子对象
 * @param {Object} boardState - 棋盘状态 (posKey => piece 映射)
 * @param {Object} settings - 规则配置
 * @returns {Array} 可达位置列表 [{col, row}]
 */
function getReachablePositions(col, row, piece, boardState, settings) {
  if (!piece || !piece.revealed || !canMove(piece.type)) {
    return [];
  }

  const isEngineer = piece.type === PieceType.ENGINEER;
  const results = new Set();
  const startKey = Board.posKey(col, row);

  // 1. 公路移动: 所有棋子都可以沿公路走一步
  const adjacents = boardInstance.getAdjacentPositions(col, row);
  for (const link of adjacents) {
    if (link.type === LinkType.ROAD) {
      const target = Board.posKey(link.pos.split(',')[0], link.pos.split(',')[1]);
      results.add(link.pos);
    }
  }

  // 2. 铁路移动
  if (boardInstance.isOnRail(col, row)) {
    if (isEngineer) {
      // 工兵: BFS搜索所有可达铁路位置（可拐弯）
      const railReachable = bfsRailEngineer(col, row, boardState);
      for (const pos of railReachable) {
        results.add(pos);
      }
    } else {
      // 非工兵: 只能沿铁路直线移动（不能拐弯）
      const railReachable = railStraightMove(col, row, boardState);
      for (const pos of railReachable) {
        results.add(pos);
      }
    }
  }

  // 3. 过滤不可达位置
  const validResults = [];
  for (const posKey of results) {
    if (posKey === startKey) continue;
    
    const { col: tc, row: tr } = Board.parseKey(posKey);
    
    // 检查位置有效性
    if (!boardInstance.isValidPosition(tc, tr)) continue;
    
    const targetPiece = boardState[posKey];
    
    // 如果目标位置有棋子
    if (targetPiece) {
      // 不能吃自己的棋子
      if (targetPiece.side === piece.side) continue;
      
      // 行营中的棋子不能被吃
      if (boardInstance.isCamp(tc, tr)) continue;
      
      // 未翻开的棋子不能被吃（翻棋模式中需翻开才能交互）
      if (!targetPiece.revealed) continue;
    }
    
    validResults.push({ col: tc, row: tr });
  }

  return validResults;
}

/**
 * 工兵的铁路BFS搜索（可拐弯）
 */
function bfsRailEngineer(startCol, startRow, boardState) {
  const startKey = Board.posKey(startCol, startRow);
  const visited = new Set([startKey]);
  const queue = [startKey];
  const reachable = [];

  while (queue.length > 0) {
    const currentKey = queue.shift();
    const { col, row } = Board.parseKey(currentKey);
    
    const adjacents = boardInstance.getAdjacentPositions(col, row);
    
    for (const link of adjacents) {
      if (link.type !== LinkType.RAIL) continue;
      if (visited.has(link.pos)) continue;
      
      visited.add(link.pos);
      
      const targetPiece = boardState[link.pos];
      
      if (targetPiece) {
        // 有棋子的位置可以作为终点但不能继续穿过
        reachable.push(link.pos);
        // 不入队列（不能穿过）
      } else {
        // 空位可以继续搜索
        reachable.push(link.pos);
        queue.push(link.pos);
      }
    }
  }

  return reachable;
}

/**
 * 非工兵的铁路直线移动（不能拐弯）
 * 沿四个方向（上下左右）直线搜索
 */
function railStraightMove(startCol, startRow, boardState) {
  const reachable = [];
  const directions = [
    { dc: 0, dr: -1 },  // 上
    { dc: 0, dr: 1 },   // 下
    { dc: -1, dr: 0 },  // 左
    { dc: 1, dr: 0 }    // 右
  ];

  for (const dir of directions) {
    let c = startCol + dir.dc;
    let r = startRow + dir.dr;

    while (boardInstance.isValidPosition(c, r) && boardInstance.isOnRail(c, r)) {
      const key = Board.posKey(c, r);
      
      // 检查是否是通过铁路连接的（需要确保连续的铁路连接）
      const prevKey = Board.posKey(c - dir.dc, r - dir.dr);
      const adjacents = boardInstance.getAdjacentPositions(c - dir.dc, r - dir.dr);
      const hasRailLink = adjacents.some(l => l.pos === key && l.type === LinkType.RAIL);
      
      if (!hasRailLink) break;

      const targetPiece = boardState[key];
      if (targetPiece) {
        // 有棋子，可以作为终点但不能穿过
        reachable.push(key);
        break;
      }
      
      reachable.push(key);
      c += dir.dc;
      r += dir.dr;
    }
  }

  return reachable;
}

/**
 * 获取所有可翻开的位置
 * @param {Object} boardState - 棋盘状态
 * @returns {Array} 可翻开的位置列表
 */
function getFlippablePositions(boardState) {
  const positions = [];
  for (const key in boardState) {
    const piece = boardState[key];
    if (piece && !piece.revealed && piece.alive) {
      const { col, row } = Board.parseKey(key);
      positions.push({ col, row });
    }
  }
  return positions;
}

module.exports = {
  getReachablePositions,
  getFlippablePositions,
  bfsRailEngineer,
  railStraightMove
};
