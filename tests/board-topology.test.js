const test = require('node:test');
const assert = require('node:assert/strict');

const { Board, LinkType, boardInstance } = require('../utils/board');

function hasLink(from, to, type) {
  return boardInstance.getAdjacentPositions(from.col, from.row).some(link => (
    link.pos === Board.posKey(to.col, to.row) && link.type === type
  ));
}

test('board excludes nonexistent headquarters diagonals and side river crossings', () => {
  const nonexistentRoads = [
    [{ col: 1, row: 0 }, { col: 0, row: 1 }],
    [{ col: 1, row: 0 }, { col: 2, row: 1 }],
    [{ col: 3, row: 0 }, { col: 2, row: 1 }],
    [{ col: 3, row: 0 }, { col: 4, row: 1 }],
    [{ col: 1, row: 11 }, { col: 0, row: 10 }],
    [{ col: 1, row: 11 }, { col: 2, row: 10 }],
    [{ col: 3, row: 11 }, { col: 2, row: 10 }],
    [{ col: 3, row: 11 }, { col: 4, row: 10 }],
    [{ col: 1, row: 5 }, { col: 1, row: 6 }],
    [{ col: 3, row: 5 }, { col: 3, row: 6 }]
  ];

  for (const [from, to] of nonexistentRoads) {
    assert.equal(hasLink(from, to, LinkType.ROAD), false, `${Board.posKey(from.col, from.row)} -> ${Board.posKey(to.col, to.row)}`);
    assert.equal(hasLink(to, from, LinkType.ROAD), false, `${Board.posKey(to.col, to.row)} -> ${Board.posKey(from.col, from.row)}`);
  }
});

test('board retains straight headquarters roads and three railway river crossings', () => {
  const headquartersRoads = [
    [{ col: 1, row: 0 }, { col: 1, row: 1 }],
    [{ col: 3, row: 0 }, { col: 3, row: 1 }],
    [{ col: 1, row: 11 }, { col: 1, row: 10 }],
    [{ col: 3, row: 11 }, { col: 3, row: 10 }]
  ];
  const riverRailways = [
    [{ col: 0, row: 5 }, { col: 0, row: 6 }],
    [{ col: 2, row: 5 }, { col: 2, row: 6 }],
    [{ col: 4, row: 5 }, { col: 4, row: 6 }]
  ];

  for (const [from, to] of headquartersRoads) {
    assert.equal(hasLink(from, to, LinkType.ROAD), true, `${Board.posKey(from.col, from.row)} -> ${Board.posKey(to.col, to.row)}`);
  }
  for (const [from, to] of riverRailways) {
    assert.equal(hasLink(from, to, LinkType.RAIL), true, `${Board.posKey(from.col, from.row)} -> ${Board.posKey(to.col, to.row)}`);
  }
});

test('railways run across the rows in front of headquarters, not through headquarters rows', () => {
  const railwayRows = [1, 10];
  const headquartersRows = [0, 11];

  for (const row of railwayRows) {
    for (let col = 0; col < 4; col++) {
      const from = { col, row };
      const to = { col: col + 1, row };
      assert.equal(hasLink(from, to, LinkType.RAIL), true, `${Board.posKey(col, row)} -> ${Board.posKey(col + 1, row)}`);
      assert.equal(hasLink(from, to, LinkType.ROAD), false, `${Board.posKey(col, row)} should not be a road`);
    }
  }

  for (const row of headquartersRows) {
    for (let col = 0; col < 4; col++) {
      const from = { col, row };
      const to = { col: col + 1, row };
      assert.equal(hasLink(from, to, LinkType.ROAD), true, `${Board.posKey(col, row)} -> ${Board.posKey(col + 1, row)}`);
      assert.equal(hasLink(from, to, LinkType.RAIL), false, `${Board.posKey(col, row)} should not be a railway`);
    }
  }
});

test('outer links beside headquarters are roads and the remaining side lines are railways', () => {
  const roadEdges = [
    [{ col: 0, row: 0 }, { col: 0, row: 1 }],
    [{ col: 4, row: 0 }, { col: 4, row: 1 }],
    [{ col: 0, row: 10 }, { col: 0, row: 11 }],
    [{ col: 4, row: 10 }, { col: 4, row: 11 }]
  ];

  for (const [from, to] of roadEdges) {
    assert.equal(hasLink(from, to, LinkType.ROAD), true, `${Board.posKey(from.col, from.row)} -> ${Board.posKey(to.col, to.row)}`);
    assert.equal(hasLink(from, to, LinkType.RAIL), false, `${Board.posKey(from.col, from.row)} should not connect by rail`);
  }

  for (const col of [0, 4]) {
    for (let row = 1; row < 10; row++) {
      assert.equal(
        hasLink({ col, row }, { col, row: row + 1 }, LinkType.RAIL),
        true,
        `${Board.posKey(col, row)} -> ${Board.posKey(col, row + 1)}`
      );
    }
  }
});
