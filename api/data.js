const HISTORY_LIMIT = 50;

const defaultSnapshot = {
  cpu: 0,
  ram: 0,
  players: 0,
  playerList: [],
  uptime: 0,
  ip: 'dxir.live',
  status: 'offline',
  time: '--',
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

function normalizePlayerList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((player) => String(player || '').trim())
    .filter(Boolean)
    .slice(0, 32);
}

function normalizePayload(payload = {}) {
  return {
    cpu: normalizeNumber(payload.cpu, defaultSnapshot.cpu),
    ram: normalizeNumber(payload.ram, defaultSnapshot.ram),
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
    playerList: Array.isArray(snapshot.playerList) ? [...snapshot.playerList] : [],
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
  latestSnapshot = snapshot;
  history = [...history, snapshot].slice(-HISTORY_LIMIT);
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
      const snapshot = normalizePayload(body);
      storeSnapshot(snapshot);

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
