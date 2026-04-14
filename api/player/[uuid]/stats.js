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
  const record = state.players?.[playerId] || ensurePlayerRecord(state.players || {}, { uuid: playerId, name: playerId }, timestamp);
  const counters = attachLiveCounters(record, timestamp);

  return res.status(200).json({
    success: true,
    uuid: record.uuid || playerId,
    player: record.name || playerId,
    total: counters.totalPlaytime,
    daily: counters.dailyPlaytime,
    weekly: counters.weeklyPlaytime,
    sessionTime: counters.sessionTime,
    isAFK: Boolean(record.isAFK),
    isOnline: Boolean(record.isOnline),
    lastActive: Number(record.lastActive || 0),
  });
};

