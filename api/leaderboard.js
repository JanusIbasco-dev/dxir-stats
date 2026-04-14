const { LEADERBOARD_LIMIT, normalizeLeaderboardItems, nowMs, readState, withState } = require('./_state');

const API_TO_STORE_KEY = {
  topKills: 'kills',
  richest: 'balance',
  bounty: 'bounty',
  earnings: 'earnings',
  playtime: 'playtime',
};

const HISTORY_KEYS = Object.keys(API_TO_STORE_KEY);

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function cloneState(source) {
  return HISTORY_KEYS.reduce((acc, key) => {
    const storeKey = API_TO_STORE_KEY[key];
    const rows = source?.leaderboards?.[storeKey]?.items;
    acc[key] = Array.isArray(rows) ? rows.map((entry) => ({ ...entry })) : [];
    return acc;
  }, {});
}

function extractRows(body, key) {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const source = body[key];
  if (Array.isArray(source)) {
    return source;
  }

  if (source && typeof source === 'object') {
    return source.items || source.data || source.entries || source.rows || [];
  }

  return [];
}

function toTimestampMap(source) {
  return HISTORY_KEYS.reduce((acc, key) => {
    const storeKey = API_TO_STORE_KEY[key];
    acc[key] = Number(source?.leaderboards?.[storeKey]?.updatedAt || 0);
    return acc;
  }, {});
}

function mergePayload(body = {}, sourceState) {
  const nextState = cloneState(sourceState);

  HISTORY_KEYS.forEach((key) => {
    const rows = extractRows(body, key);
    if (rows.length) {
      nextState[key] = normalizeLeaderboardItems(rows).slice(0, LEADERBOARD_LIMIT);
    }
  });

  return nextState;
}

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    const state = await readState();
    return res.status(200).json({
      ...cloneState(state),
      updatedAt: toTimestampMap(state),
    });
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const hasLeaderboardKeys = HISTORY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key));

      if (!hasLeaderboardKeys) {
        const state = await readState();
        return res.status(200).json({
          ...cloneState(state),
          updatedAt: toTimestampMap(state),
        });
      }

      const timestamp = nowMs();

      const { state } = await withState((draft) => {
        const merged = mergePayload(body, draft);

        HISTORY_KEYS.forEach((key) => {
          const storeKey = API_TO_STORE_KEY[key];
          if (!Array.isArray(merged[key])) {
            return;
          }

          draft.leaderboards[storeKey] = {
            items: merged[key],
            updatedAt: timestamp,
          };
        });
      });

      return res.status(200).json({
        ...cloneState(state),
        updatedAt: toTimestampMap(state),
      });
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid JSON payload',
      });
    }
  }

  res.setHeader('Allow', 'GET,POST,OPTIONS');
  return res.status(405).json({
    error: 'Method not allowed',
  });
};
