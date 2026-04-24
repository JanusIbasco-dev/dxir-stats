const axios = require('axios');
const systeminformation = require('systeminformation');
const pidusage = require('pidusage');
const { status: minecraftStatus } = require('minecraft-server-util');

const DEFAULT_IP = 'dxir.live';
const startedAt = Date.now();
const rawBaseUrl = process.env.DXIR_STATS_URL || process.env.DXIR_STATS_ENDPOINT || process.env.VERCEL_URL || process.argv[2] || 'https://stats.dxir.live';
const endpoint = normalizeEndpoint(rawBaseUrl);

const GIGABYTE = 1024 * 1024 * 1024;
const MEGABYTE = 1024 * 1024;

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

function roundTo2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toGbFromBytes(bytes) {
  return roundTo2(Number(bytes || 0) / GIGABYTE);
}

function parseXmxGb(command) {
  const cmd = String(command || '');
  const match = cmd.match(/-Xmx\s*(\d+)([MG])/i);

  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  const unit = String(match[2] || '').toUpperCase();

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (unit === 'G') {
    return roundTo2(value);
  }

  if (unit === 'M') {
    return roundTo2(value / 1024);
  }

  return 0;
}

function getProcessCommand(processInfo) {
  return String(processInfo?.command || processInfo?.cmd || processInfo?.params || processInfo?.path || '');
}

async function getCpuUsage() {
  const load = await systeminformation.currentLoad();
  return Math.round(load.currentLoad * 10) / 10;
}

function findMinecraftJavaProcess(processes) {
  const list = Array.isArray(processes?.list) ? processes.list : [];

  const candidates = list.filter((processInfo) => {
    const name = String(processInfo?.name || '').toLowerCase();
    const command = getProcessCommand(processInfo).toLowerCase();

    const isJava = name.includes('java');
    const isMinecraftCommand = command.includes('server') || command.includes('minecraft') || command.includes('.jar');

    return isJava && isMinecraftCommand;
  });

  if (!candidates.length) {
    return null;
  }

  return candidates.sort((a, b) => Number(b?.memRss || b?.mem || 0) - Number(a?.memRss || a?.mem || 0))[0];
}

async function getMinecraftRamUsage() {
  try {
    const processes = await systeminformation.processes();
    const javaProcess = findMinecraftJavaProcess(processes);

    if (!javaProcess?.pid) {
      return {
        usedRam: 0,
        maxRam: 0,
        usedRamMb: 0,
      };
    }

    const usage = await pidusage(javaProcess.pid);
    const memoryBytes = Number(usage?.memory || 0);
    const usedRam = toGbFromBytes(memoryBytes);
    const maxRam = parseXmxGb(getProcessCommand(javaProcess));

    return {
      usedRam,
      maxRam,
      usedRamMb: Math.round(memoryBytes / MEGABYTE),
    };
  } catch (error) {
    return {
      usedRam: 0,
      maxRam: 0,
      usedRamMb: 0,
    };
  }
}

function normalizePlayerName(player) {
  return String(player?.name || player?.username || player?.player || '').trim();
}

function normalizePlayerUuid(player) {
  return String(player?.uuid || player?.id || player?.playerUuid || '').trim();
}

async function getMinecraftStatus() {
  try {
    const result = await minecraftStatus('127.0.0.1', 25565, {
      timeout: 2500,
    });

    const sample = Array.isArray(result?.players?.sample) ? result.players.sample : [];
    const latency = roundTo2(result?.latency || 0);

    return {
      players: Number(result?.players?.online ?? 0),
      playerList: sample
        .map((player) => ({
          name: normalizePlayerName(player),
          uuid: normalizePlayerUuid(player),
          ping: latency,
          status: 'online',
        }))
        .filter((player) => player.name),
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
  const [cpu, ramUsage, minecraft] = await Promise.all([
    getCpuUsage(),
    getMinecraftRamUsage(),
    getMinecraftStatus(),
  ]);

  return {
    cpu,
    ram: ramUsage.usedRamMb,
    ramUsed: ramUsage.usedRam,
    ramMax: ramUsage.maxRam,
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

    console.log(
      `[DXIR STATS] ${payload.status.toUpperCase()} | CPU ${payload.cpu}% | RAM ${payload.ramUsed}/${payload.ramMax} GB | Players ${payload.players} | Uptime ${payload.uptime}s | ${response.status}`
    );
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
  setInterval(sendOnce, 100);
}

main().catch((error) => {
  console.error('[DXIR STATS] Fatal error:', error);
  process.exit(1);
});
