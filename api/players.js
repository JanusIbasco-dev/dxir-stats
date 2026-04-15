const {
  attachLiveCounters,
  normalizePlayerId,
  nowMs,
  readState,
} = require('./_state');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function enrichPlayers(players, playerRecords, timestamp) {
  return (Array.isArray(players) ? players : []).map((player) => {
    const id = normalizePlayerId(player);
    const record = id ? playerRecords?.[id] : null;

    if (!record) {
      return player;
    }

    const counters = attachLiveCounters(record, timestamp);

    return {
      ...player,
      username: String(record.name || player.name || player.username || ''),
      uuid: String(record.uuid || player.uuid || ''),
      online: Boolean(record.isOnline),
      lastJoin: Number(record.joinTime || 0),
      counterUpdatedAt: Number(counters.counterUpdatedAt || timestamp),
      status: record.isOnline ? 'online' : 'offline',
      isAFK: Boolean(record.isAFK),
      sessionTime: counters.sessionTime,
      totalPlaytime: counters.totalPlaytime,
      dailyPlaytime: counters.dailyPlaytime,
      weeklyPlaytime: counters.weeklyPlaytime,
      ping: Number(record.ping || player.ping || 0),
    };
  });
}

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  const state = await readState();
  const timestamp = nowMs();
  const latest = state.latestSnapshot || null;

  const items = latest
    ? enrichPlayers(latest.playerList || [], state.players || {}, timestamp)
      .filter((player) => String(player?.status || '').toLowerCase() !== 'offline')
    : [];

  return res.status(200).json({
    success: true,
    lastUpdate: Number(latest?.lastUpdate || 0),
    items,
  });
};


