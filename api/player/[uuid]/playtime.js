const { attachLiveCounters, ensurePlayerRecord, nowMs, readState } = require('../../_state');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function getPlayerId(req) {
  const raw = req.query?.uuid;
  return String(Array.isArray(raw) ? raw[0] : raw || '').trim().toLowerCase();
}

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const playerId = getPlayerId(req);
  if (!playerId) {
    return res.status(400).json({ success: false, error: 'Missing player id' });
  }

  const state = await readState();
  const timestamp = nowMs();
  const lookup = state.players?.[playerId] || state.players?.[playerId.toLowerCase()] || null;
  const record = lookup || ensurePlayerRecord(state.players || {}, { uuid: playerId, name: playerId }, timestamp);

  const counters = attachLiveCounters(record, timestamp);

  return res.status(200).json({
    success: true,
    uuid: record.uuid || playerId,
    player: record.name || playerId,
    online: Boolean(record.isOnline),
    lastJoin: Number(record.joinTime || 0),
    counterUpdatedAt: Number(counters.counterUpdatedAt || timestamp),
    isOnline: Boolean(record.isOnline),
    isAFK: Boolean(record.isAFK),
    sessionTime: counters.sessionTime,
    totalPlaytime: counters.totalPlaytime,
  });
};

