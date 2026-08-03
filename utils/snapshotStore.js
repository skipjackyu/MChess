const MAX_SNAPSHOTS = 10;

function normalizeSnapshots(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(snapshot => (
    snapshot &&
    snapshot.version === 1 &&
    snapshot.initialBoard &&
    Array.isArray(snapshot.actions)
  )).slice(0, MAX_SNAPSHOTS);
}

function appendSnapshot(snapshots, snapshot) {
  if (!snapshot) return normalizeSnapshots(snapshots);
  return [snapshot, ...normalizeSnapshots(snapshots)].slice(0, MAX_SNAPSHOTS);
}

module.exports = {
  MAX_SNAPSHOTS,
  normalizeSnapshots,
  appendSnapshot
};
