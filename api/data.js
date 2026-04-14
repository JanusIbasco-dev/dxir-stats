const defaultData = {
  cpu: '--',
  ram: '--',
  players: 0,
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

function normalizePayload(payload = {}) {
  const players = Number.parseInt(payload.players, 10);

  return {
    cpu: typeof payload.cpu === 'string' && payload.cpu.trim() ? payload.cpu.trim() : defaultData.cpu,
    ram: typeof payload.ram === 'string' && payload.ram.trim() ? payload.ram.trim() : defaultData.ram,
    players: Number.isFinite(players) && players >= 0 ? players : defaultData.players,
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


