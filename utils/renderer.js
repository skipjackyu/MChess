/**
 * renderer.js - Canvas 棋盘渲染器
 * 绘制棋盘、棋子、选中状态、可移动位置等
 */

const { boardInstance, Board, LinkType } = require('./board');
const { SideColor, HiddenColor } = require('./pieces');

// 渲染配置
const Theme = {
  // 棋盘
  boardBg: '#D7B879',          // 木纹背景色
  boardStripe: 'rgba(119, 78, 34, 0.08)',
  boardBorder: '#5B4933',      // 棋盘边框
  boardInnerBorder: '#A7834E',
  
  // 线条
  roadColor: '#6A4527',        // 公路颜色
  roadWidth: 1.4,              // 公路线宽
  railColor: '#171717',        // 铁路颜色
  railWidth: 5,                // 铁路线宽
  railDash: [7, 6],            // 铁路枕木
  
  // 行营
  campColor: '#5B9B00',        // 行营边框色
  campBg: '#DEC99A',           // 行营填充
  campLineWidth: 3,
  
  // 大本营
  hqColor: '#FF8F00',
  hqLineWidth: 2,
  
  // 棋子
  pieceWidth: 0,               // 动态计算
  pieceHeight: 0,              // 动态计算
  pieceRadius: 6,              // 棋子圆角
  pieceFontSize: 0,            // 动态计算
  
  // 选中效果
  selectedBorder: '#F44336',
  selectedWidth: 3,
  
  // 可达位置标记
  reachableDotColor: 'rgba(76, 175, 80, 0.7)',
  reachableDotRadius: 8,
  reachableCapColor: 'rgba(244, 67, 54, 0.5)',
  
  // 河界
  riverBg: 'rgba(199, 154, 87, 0.28)',
  
  // 中间按钮
  btnColor: '#4AC7E8',
  btnSize: 24
};

/**
 * 渲染器类
 */
class Renderer {
  constructor(ctx, canvasWidth, canvasHeight, dpr) {
    this.ctx = ctx;
    this.width = canvasWidth;
    this.height = canvasHeight;
    this.dpr = dpr || 1;
    
    // 给边缘棋子、阴影和选中框留出完整空间。
    const horizontalPadding = Math.max(36, Math.min(46, this.width * 0.1));
    const verticalPadding = Math.max(24, Math.min(34, this.height * 0.05));
    this.padding = {
      left: horizontalPadding,
      right: horizontalPadding,
      top: verticalPadding,
      bottom: verticalPadding
    };
    
    // 棋盘实际尺寸 (5列 x 12行 + 河界)
    this.cols = 5;
    this.rows = 12;
    this.riverRows = 1; // 河界占1行空间
    
    // 计算格子大小
    const boardWidth = this.width - this.padding.left - this.padding.right;
    const boardHeight = this.height - this.padding.top - this.padding.bottom;
    
    this.cellWidth = boardWidth / (this.cols - 1);
    // 12行 + 1行河界 = 13个间距
    this.cellHeight = boardHeight / (this.rows + this.riverRows - 1);
    
    // 棋子尺寸
    Theme.pieceWidth = Math.min(this.cellWidth * 0.78, this.cellHeight * 1.7);
    Theme.pieceHeight = Math.min(this.cellHeight * 0.72, Theme.pieceWidth * 0.62);
    Theme.pieceFontSize = Math.max(10, Math.min(17, Theme.pieceHeight * 0.5));
  }

  /**
   * 将棋盘坐标 (col, row) 转换为画布坐标 (x, y)
   */
  boardToCanvas(col, row) {
    let y = this.padding.top + row * this.cellHeight;
    // 下方阵营（row >= 6）需要加上河界的额外空间
    if (row >= 6) {
      y += this.cellHeight * this.riverRows;
    }
    return {
      x: this.padding.left + col * this.cellWidth,
      y: y
    };
  }

  getPieceBounds(col, row, extra) {
    const point = this.boardToCanvas(col, row);
    const margin = extra || 0;
    return {
      left: point.x - Theme.pieceWidth / 2 - margin,
      top: point.y - Theme.pieceHeight / 2 - margin,
      right: point.x + Theme.pieceWidth / 2 + margin,
      bottom: point.y + Theme.pieceHeight / 2 + margin
    };
  }

  /**
   * 将画布坐标 (x, y) 转换为棋盘坐标 (col, row)
   */
  canvasToBoard(canvasX, canvasY) {
    // 先判断在河界上方还是下方
    const riverTop = this.padding.top + 6 * this.cellHeight;
    const riverBottom = riverTop + this.cellHeight * this.riverRows;
    
    let row;
    if (canvasY < riverTop) {
      // 上方阵营
      row = Math.round((canvasY - this.padding.top) / this.cellHeight);
    } else if (canvasY >= riverBottom) {
      // 下方阵营
      row = Math.round((canvasY - this.padding.top - this.cellHeight * this.riverRows) / this.cellHeight);
    } else {
      // 在河界区域，返回无效
      return null;
    }
    
    const col = Math.round((canvasX - this.padding.left) / this.cellWidth);
    
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return null;
    }
    
    // 检查点击是否足够接近节点
    const { x, y } = this.boardToCanvas(col, row);
    const dist = Math.sqrt((canvasX - x) ** 2 + (canvasY - y) ** 2);
    if (dist > this.cellWidth * 0.6) {
      return null;
    }
    
    return { col, row };
  }

  /**
   * 完整渲染
   */
  render(boardState, selectedPos, reachablePositions, gameResult) {
    const ctx = this.ctx;
    
    // 清空画布
    ctx.clearRect(0, 0, this.width, this.height);
    
    // 1. 绘制棋盘背景
    this._drawBoardBackground();
    
    // 2. 绘制河界
    this._drawRiver();

    // 3. 绘制连接线
    this._drawConnections();
    
    // 4. 绘制行营和大本营
    this._drawCamps();
    this._drawHeadquarters();
    
    // 5. 绘制可达位置标记
    if (reachablePositions && reachablePositions.length > 0) {
      this._drawReachablePositions(reachablePositions, boardState);
    }
    
    // 6. 绘制棋子
    this._drawPieces(boardState, selectedPos);
    
    // 7. 绘制中间按钮区域的图标
    this._drawRiverButtons();
  }

  /**
   * 绘制棋盘背景
   */
  _drawBoardBackground() {
    const ctx = this.ctx;
    
    ctx.fillStyle = Theme.boardBg;
    ctx.fillRect(3, 3, this.width - 6, this.height - 6);

    ctx.fillStyle = Theme.boardStripe;
    const stripeWidth = Math.max(18, this.width / 14);
    for (let x = 12; x < this.width - 12; x += stripeWidth * 2) {
      ctx.fillRect(x, 12, stripeWidth, this.height - 24);
    }

    ctx.strokeStyle = Theme.boardBorder;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, this.width - 6, this.height - 6);
    ctx.strokeStyle = Theme.boardInnerBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(11, 11, this.width - 22, this.height - 22);
  }

  /**
   * 绘制所有连接线
   */
  _drawConnections() {
    const ctx = this.ctx;
    const drawn = new Set();
    
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const key = Board.posKey(col, row);
        const adjacents = boardInstance.getAdjacentPositions(col, row);
        
        for (const link of adjacents) {
          const { col: tc, row: tr } = Board.parseKey(link.pos);
          const linkKey = `${Math.min(col * 100 + row, tc * 100 + tr)}-${Math.max(col * 100 + row, tc * 100 + tr)}-${link.type}`;
          
          if (drawn.has(linkKey)) continue;
          drawn.add(linkKey);
          
          const from = this.boardToCanvas(col, row);
          const to = this.boardToCanvas(tc, tr);
          
          if (link.type === LinkType.RAIL) {
            // 铁路 - 黑色轨道和白色枕木
            ctx.strokeStyle = Theme.railColor;
            ctx.lineWidth = Theme.railWidth;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();

            ctx.strokeStyle = '#F7F2E8';
            ctx.lineWidth = 2;
            ctx.setLineDash(Theme.railDash);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            // 公路 - 细实线
            ctx.strokeStyle = Theme.roadColor;
            ctx.lineWidth = Theme.roadWidth;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
          }
        }
      }
    }
  }

  /**
   * 绘制行营
   */
  _drawCamps() {
    const ctx = this.ctx;
    const campPositions = [
      [1, 2], [3, 2], [2, 3], [1, 4], [3, 4],
      [1, 7], [3, 7], [2, 8], [1, 9], [3, 9]
    ];
    
    for (const [col, row] of campPositions) {
      const { x, y } = this.boardToCanvas(col, row);
      const radius = Math.min(this.cellWidth, this.cellHeight) * 0.35;
      
      // 行营圆形
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = Theme.campBg;
      ctx.fill();
      ctx.strokeStyle = Theme.campColor;
      ctx.lineWidth = Theme.campLineWidth;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = '#355E00';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _drawHeadquarters() {
    const ctx = this.ctx;
    const positions = [[1, 0], [3, 0], [1, 11], [3, 11]];
    const width = Theme.pieceWidth * 0.9;
    const height = Theme.pieceHeight * 0.82;

    for (const [col, row] of positions) {
      const { x, y } = this.boardToCanvas(col, row);
      ctx.fillStyle = 'rgba(255, 167, 38, 0.32)';
      ctx.fillRect(x - width / 2, y - height / 2, width, height);
      ctx.strokeStyle = Theme.hqColor;
      ctx.lineWidth = Theme.hqLineWidth;
      ctx.strokeRect(x - width / 2, y - height / 2, width, height);
    }
  }

  /**
   * 绘制河界
   */
  _drawRiver() {
    const ctx = this.ctx;
    const topY = this.boardToCanvas(0, 5).y;
    const bottomY = this.boardToCanvas(0, 6).y;
    
    // 河界背景
    ctx.fillStyle = Theme.riverBg;
    ctx.fillRect(
      12,
      topY + this.cellHeight * 0.3,
      this.width - 24,
      bottomY - topY - this.cellHeight * 0.6
    );
  }

  /**
   * 绘制河界区域的按钮图标
   */
  _drawRiverButtons() {
    const ctx = this.ctx;
    const topY = this.boardToCanvas(0, 5).y;
    const bottomY = this.boardToCanvas(0, 6).y;
    const centerY = (topY + bottomY) / 2;
    
    // 菜单按钮 (左侧)
    const menuX = this.boardToCanvas(1, 0).x;
    ctx.shadowColor = 'rgba(72, 216, 255, 0.85)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = Theme.btnColor;
    ctx.fillStyle = Theme.btnColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let offset = -7; offset <= 7; offset += 7) {
      ctx.beginPath();
      ctx.arc(menuX - 9, centerY + offset, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(menuX - 3, centerY + offset);
      ctx.lineTo(menuX + 10, centerY + offset);
      ctx.stroke();
    }

    // 悔棋按钮 (右侧)
    const undoX = this.boardToCanvas(3, 0).x;
    ctx.beginPath();
    ctx.arc(undoX + 2, centerY + 1, 10, -0.9, Math.PI * 1.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(undoX - 10, centerY - 5);
    ctx.lineTo(undoX - 11, centerY + 5);
    ctx.lineTo(undoX - 2, centerY + 1);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.lineCap = 'butt';
    
    // 记录按钮区域（用于点击检测）
    this.menuBtnArea = { x: menuX - 20, y: centerY - 20, w: 40, h: 40 };
    this.undoBtnArea = { x: undoX - 20, y: centerY - 20, w: 40, h: 40 };
  }

  /**
   * 绘制所有棋子
   */
  _drawPieces(boardState, selectedPos) {
    for (const key in boardState) {
      const piece = boardState[key];
      if (!piece || !piece.alive) continue;
      
      const { col, row } = Board.parseKey(key);
      const { x, y } = this.boardToCanvas(col, row);
      const isSelected = selectedPos && selectedPos.col === col && selectedPos.row === row;
      
      this._drawSinglePiece(x, y, piece, isSelected);
    }
  }

  /**
   * 绘制单个棋子
   */
  _drawSinglePiece(x, y, piece, isSelected) {
    const ctx = this.ctx;
    const w = Theme.pieceWidth;
    const h = Theme.pieceHeight;
    const r = Theme.pieceRadius;
    
    const left = x - w / 2;
    const top = y - h / 2;
    
    // 棋子阴影
    ctx.shadowColor = 'rgba(38, 28, 18, 0.42)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    
    if (piece.revealed) {
      // 已翻开 - 显示棋子信息
      const colors = SideColor[piece.side];
      
      // 棋子背景
      ctx.fillStyle = colors.bg;
      this._roundRect(left, top, w, h, r);
      ctx.fill();

      // 边框
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 2;
      this._roundRect(left, top, w, h, r);
      ctx.stroke();
      
      // 棋子文字
      ctx.fillStyle = colors.text;
      ctx.font = `bold ${Theme.pieceFontSize}px 'PingFang SC', 'Heiti SC', 'STHeiti', 'Microsoft YaHei', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(piece.name, x, y);
    } else {
      // 未翻开 - 绿色背景
      ctx.fillStyle = HiddenColor.bg;
      this._roundRect(left, top, w, h, r);
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = HiddenColor.border;
      ctx.lineWidth = 2;
      this._roundRect(left, top, w, h, r);
      ctx.stroke();
    }
    
    // 选中效果
    if (isSelected) {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = Theme.selectedBorder;
      ctx.lineWidth = Theme.selectedWidth;
      this._roundRect(left - 2, top - 2, w + 4, h + 4, r + 2);
      ctx.stroke();
    }
    
    // 重置阴影
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  /**
   * 绘制可达位置标记
   */
  _drawReachablePositions(positions, boardState) {
    const ctx = this.ctx;
    
    for (const pos of positions) {
      const { x, y } = this.boardToCanvas(pos.col, pos.row);
      const key = Board.posKey(pos.col, pos.row);
      const hasPiece = boardState[key];
      
      if (hasPiece) {
        // 有对方棋子 - 红色边框标记（可吃）
        const w = Theme.pieceWidth + 8;
        const h = Theme.pieceHeight + 8;
        ctx.strokeStyle = Theme.reachableCapColor;
        ctx.lineWidth = 3;
        this._roundRect(x - w / 2, y - h / 2, w, h, Theme.pieceRadius + 2);
        ctx.stroke();
      } else {
        // 空位 - 绿色小圆点
        ctx.beginPath();
        ctx.arc(x, y, Theme.reachableDotRadius, 0, Math.PI * 2);
        ctx.fillStyle = Theme.reachableDotColor;
        ctx.fill();
      }
    }
  }

  /**
   * 检查点击是否在按钮区域
   */
  hitTestButton(canvasX, canvasY) {
    if (this.menuBtnArea) {
      const a = this.menuBtnArea;
      if (canvasX >= a.x && canvasX <= a.x + a.w && canvasY >= a.y && canvasY <= a.y + a.h) {
        return 'menu';
      }
    }
    if (this.undoBtnArea) {
      const a = this.undoBtnArea;
      if (canvasX >= a.x && canvasX <= a.x + a.w && canvasY >= a.y && canvasY <= a.y + a.h) {
        return 'undo';
      }
    }
    return null;
  }

  /**
   * 绘制圆角矩形路径
   */
  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

module.exports = {
  Renderer,
  Theme
};
