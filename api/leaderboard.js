const {
  LEADERBOARD_LIMIT,
  normalizeLeaderboardItems,
  nowMs,
  readState,
  withState,
  getCachedIdentity,
  normalizeUuid,
  buildAvatarUrl,
} = require('./_state');
const { publishRealtimeEvent } = require('./_realtime');

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

function hydrateRows(sourceState, rows) {
  return rows.map((entry) => {
    const username = String(entry?.username || '').trim();
    const cached = getCachedIdentity(sourceState, username);
    const uuid = normalizeUuid(entry?.uuid) || normalizeUuid(cached?.uuid);
    return {
      ...entry,
      uuid,
      avatarUrl:
        (typeof entry?.avatarUrl === 'string' && entry.avatarUrl.trim())
        || (typeof cached?.avatarUrl === 'string' && cached.avatarUrl.trim())
        || buildAvatarUrl(uuid, 64),
    };
  });
}

function cloneState(source) {
  return HISTORY_KEYS.reduce((acc, key) => {
    const storeKey = API_TO_STORE_KEY[key];
    const rows = source?.leaderboards?.[storeKey]?.items;
    acc[key] = Array.isArray(rows) ? hydrateRows(source, rows) : [];
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

      const responsePayload = {
        ...cloneState(state),
        updatedAt: toTimestampMap(state),
      };

      await Promise.all(
        HISTORY_KEYS
          .filter((key) => Object.prototype.hasOwnProperty.call(body, key))
          .map((key) => publishRealtimeEvent('leaderboard_update', {
            category: API_TO_STORE_KEY[key],
            updatedAt: Number(responsePayload.updatedAt?.[key] || timestamp),
            items: Array.isArray(responsePayload[key]) ? responsePayload[key] : [],
          }))
      );

      return res.status(200).json(responsePayload);
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
