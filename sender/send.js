const os = require('os');
const axios = require('axios');
const systeminformation = require('systeminformation');
const { status: minecraftStatus } = require('minecraft-server-util');

const rawBaseUrl = process.env.DXIR_STATS_URL || process.env.DXIR_STATS_ENDPOINT || process.env.VERCEL_URL || process.argv[2] || 'https://stats.dxir.live';
const endpoint = normalizeEndpoint(rawBaseUrl);


let sending = false;

function normalizeBaseUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/$/, '');

  if (!trimmed) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function normalizeEndpoint(value) {
  const normalized = normalizeBaseUrl(value);

  if (normalized.toLowerCase().endsWith('/api/data')) {
    return normalized;
  }

  return `${normalized}/api/data`;
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function getCpuUsage() {
  const load = await systeminformation.currentLoad();
  return `${Math.round(load.currentLoad)}%`;
}

async function getRamUsage() {
  const memory = await systeminformation.mem();
  const totalMb = memory.total / 1024 / 1024;
  const usedMb = memory.active / 1024 / 1024;

  if (totalMb >= 1024) {
    return `${(usedMb / 1024).toFixed(1)} GB / ${(totalMb / 1024).toFixed(1)} GB`;
  }

  return `${Math.round(usedMb)} MB / ${Math.round(totalMb)} MB`;
}

async function getMinecraftStatus() {
  try {
    const result = await minecraftStatus('127.0.0.1', 25565, {
      timeout: 2500,
    });

    return {
      players: Number(result?.players?.online ?? 0),
      status: 'online',
    };
  } catch (error) {
    return {
      players: 0,
      status: 'offline',
    };
  }
}

async function buildPayload() {
  const [cpu, ram, minecraft] = await Promise.all([
    getCpuUsage(),
    getRamUsage(),
    getMinecraftStatus(),
  ]);

  return {
    cpu,
    ram,
    players: minecraft.players,
    status: minecraft.status,
    time: formatTimestamp(),
    host: os.hostname(),
  };
}

async function sendOnce() {
  if (sending) {
    return;
  }

  sending = true;

  try {
    const payload = await buildPayload();
    const response = await axios.post(endpoint, payload, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`[DXIR STATS] ${payload.status.toUpperCase()} | CPU ${payload.cpu} | RAM ${payload.ram} | Players ${payload.players} | ${response.status}`);
  } catch (error) {
    const message = error?.response
      ? `HTTP ${error.response.status}`
      : error?.message || 'Unknown error';

    console.error(`[DXIR STATS] Failed to send update: ${message}`);
  } finally {
    sending = false;
  }
}

async function main() {
  console.log(`[DXIR STATS] Sending to ${endpoint}`);
  await sendOnce();
  setInterval(sendOnce, 2000);
}

main().catch((error) => {
  console.error('[DXIR STATS] Fatal error:', error);
  process.exit(1);
});




