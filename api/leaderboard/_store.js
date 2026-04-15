const {
  LEADERBOARD_LIMIT,
  normalizeLeaderboardItems,
  nowMs,
  readState,
  withState,
  getCachedIdentity,
  normalizeUuid,
  buildAvatarUrl,
} = require('../_state');
const { publishRealtimeEvent } = require('../_realtime');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function extractItems(input) {
  if (Array.isArray(input)) {
    return input;
  }

  if (input && typeof input === 'object') {
    return input.items || input.data || input.entries || input.rows || [];
  }

  return [];
}

function createCategoryHandler(categoryKey) {
  function cloneRows(rows) {
    return rows.map((entry) => {
      const username = String(entry?.username || '').trim();
      const cached = getCachedIdentity(memoryState, username);
      const uuid = normalizeUuid(entry?.uuid) || normalizeUuid(cached?.uuid);
      return {
        ...entry,
        uuid,
        avatarUrl: buildAvatarUrl(uuid, 64),
      };
    });
  }

  let memoryState = null;

  return async (req, res) => {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method === 'GET') {
      const state = await readState();
      memoryState = state;
      const category = state.leaderboards?.[categoryKey] || { items: [], updatedAt: 0 };
      res.setHeader('X-Updated-At', String(Number(category.updatedAt || 0)));
      return res.status(200).json(cloneRows(Array.isArray(category.items) ? category.items : []));
    }

    if (req.method === 'POST') {
      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '[]') : (req.body ?? []);
        const nextRows = normalizeLeaderboardItems(extractItems(body)).slice(0, LEADERBOARD_LIMIT);
        const timestamp = nowMs();

        const { state } = await withState((draft) => {
          if (!draft.leaderboards || typeof draft.leaderboards !== 'object') {
            draft.leaderboards = {};
          }

          draft.leaderboards[categoryKey] = {
            items: nextRows,
            updatedAt: timestamp,
          };
        });

        memoryState = state;
        const category = state.leaderboards?.[categoryKey] || { items: [], updatedAt: timestamp };
        await publishRealtimeEvent('leaderboard_update', {
          category: categoryKey,
          updatedAt: Number(category.updatedAt || timestamp),
          items: cloneRows(Array.isArray(category.items) ? category.items : []),
        });

        res.setHeader('X-Updated-At', String(Number(category.updatedAt || timestamp)));
        return res.status(200).json(cloneRows(Array.isArray(category.items) ? category.items : []));
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
}

module.exports = {
  createCategoryHandler,
  setCorsHeaders,
};

