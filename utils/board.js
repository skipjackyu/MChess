/**
 * board.js - 棋盘数据模型
 * 定义棋盘的拓扑结构、位置类型、连接关系
 * 
 * 棋盘布局 (5列 x 12行):
 *   行0-4:   上方阵营 (蓝方/RED)
 *   行5:     上方铁路边界行
 *   行6-7:   中间河界区域 (无棋子落点)
 *   行8:     下方铁路边界行  
 *   行8-11:  下方阵营 (橙方/BLUE)
 * 
 * 实际棋子可落点的行：0,1,2,3,4,5 (上方) 和 6,7,8,9,10,11 (下方)
 * 中间无河界行，河界通过UI表示
 * 
 * 重新定义: 标准军棋棋盘
 * 上方6行(行0~5)属于上方阵营，下方6行(行6~11)属于下方阵营
 * 中间用UI表现河界（在行5和行6之间）
 * 
 * 每个位置用 (col, row) 表示, col: 0~4, row: 0~11
 */

// 位置类型
const NodeType = {
  NORMAL: 'normal',     // 普通结点
  CAMP: 'camp',         // 行营 (安全岛，不能被吃)
  HQ: 'hq',             // 大本营
  RAIL_ONLY: 'rail'     // 铁路专属结点(不单独用，通过连接关系体现)
};

// 连接类型
const LinkType = {
  ROAD: 'road',     // 公路 (走一步)
  RAIL: 'rail'      // 铁路 (工兵可多步，其他直线一步)
};

/**
 * 棋盘类
 */
class Board {
  constructor() {
    // 节点总数: 5列 x 12行 = 60
    this.cols = 5;
    this.rows = 12;
    
    // 位置类型映射
    this.nodeTypes = {};
    
    // 邻接表: key = "col,row", value = [{pos: "col,row", type: LinkType}, ...]
    this.adjacency = {};
    
    // 铁路位置集合
    this.railPositions = new Set();
    
    this._initNodeTypes();
    this._initConnections();
  }

  /**
   * 位置编码
   */
  static posKey(col, row) {
    return `${col},${row}`;
  }

  /**
   * 位置解码
   */
  static parseKey(key) {
    const parts = key.split(',');
    return { col: parseInt(parts[0]), row: parseInt(parts[1]) };
  }

  /**
   * 初始化各位置的类型
   */
  _initNodeTypes() {
    // 默认所有位置为普通结点
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.nodeTypes[Board.posKey(col, row)] = NodeType.NORMAL;
      }
    }

    // 上方行营位置，与下方棋盘沿河界镜像
    const upperCamps = [[1, 2], [3, 2], [2, 3], [1, 4], [3, 4]];
    for (const [c, r] of upperCamps) {
      this.nodeTypes[Board.posKey(c, r)] = NodeType.CAMP;
    }

    // 下方行营位置 (对称)
    const lowerCamps = [[1, 7], [3, 7], [2, 8], [1, 9], [3, 9]];
    for (const [c, r] of lowerCamps) {
      this.nodeTypes[Board.posKey(c, r)] = NodeType.CAMP;
    }

    // 上方大本营
    this.nodeTypes[Board.posKey(1, 0)] = NodeType.HQ;
    this.nodeTypes[Board.posKey(3, 0)] = NodeType.HQ;

    // 下方大本营
    this.nodeTypes[Board.posKey(1, 11)] = NodeType.HQ;
    this.nodeTypes[Board.posKey(3, 11)] = NodeType.HQ;
  }

  /**
   * 初始化所有连接关系
   */
  _initConnections() {
    // 初始化空邻接表
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.adjacency[Board.posKey(col, row)] = [];
      }
    }

    // 定义铁路位置
    this._initRailPositions();
    
    // 建立所有连接
    this._buildConnections();
  }

  /**
   * 初始化铁路位置
   * 铁路线分布:
   * - 行0: 横向铁路 (col 0~4)
   * - 行5: 横向铁路 (col 0~4) - 上方底部
   * - 行6: 横向铁路 (col 0~4) - 下方顶部
   * - 行11: 横向铁路 (col 0~4)
   * - col 0: 纵向铁路 (row 0~5, row 6~11)
   * - col 4: 纵向铁路 (row 0~5, row 6~11)
   * - col 2: 中间纵向铁路连接 (row 5~6 跨河)
   */
  _initRailPositions() {
    // 横向铁路: 行 0, 5, 6, 11
    for (let col = 0; col < 5; col++) {
      this.railPositions.add(Board.posKey(col, 0));
      this.railPositions.add(Board.posKey(col, 5));
      this.railPositions.add(Board.posKey(col, 6));
      this.railPositions.add(Board.posKey(col, 11));
    }
    
    // 纵向铁路: col 0 和 col 4
    for (let row = 0; row <= 11; row++) {
      this.railPositions.add(Board.posKey(0, row));
      this.railPositions.add(Board.posKey(4, row));
    }
    
    // 中间纵向: col 2, row 5 和 row 6 (跨河连接)
    this.railPositions.add(Board.posKey(2, 5));
    this.railPositions.add(Board.posKey(2, 6));
  }

  /**
   * 添加连接 (双向)
   */
  _addLink(col1, row1, col2, row2, type) {
    const key1 = Board.posKey(col1, row1);
    const key2 = Board.posKey(col2, row2);
    
    // 避免重复添加
    if (!this.adjacency[key1].some(l => l.pos === key2 && l.type === type)) {
      this.adjacency[key1].push({ pos: key2, type: type });
    }
    if (!this.adjacency[key2].some(l => l.pos === key1 && l.type === type)) {
      this.adjacency[key2].push({ pos: key1, type: type });
    }
  }

  /**
   * 构建所有连接
   */
  _buildConnections() {
    // === 铁路连接 ===
    
    // 横向铁路: 行0
    for (let col = 0; col < 4; col++) {
      this._addLink(col, 0, col + 1, 0, LinkType.RAIL);
    }
    // 横向铁路: 行5
    for (let col = 0; col < 4; col++) {
      this._addLink(col, 5, col + 1, 5, LinkType.RAIL);
    }
    // 横向铁路: 行6
    for (let col = 0; col < 4; col++) {
      this._addLink(col, 6, col + 1, 6, LinkType.RAIL);
    }
    // 横向铁路: 行11
    for (let col = 0; col < 4; col++) {
      this._addLink(col, 11, col + 1, 11, LinkType.RAIL);
    }
    
    // 纵向铁路: col 0 (row 0~5 上方, row 6~11 下方)
    for (let row = 0; row < 5; row++) {
      this._addLink(0, row, 0, row + 1, LinkType.RAIL);
    }
    for (let row = 6; row < 11; row++) {
      this._addLink(0, row, 0, row + 1, LinkType.RAIL);
    }
    // 纵向铁路: col 4
    for (let row = 0; row < 5; row++) {
      this._addLink(4, row, 4, row + 1, LinkType.RAIL);
    }
    for (let row = 6; row < 11; row++) {
      this._addLink(4, row, 4, row + 1, LinkType.RAIL);
    }
    
    // 跨河铁路连接
    this._addLink(0, 5, 0, 6, LinkType.RAIL);  // 左侧
    this._addLink(4, 5, 4, 6, LinkType.RAIL);  // 右侧
    this._addLink(2, 5, 2, 6, LinkType.RAIL);  // 中间

    // === 公路连接 ===
    
    // 上方阵营内部公路，从河界向上镜像构建
    this._buildZoneRoads(5, -1);
    
    // 下方阵营内部公路，从河界向下构建
    this._buildZoneRoads(6, 1);
    
    // 跨河公路连接 (行5到行6)
    // 左右铁路已连，中间铁路已连，补充公路连接
    this._addLink(1, 5, 1, 6, LinkType.ROAD);
    this._addLink(3, 5, 3, 6, LinkType.ROAD);
  }

  /**
   * 构建一个阵营区域内的公路连接
   * @param {number} riverRow - 靠近河界的铁路行
   * @param {number} direction - 从河界指向大本营的行方向
   */
  _buildZoneRoads(riverRow, direction) {
    const r0 = riverRow;
    const r1 = r0 + direction;
    const r2 = r1 + direction;
    const r3 = r2 + direction;
    const r4 = r3 + direction;
    const r5 = r4 + direction;

    // --- 纵向公路 ---
    const zoneRows = [r0, r1, r2, r3, r4, r5];
    for (let index = 0; index < zoneRows.length - 1; index++) {
      const fromRow = zoneRows[index];
      const toRow = zoneRows[index + 1];
      this._addLink(1, fromRow, 1, toRow, LinkType.ROAD);
      this._addLink(2, fromRow, 2, toRow, LinkType.ROAD);
      this._addLink(3, fromRow, 3, toRow, LinkType.ROAD);
    }

    // --- 横向公路 ---
    // 行r1: col 0-1, 1-2, 2-3, 3-4 (非铁路行的横向连接)
    for (let c = 0; c < 4; c++) {
      this._addLink(c, r1, c + 1, r1, LinkType.ROAD);
    }
    // 行r2: col 0-1, 1-2, 2-3, 3-4
    for (let c = 0; c < 4; c++) {
      this._addLink(c, r2, c + 1, r2, LinkType.ROAD);
    }
    // 行r3: col 0-1, 1-2, 2-3, 3-4
    for (let c = 0; c < 4; c++) {
      this._addLink(c, r3, c + 1, r3, LinkType.ROAD);
    }
    // 行r4: col 0-1, 1-2, 2-3, 3-4
    for (let c = 0; c < 4; c++) {
      this._addLink(c, r4, c + 1, r4, LinkType.ROAD);
    }

    // --- 行营斜线连接 ---
    // 上方行营斜线 (以r1行的行营为中心)
    // (1,r1) 连接到 (0,r0), (2,r0), (0,r2), (2,r2)
    this._addLink(1, r1, 0, r0, LinkType.ROAD);
    this._addLink(1, r1, 2, r0, LinkType.ROAD);
    this._addLink(1, r1, 0, r2, LinkType.ROAD);
    this._addLink(1, r1, 2, r2, LinkType.ROAD);

    // (3,r1) 连接到 (2,r0), (4,r0), (2,r2), (4,r2)
    this._addLink(3, r1, 2, r0, LinkType.ROAD);
    this._addLink(3, r1, 4, r0, LinkType.ROAD);
    this._addLink(3, r1, 2, r2, LinkType.ROAD);
    this._addLink(3, r1, 4, r2, LinkType.ROAD);

    // 中心行营 (2,r2) 连接到四个角行营
    this._addLink(2, r2, 1, r1, LinkType.ROAD);
    this._addLink(2, r2, 3, r1, LinkType.ROAD);
    this._addLink(2, r2, 1, r3, LinkType.ROAD);
    this._addLink(2, r2, 3, r3, LinkType.ROAD);

    // 下方行营斜线 (以r3行的行营为中心)
    // (1,r3) 连接到 (0,r2), (2,r2), (0,r4), (2,r4)
    this._addLink(1, r3, 0, r2, LinkType.ROAD);
    this._addLink(1, r3, 2, r2, LinkType.ROAD);
    this._addLink(1, r3, 0, r4, LinkType.ROAD);
    this._addLink(1, r3, 2, r4, LinkType.ROAD);

    // (3,r3) 连接到 (2,r2), (4,r2), (2,r4), (4,r4)
    this._addLink(3, r3, 2, r2, LinkType.ROAD);
    this._addLink(3, r3, 4, r2, LinkType.ROAD);
    this._addLink(3, r3, 2, r4, LinkType.ROAD);
    this._addLink(3, r3, 4, r4, LinkType.ROAD);

    // --- 大本营连接 ---
    // 大本营 (1,r5) 连接到 (0,r4), (1,r4), (2,r4)
    this._addLink(1, r5, 0, r4, LinkType.ROAD);
    this._addLink(1, r5, 1, r4, LinkType.ROAD);
    this._addLink(1, r5, 2, r4, LinkType.ROAD);
    // 大本营 (3,r5) 连接到 (2,r4), (3,r4), (4,r4)
    this._addLink(3, r5, 2, r4, LinkType.ROAD);
    this._addLink(3, r5, 3, r4, LinkType.ROAD);
    this._addLink(3, r5, 4, r4, LinkType.ROAD);
  }

  /**
   * 获取指定位置的类型
   */
  getNodeType(col, row) {
    return this.nodeTypes[Board.posKey(col, row)] || null;
  }

  /**
   * 获取指定位置的所有邻接位置
   */
  getAdjacentPositions(col, row) {
    return this.adjacency[Board.posKey(col, row)] || [];
  }

  /**
   * 检查位置是否是行营
   */
  isCamp(col, row) {
    return this.getNodeType(col, row) === NodeType.CAMP;
  }

  /**
   * 检查位置是否是大本营
   */
  isHQ(col, row) {
    return this.getNodeType(col, row) === NodeType.HQ;
  }

  /**
   * 检查位置是否在铁路上
   */
  isOnRail(col, row) {
    return this.railPositions.has(Board.posKey(col, row));
  }

  /**
   * 检查位置是否有效
   */
  isValidPosition(col, row) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  /**
   * 获取上方阵营的所有位置 (row 0~5)
   */
  getUpperPositions() {
    const positions = [];
    for (let row = 0; row <= 5; row++) {
      for (let col = 0; col < 5; col++) {
        positions.push({ col, row });
      }
    }
    return positions;
  }

  /**
   * 获取下方阵营的所有位置 (row 6~11)
   */
  getLowerPositions() {
    const positions = [];
    for (let row = 6; row <= 11; row++) {
      for (let col = 0; col < 5; col++) {
        positions.push({ col, row });
      }
    }
    return positions;
  }

  /**
   * 获取所有位置
   */
  getAllPositions() {
    const positions = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        positions.push({ col, row });
      }
    }
    return positions;
  }
}

// 创建单例棋盘
const boardInstance = new Board();

module.exports = {
  Board,
  NodeType,
  LinkType,
  boardInstance
};
