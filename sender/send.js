const axios = require('axios');
const systeminformation = require('systeminformation');
const { status: minecraftStatus } = require('minecraft-server-util');

const DEFAULT_IP = 'dxir.live';
const startedAt = Date.now();
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
    second: '2-digit',
  });
}

async function getCpuUsage() {
  const load = await systeminformation.currentLoad();
  return Math.round(load.currentLoad * 10) / 10;
}

async function getJavaProcessRamUsage() {
  try {
    const processes = await systeminformation.processes();
    const candidates = Array.isArray(processes?.list) ? processes.list : [];

    const javaProcess = candidates
      .filter((processInfo) => {
        const name = String(processInfo?.name || '').toLowerCase();
        const command = String(processInfo?.command || processInfo?.cmd || processInfo?.path || '').toLowerCase();

        return name.includes('java') || command.includes('java');
      })
      .sort((a, b) => Number(b?.memRss || 0) - Number(a?.memRss || 0))[0];

    const memoryBytes = Number(javaProcess?.memRss || javaProcess?.mem || 0);

    if (!Number.isFinite(memoryBytes) || memoryBytes <= 0) {
      return 0;
    }

    return Math.round(memoryBytes / 1024 / 1024);
  } catch (error) {
    return 0;
  }
}

async function getMinecraftStatus() {
  try {
    const result = await minecraftStatus('127.0.0.1', 25565, {
      timeout: 2500,
    });

    const sample = Array.isArray(result?.players?.sample) ? result.players.sample : [];

    return {
      players: Number(result?.players?.online ?? 0),
      playerList: sample
        .map((player) => String(player?.name || '').trim())
        .filter(Boolean),
      status: 'online',
    };
  } catch (error) {
    return {
      players: 0,
      playerList: [],
      status: 'offline',
    };
  }
}

async function buildPayload() {
  const [cpu, ram, minecraft] = await Promise.all([
    getCpuUsage(),
    getJavaProcessRamUsage(),
    getMinecraftStatus(),
  ]);

  return {
    cpu,
    ram,
    players: minecraft.players,
    playerList: minecraft.playerList,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    ip: DEFAULT_IP,
    status: minecraft.status,
    time: formatTimestamp(),
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

    console.log(`[DXIR STATS] ${payload.status.toUpperCase()} | CPU ${payload.cpu}% | RAM ${payload.ram} MB | Players ${payload.players} | Uptime ${payload.uptime}s | ${response.status}`);
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




