const { applyActiveDelta, ensurePlayerRecord, nowMs, withState } = require('../../_state');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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

  const playerId = getPlayerId(req);
  if (!playerId) {
    return res.status(400).json({ success: false, error: 'Missing player id' });
  }

  if (req.method === 'GET') {
    const { state } = await withState((draft) => {
      const ts = nowMs();
      const record = draft.players?.[playerId] || ensurePlayerRecord(draft.players, { uuid: playerId, name: playerId }, ts);
      if (record) {
        record.updatedAt = ts;
      }
    });

    const record = state.players?.[playerId];
    return res.status(200).json({
      success: true,
      uuid: record?.uuid || playerId,
      player: record?.name || playerId,
      lastActive: Number(record?.lastActive || 0),
      isAFK: Boolean(record?.isAFK),
      isOnline: Boolean(record?.isOnline),
    });
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const ts = nowMs();

      const { state } = await withState((draft) => {
        const record = draft.players?.[playerId] || ensurePlayerRecord(draft.players, {
          uuid: body.uuid || playerId,
          name: body.name || body.username || playerId,
        }, ts);

        if (!record) {
          return;
        }

        if (!record.isOnline) {
          record.isOnline = true;
          record.joinTime = ts;
          record.sessionActiveSeconds = 0;
        }

        applyActiveDelta(record, ts);
        record.lastActive = Number(body.lastActive || ts);
        record.lastSeen = ts;
        record.lastCalcAt = ts;
        record.isAFK = false;
        record.updatedAt = ts;
      });

      const record = state.players?.[playerId];
      return res.status(200).json({
        success: true,
        uuid: record?.uuid || playerId,
        player: record?.name || playerId,
        lastActive: Number(record?.lastActive || ts),
        isAFK: Boolean(record?.isAFK),
        isOnline: Boolean(record?.isOnline),
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
    }
  }

  res.setHeader('Allow', 'GET,POST,OPTIONS');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
};

