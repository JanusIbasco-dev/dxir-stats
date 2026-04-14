const HISTORY_LIMIT = 50;

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

let latestSnapshot = null;
let history = [];

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
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePlayerEntry(value) {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name, ping: 0 } : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const name = String(value.name || value.player || value.username || '').trim();

  if (!name) {
    return null;
  }

  return {
    name,
    ping: normalizeNumber(value.ping ?? value.latency ?? value.ms, 0),
  };
}

function normalizePlayerList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizePlayerEntry)
    .filter(Boolean)
    .slice(0, 32);
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

function cloneSnapshot(snapshot) {
  return {
    ...snapshot,
    playerList: Array.isArray(snapshot.playerList)
      ? snapshot.playerList.map((player) => ({
          name: String(player?.name || '').trim(),
          ping: normalizeNumber(player?.ping, 0),
        })).filter((player) => Boolean(player.name))
      : [],
  };
}

function currentData() {
  const latest = latestSnapshot ? cloneSnapshot(latestSnapshot) : { ...defaultSnapshot };
  return {
    latest,
    history: history.map(cloneSnapshot),
  };
}

function storeSnapshot(snapshot) {
  const stampedSnapshot = {
    ...snapshot,
    lastUpdate: Date.now(),
  };

  latestSnapshot = stampedSnapshot;
  history = [...history, stampedSnapshot].slice(-HISTORY_LIMIT);
}

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      data: currentData(),
    });
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      storeSnapshot(normalizePayload(body));

      return res.status(200).json({
        success: true,
        data: currentData(),
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
