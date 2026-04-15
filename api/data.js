const {
  AFK_TIMEOUT_MS,
  HISTORY_LIMIT,
  applyActiveDelta,
  attachLiveCounters,
  ensurePlayerRecord,
  normalizePlayerId,
  nowMs,
  readState,
  getCachedIdentity,
  setCachedIdentity,
  buildAvatarUrl,
  normalizeUuid,
  toFiniteNumber,
  withState,
} = require('./_state');
const { publishRealtimeEvent } = require('./_realtime');

const MOJANG_PROFILE_URL = 'https://api.mojang.com/users/profiles/minecraft/';
const mojangRequestCache = new Map();

const defaultSnapshot = {
  cpu: 0,
  ram: 0,
  ramUsed: 0,
  ramMax: 0,
  players: 0,
  playerList: [],
  uptime: 0,
  ip: 'dxir.live',
  status: 'offline',
  time: '--',
  lastUpdate: 0,
  ready: false,
};

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function normalizeStatus(value) {
  return String(value || 'offline').trim().toLowerCase() === 'online' ? 'online' : 'offline';
}

function normalizeNumber(value, fallback = 0) {
  const parsed = toFiniteNumber(value, fallback);
  return parsed >= 0 ? parsed : fallback;
}

async function resolveUuidFromMojang(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) {
    return '';
  }

  if (mojangRequestCache.has(key)) {
    return mojangRequestCache.get(key);
  }

  const pending = (async () => {
    const response = await fetch(`${MOJANG_PROFILE_URL}${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return '';
    }

    const payload = await response.json();
    return normalizeUuid(payload?.id);
  })()
    .catch(() => '')
    .finally(() => {
      mojangRequestCache.delete(key);
    });

  mojangRequestCache.set(key, pending);

  try {
    return await pending;
  } catch (error) {
    return '';
  }
}

function normalizePlayerEntry(value) {
  if (typeof value === 'string') {
    const name = value.trim();
    if (!name) {
      return null;
    }

    return { name, uuid: '', ping: 0, status: 'online' };
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = String(value.name || value.player || value.username || '').trim();
  const uuid = normalizeUuid(value.uuid || value.id || value.playerUuid);

  if (!name) {
    return null;
  }

  return {
    name,
    uuid,
    ping: normalizeNumber(value.ping ?? value.latency ?? value.ms, 0),
    status: String(value.status || 'online').trim() || 'online',
    lastActive: normalizeNumber(value.lastActive ?? value.activityAt, 0),
    active: Boolean(value.active),
  };
}

function normalizePlayerList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizePlayerEntry).filter(Boolean).slice(0, 32);
}

function normalizePayload(payload = {}) {
  const ramUsed = normalizeNumber(payload.ramUsed, defaultSnapshot.ramUsed);

  return {
    cpu: normalizeNumber(payload.cpu, defaultSnapshot.cpu),
    ram: normalizeNumber(payload.ram, Math.round(ramUsed * 1024)),
    ramUsed,
    ramMax: normalizeNumber(payload.ramMax, defaultSnapshot.ramMax),
    players: normalizeNumber(payload.players, defaultSnapshot.players),
    playerList: normalizePlayerList(payload.playerList),
    uptime: normalizeNumber(payload.uptime, defaultSnapshot.uptime),
    ip: typeof payload.ip === 'string' && payload.ip.trim() ? payload.ip.trim() : defaultSnapshot.ip,
    status: normalizeStatus(payload.status),
    time: typeof payload.time === 'string' && payload.time.trim() ? payload.time.trim() : defaultSnapshot.time,
    ready: true,
  };
}

async function resolvePlayersWithMojangUuid(players, sharedState) {
  if (!Array.isArray(players) || !players.length) {
    return [];
  }

  const resolvedPlayers = await Promise.all(players.map(async (player) => {
    const name = String(player?.name || '').trim();
    if (!name) {
      return player;
    }

    const cachedIdentity = getCachedIdentity(sharedState, name);
    const cachedUuid = normalizeUuid(cachedIdentity?.uuid);

    let mojangUuid = cachedUuid;
    if (!mojangUuid) {
      mojangUuid = await resolveUuidFromMojang(name);
      if (mojangUuid) {
        setCachedIdentity(sharedState, name, mojangUuid);
      }
    }

    const fallbackUuid = normalizeUuid(player.uuid);
    const finalUuid = mojangUuid || fallbackUuid;
    const avatarUrl = finalUuid
      ? buildAvatarUrl(finalUuid, 64)
      : (typeof cachedIdentity?.avatarUrl === 'string' ? cachedIdentity.avatarUrl : '');

    // Debug mapping to verify live UUID source.
    console.log(`[DXIR UUID] ${name} => ${finalUuid || 'missing'}`);

    return {
      ...player,
      uuid: finalUuid,
      avatarUrl,
    };
  }));

  return resolvedPlayers;
}

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    playerList: Array.isArray(snapshot.playerList)
      ? snapshot.playerList.map((player) => ({
          name: String(player?.name || '').trim(),
          uuid: String(player?.uuid || player?.id || '').trim(),
          avatarUrl: String(player?.avatarUrl || buildAvatarUrl(player?.uuid, 64) || '').trim(),
          ping: normalizeNumber(player?.ping, 0),
          status: String(player?.status || 'online').trim() || 'online',
          isAFK: Boolean(player?.isAFK),
          sessionTime: normalizeNumber(player?.sessionTime, 0),
          totalPlaytime: normalizeNumber(player?.totalPlaytime, 0),
          dailyPlaytime: normalizeNumber(player?.dailyPlaytime, 0),
          weeklyPlaytime: normalizeNumber(player?.weeklyPlaytime, 0),
        })).filter((player) => Boolean(player.name))
      : [],
  };
}

function enrichPlayersWithStats(players, records, timestamp) {
  return players.map((player) => {
    const id = normalizePlayerId(player);
    const record = id ? records[id] : null;

    if (!record) {
      return {
        ...player,
        isAFK: false,
        sessionTime: 0,
        totalPlaytime: 0,
        dailyPlaytime: 0,
        weeklyPlaytime: 0,
      };
    }

    const counters = attachLiveCounters(record, timestamp);
    return {
      ...player,
      isAFK: Boolean(record.isAFK),
      sessionTime: counters.sessionTime,
      totalPlaytime: counters.totalPlaytime,
      dailyPlaytime: counters.dailyPlaytime,
      weeklyPlaytime: counters.weeklyPlaytime,
    };
  });
}

async function currentData() {
  const state = await readState();
  const timestamp = nowMs();
  const latest = state.latestSnapshot
    ? cloneSnapshot({
        ...state.latestSnapshot,
        playerList: enrichPlayersWithStats(state.latestSnapshot.playerList || [], state.players || {}, timestamp),
      })
    : { ...defaultSnapshot };

  return {
    latest,
    history: Array.isArray(state.history) ? state.history.map(cloneSnapshot) : [],
  };
}

function markOfflinePlayers(playersState, onlineIds, timestamp) {
  Object.values(playersState).forEach((record) => {
    if (!record || !record.id) {
      return;
    }

    if (!onlineIds.has(record.id) && record.isOnline) {
      applyActiveDelta(record, timestamp);
      record.totalPlaytime += record.sessionActiveSeconds;
      record.sessionActiveSeconds = 0;
      record.isOnline = false;
      record.isAFK = false;
      record.joinTime = 0;
      record.lastCalcAt = 0;
      record.ping = 0;
      record.updatedAt = timestamp;
    }
  });
}

function updatePlayerRecords(playersState, players, timestamp) {
  const onlineIds = new Set();

  players.forEach((player) => {
    const record = ensurePlayerRecord(playersState, player, timestamp);

    if (!record) {
      return;
    }

    const id = record.id;
    onlineIds.add(id);

    if (!record.isOnline) {
      record.isOnline = true;
      record.isAFK = false;
      record.joinTime = timestamp;
      record.sessionActiveSeconds = 0;
      record.lastCalcAt = timestamp;
      record.lastActive = player.lastActive > 0 ? player.lastActive : timestamp;
    } else {
      applyActiveDelta(record, timestamp);
    }

    const signaledActivity = player.active || player.lastActive > 0;
    if (signaledActivity) {
      record.lastActive = player.lastActive > 0 ? player.lastActive : timestamp;
      record.isAFK = false;
      record.lastCalcAt = timestamp;
    }

    if (timestamp - record.lastActive >= AFK_TIMEOUT_MS) {
      record.isAFK = true;
    }

    record.uuid = player.uuid || record.uuid;
    record.name = player.name || record.name;
    record.avatarUrl = player.avatarUrl || record.avatarUrl || buildAvatarUrl(player.uuid, 64);
    record.ping = normalizeNumber(player.ping, 0);
    record.lastSeen = timestamp;
    record.updatedAt = timestamp;
  });

  markOfflinePlayers(playersState, onlineIds, timestamp);

  return players.map((player) => {
    const record = playersState[normalizePlayerId(player)];
    if (!record) {
      return player;
    }

    const counters = attachLiveCounters(record, timestamp);
    return {
      ...player,
        avatarUrl: record.avatarUrl || player.avatarUrl || buildAvatarUrl(record.uuid, 64),
      status: record.isOnline ? 'online' : 'offline',
      isAFK: Boolean(record.isAFK),
      sessionTime: counters.sessionTime,
      totalPlaytime: counters.totalPlaytime,
      dailyPlaytime: counters.dailyPlaytime,
      weeklyPlaytime: counters.weeklyPlaytime,
    };
  });
}

async function storeSnapshot(snapshot) {
  const { result } = await withState(async (state) => {
    const timestamp = nowMs();
    const previousPlayers = Array.isArray(state.latestSnapshot?.playerList) ? state.latestSnapshot.playerList : [];
    const previousOnline = new Map(previousPlayers.map((player) => [normalizePlayerId(player), player]));
    const resolvedPlayerList = await resolvePlayersWithMojangUuid(snapshot.playerList || [], state);
    const updatedPlayers = updatePlayerRecords(state.players, resolvedPlayerList, timestamp);
    const stampedSnapshot = {
      ...snapshot,
      playerList: updatedPlayers,
      lastUpdate: timestamp,
    };

    state.latestSnapshot = stampedSnapshot;
    state.history = [...(Array.isArray(state.history) ? state.history : []), stampedSnapshot].slice(-HISTORY_LIMIT);

    const currentOnline = new Map(
      updatedPlayers
        .filter((player) => String(player.status || '').toLowerCase() !== 'offline')
        .map((player) => [normalizePlayerId(player), player])
    );

    const joinedPlayers = [];
    const leftPlayers = [];

    currentOnline.forEach((player, id) => {
      if (!previousOnline.has(id)) {
        joinedPlayers.push(player);
      }
    });

    previousOnline.forEach((player, id) => {
      if (!currentOnline.has(id)) {
        leftPlayers.push(player);
      }
    });

    const playtimeRows = Object.values(state.players || {})
      .map((record) => {
        if (!record || !record.id) {
          return null;
        }

        const counters = attachLiveCounters(record, timestamp);
        return {
          username: record.name || record.uuid || record.id,
          uuid: record.uuid || '',
          value: counters.totalPlaytime,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    if (!state.leaderboards || typeof state.leaderboards !== 'object') {
      state.leaderboards = {};
    }

    state.leaderboards.playtime = {
      items: playtimeRows,
      updatedAt: timestamp,
    };

    return {
      snapshot: stampedSnapshot,
      joinedPlayers,
      leftPlayers,
      playtimeRows,
      timestamp,
    };
  });

  if (!result) {
    return;
  }

  await publishRealtimeEvent('stats_update', {
    latest: result.snapshot,
  });

  await publishRealtimeEvent('leaderboard_update', {
    category: 'playtime',
    updatedAt: result.timestamp,
    items: result.playtimeRows,
  });

  for (const player of result.joinedPlayers) {
    await publishRealtimeEvent('player_join', {
      uuid: player.uuid || '',
      username: player.name || '',
      playtime: Number(player.totalPlaytime || 0),
      ping: Number(player.ping || 0),
      isAFK: Boolean(player.isAFK),
      status: 'online',
      avatarUrl: player.avatarUrl || buildAvatarUrl(player.uuid, 64),
    });
  }

  for (const player of result.leftPlayers) {
    await publishRealtimeEvent('player_leave', {
      uuid: player.uuid || '',
      username: player.name || '',
      status: 'offline',
      avatarUrl: player.avatarUrl || buildAvatarUrl(player.uuid, 64),
    });
  }

  for (const player of result.snapshot.playerList || []) {
    await publishRealtimeEvent('player_update', {
      uuid: player.uuid || '',
      username: player.name || '',
      playtime: Number(player.totalPlaytime || 0),
      ping: Number(player.ping || 0),
      isAFK: Boolean(player.isAFK),
      status: String(player.status || 'online').toLowerCase(),
      avatarUrl: player.avatarUrl || buildAvatarUrl(player.uuid, 64),
      sessionTime: Number(player.sessionTime || 0),
      dailyPlaytime: Number(player.dailyPlaytime || 0),
      weeklyPlaytime: Number(player.weeklyPlaytime || 0),
      lastUpdate: Number(result.snapshot.lastUpdate || result.timestamp),
    });
  }
}

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    const data = await currentData();
    return res.status(200).json({
      success: true,
      data,
    });
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const normalizedPayload = normalizePayload(body);
      await storeSnapshot(normalizedPayload);
      const data = await currentData();

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON payload',
      });
    }
  }

  res.setHeader('Allow', 'GET,POST,OPTIONS');
  return res.status(405).json({
    success: false,
    error: 'Method not allowed',
  });
};
