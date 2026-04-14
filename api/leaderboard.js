const HISTORY_KEYS = ['topKills', 'richest', 'bounty', 'earnings'];
const MAX_ENTRIES = 10;

const leaderboardState = {
  topKills: [],
  richest: [],
  bounty: [],
  earnings: [],
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function normalizeName(value) {
  return String(value || '').trim();
}

function normalizeValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const name = normalizeName(entry.name || entry.player || entry.username);

  if (!name) {
    return null;
  }

  return {
    name,
    value: normalizeValue(entry.value ?? entry.score ?? entry.amount ?? entry.balance ?? entry.kills ?? entry.points),
  };
}

function normalizeCategory(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_ENTRIES);
}

function cloneState() {
  return HISTORY_KEYS.reduce((acc, key) => {
    acc[key] = leaderboardState[key].map((entry) => ({ ...entry }));
    return acc;
  }, {});
}

function mergePayload(body = {}) {
  const nextState = cloneState();

  HISTORY_KEYS.forEach((key) => {
    if (Array.isArray(body[key])) {
      nextState[key] = normalizeCategory(body[key]);
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
    return res.status(200).json(cloneState());
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const hasLeaderboardKeys = HISTORY_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key));

      if (hasLeaderboardKeys) {
        const merged = mergePayload(body);
        HISTORY_KEYS.forEach((key) => {
          leaderboardState[key] = merged[key];
        });
      }

      return res.status(200).json(cloneState());
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
