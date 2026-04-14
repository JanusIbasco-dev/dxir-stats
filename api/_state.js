const STORE_KEY = 'dxir:stats:state:v2';
const HISTORY_LIMIT = 100;
const LEADERBOARD_LIMIT = 10;
const AFK_TIMEOUT_MS = 5 * 60 * 1000;

const memory = {
  state: null,
};

function nowMs() {
  return Date.now();
}

function getDayKey(timestamp) {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekKey(timestamp) {
  const date = new Date(timestamp);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date - firstThursday) / 604800000);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createEmptyState() {
  return {
    latestSnapshot: null,
    history: [],
    players: {},
    uuidDirectory: {},
    leaderboards: {
      kills: { items: [], updatedAt: 0 },
      balance: { items: [], updatedAt: 0 },
      bounty: { items: [], updatedAt: 0 },
      earnings: { items: [], updatedAt: 0 },
      playtime: { items: [], updatedAt: 0 },
    },
    updatedAt: 0,
  };
}

function parseState(value) {
  if (!value || typeof value !== 'object') {
    return createEmptyState();
  }

  const base = createEmptyState();
  const safe = {
    ...base,
    ...value,
    players: value.players && typeof value.players === 'object' ? value.players : {},
    uuidDirectory: value.uuidDirectory && typeof value.uuidDirectory === 'object' ? value.uuidDirectory : {},
    history: Array.isArray(value.history) ? value.history : [],
    leaderboards: {
      ...base.leaderboards,
      ...(value.leaderboards && typeof value.leaderboards === 'object' ? value.leaderboards : {}),
    },
  };

  safe.history = safe.history.slice(-HISTORY_LIMIT);
  return safe;
}

async function getKvValue() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return null;
  }

  const response = await fetch(`${url}/get/${encodeURIComponent(STORE_KEY)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`KV GET failed with ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || payload.result == null) {
    return null;
  }

  try {
    return JSON.parse(payload.result);
  } catch (error) {
    return null;
  }
}

async function setKvValue(value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return;
  }

  const response = await fetch(`${url}/set/${encodeURIComponent(STORE_KEY)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });

  if (!response.ok) {
    throw new Error(`KV SET failed with ${response.status}`);
  }
}

async function readState() {
  if (memory.state) {
    return memory.state;
  }

  try {
    const fromKv = await getKvValue();
    memory.state = parseState(fromKv);
  } catch (error) {
    memory.state = createEmptyState();
  }

  return memory.state;
}

async function writeState(nextState) {
  const state = parseState(nextState);
  state.updatedAt = nowMs();
  memory.state = state;

  try {
    await setKvValue(state);
  } catch (error) {
    // Keep in-memory state even when persistent storage is unavailable.
  }

  return state;
}

async function withState(mutator) {
  const current = await readState();
  const draft = parseState(current);
  const result = await mutator(draft);
  const saved = await writeState(draft);
  return { state: saved, result };
}

function normalizePlayerId(player) {
  const uuid = String(player?.uuid || '').trim();
  const name = String(player?.name || player?.username || '').trim();
  return uuid || name.toLowerCase();
}

function ensurePlayerRecord(players, player, timestamp) {
  const id = normalizePlayerId(player);

  if (!id) {
    return null;
  }

  const existing = players[id] && typeof players[id] === 'object' ? players[id] : {};
  const dayKey = getDayKey(timestamp);
  const weekKey = getWeekKey(timestamp);

  const record = {
    id,
    uuid: String(player?.uuid || existing.uuid || '').trim(),
    name: String(player?.name || player?.username || existing.name || '').trim(),
    ping: toFiniteNumber(player?.ping, toFiniteNumber(existing.ping, 0)),
    isOnline: Boolean(existing.isOnline),
    isAFK: Boolean(existing.isAFK),
    joinTime: toFiniteNumber(existing.joinTime, 0),
    lastSeen: toFiniteNumber(existing.lastSeen, 0),
    lastActive: toFiniteNumber(existing.lastActive, timestamp),
    lastCalcAt: toFiniteNumber(existing.lastCalcAt, timestamp),
    sessionActiveSeconds: toFiniteNumber(existing.sessionActiveSeconds, 0),
    totalPlaytime: toFiniteNumber(existing.totalPlaytime, 0),
    dailyPlaytime: toFiniteNumber(existing.dailyPlaytime, 0),
    weeklyPlaytime: toFiniteNumber(existing.weeklyPlaytime, 0),
    dayKey: String(existing.dayKey || dayKey),
    weekKey: String(existing.weekKey || weekKey),
    updatedAt: toFiniteNumber(existing.updatedAt, timestamp),
  };

  if (!record.name) {
    record.name = record.uuid || id;
  }

  if (record.dayKey !== dayKey) {
    record.dailyPlaytime = 0;
    record.dayKey = dayKey;
  }

  if (record.weekKey !== weekKey) {
    record.weeklyPlaytime = 0;
    record.weekKey = weekKey;
  }

  players[id] = record;
  return record;
}

function applyActiveDelta(record, timestamp) {
  if (!record.isOnline || record.isAFK || record.lastCalcAt <= 0) {
    record.lastCalcAt = timestamp;
    return 0;
  }

  const deltaSeconds = Math.max(0, (timestamp - record.lastCalcAt) / 1000);

  if (deltaSeconds > 0) {
    record.sessionActiveSeconds += deltaSeconds;
    record.dailyPlaytime += deltaSeconds;
    record.weeklyPlaytime += deltaSeconds;
  }

  record.lastCalcAt = timestamp;
  return deltaSeconds;
}

function attachLiveCounters(record, timestamp) {
  const extraSeconds =
    record.isOnline && !record.isAFK && record.lastCalcAt > 0
      ? Math.max(0, (timestamp - record.lastCalcAt) / 1000)
      : 0;

  const sessionTime = Math.floor(record.sessionActiveSeconds + extraSeconds);
  const totalPlaytime = Math.floor(record.totalPlaytime + sessionTime);
  const dailyPlaytime = Math.floor(record.dailyPlaytime + extraSeconds);
  const weeklyPlaytime = Math.floor(record.weeklyPlaytime + extraSeconds);

  return {
    sessionTime,
    totalPlaytime,
    dailyPlaytime,
    weeklyPlaytime,
  };
}

function normalizeLeaderboardItem(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const username = String(entry.username || entry.name || entry.player || '').trim();
  const uuid = String(entry.uuid || entry.id || '').trim();
  const value = toFiniteNumber(entry.value ?? entry.score ?? entry.amount ?? entry.balance ?? entry.kills ?? entry.earnings, NaN);

  if (!username || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return {
    username,
    uuid,
    value,
  };
}

function normalizeLeaderboardItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(normalizeLeaderboardItem)
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
    .slice(0, LEADERBOARD_LIMIT);
}

module.exports = {
  AFK_TIMEOUT_MS,
  HISTORY_LIMIT,
  LEADERBOARD_LIMIT,
  createEmptyState,
  readState,
  writeState,
  withState,
  toFiniteNumber,
  nowMs,
  getDayKey,
  getWeekKey,
  normalizePlayerId,
  ensurePlayerRecord,
  applyActiveDelta,
  attachLiveCounters,
  normalizeLeaderboardItems,
};

