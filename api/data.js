const defaultData = {
  cpu: null,
  ram: null,
  players: 0,
  playerList: [],
  uptime: 0,
  ip: 'dxir.live',
  status: 'offline',
  time: '--',
  ready: false,
};

let latestData = null;

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
  const players = Number.parseInt(payload.players, 10);
  const cpu = normalizeNumber(payload.cpu, defaultData.cpu);
  const ram = normalizeNumber(payload.ram, defaultData.ram);
  const uptime = normalizeNumber(payload.uptime, defaultData.uptime);

  return {
    cpu,
    ram,
    players: Number.isFinite(players) && players >= 0 ? players : defaultData.players,
    playerList: normalizePlayerList(payload.playerList),
    uptime,
    ip: typeof payload.ip === 'string' && payload.ip.trim() ? payload.ip.trim() : defaultData.ip,
    status: normalizeStatus(payload.status),
    time: typeof payload.time === 'string' && payload.time.trim() ? payload.time.trim() : defaultData.time,
    ready: true,
  };
}

function currentData() {
  return latestData ? { ...latestData } : { ...defaultData };
}

module.exports = async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json(currentData());
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      latestData = normalizePayload(body);

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



