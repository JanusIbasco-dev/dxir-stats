const THEME_STORAGE_KEY = 'dxir-theme';
const FALLBACK_REFRESH_MS = 15000;
const AUTO_FETCH_MS = 2000;
const DATA_PUSH_MS = 1000;
const MAX_POINTS = 200;
const EASE = 0.08;
const GRID_LINES = 6;

const state = {
  isPaused: false,
  source: 'connecting',
  realtimeConnected: false,
  lastRealtimeAt: 0,
  lastFrameAt: 0,
  lastFallbackAt: 0,
  frameId: 0,
  targetCPU: 0,
  animatedCPU: 0,
  targetRamUsed: 0,
  animatedRamUsed: 0,
  targetRamPercent: 0,
  animatedRamPercent: 0,
  points: [],
  pusher: null,
  channel: null,
  canvas: null,
  ctx: null,
  dpr: 1,
  width: 0,
  height: 0,
  autoFetchTimer: 0,
  pointPushTimer: 0,
};

const elements = {
  themeToggle: document.getElementById('themeToggle'),
  themeToggleLabel: document.getElementById('themeToggleLabel'),
  livePill: document.getElementById('analyticsLivePill'),
  liveLabel: document.getElementById('analyticsLiveLabel'),
  cpuText: document.getElementById('analyticsCpuText'),
  ramText: document.getElementById('analyticsRamText'),
  sourceText: document.getElementById('analyticsSourceText'),
  toggleCpu: document.getElementById('toggleCpu'),
  toggleRam: document.getElementById('toggleRam'),
  pauseGraphBtn: document.getElementById('pauseGraphBtn'),
  clearGraphBtn: document.getElementById('clearGraphBtn'),
  chartCanvas: document.getElementById('analyticsChart'),
};

function getThemeFromStorage() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch (error) {
    return 'dark';
  }
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('light', nextTheme === 'light');

  if (elements.themeToggle) {
    elements.themeToggle.dataset.theme = nextTheme;
    elements.themeToggle.setAttribute('aria-pressed', String(nextTheme === 'light'));
  }

  if (elements.themeToggleLabel) {
    elements.themeToggleLabel.textContent = nextTheme === 'light' ? 'Dark mode' : 'Light mode';
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (error) {
      // Ignore storage failures.
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setLiveState(status, label) {
  if (elements.livePill) {
    elements.livePill.dataset.state = status;
  }
  if (elements.liveLabel) {
    elements.liveLabel.textContent = label;
  }
}

function getCssVar(name, fallback = '') {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

function initCanvas() {
  if (!elements.chartCanvas) {
    return;
  }

  state.canvas = elements.chartCanvas;
  state.ctx = state.canvas.getContext('2d');
  resizeCanvas();
}

function resizeCanvas() {
  if (!state.canvas || !state.ctx) {
    return;
  }

  const rect = state.canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssWidth = Math.max(1, Math.floor(rect.width));
  const cssHeight = Math.max(1, Math.floor(rect.height));

  state.dpr = dpr;
  state.width = cssWidth;
  state.height = cssHeight;

  state.canvas.width = Math.floor(cssWidth * dpr);
  state.canvas.height = Math.floor(cssHeight * dpr);
  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function pushPoint() {
  if (!Number.isFinite(state.animatedCPU) || !Number.isFinite(state.animatedRamPercent)) {
    return;
  }

  const cpu = clamp(state.animatedCPU, 0, 100);
  const ram = clamp(state.animatedRamPercent, 0, 100);

  state.points.push({
    cpu,
    ram,
  });

  if (state.points.length > MAX_POINTS) {
    state.points.shift();
  }
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = getCssVar('--chart-grid', 'rgba(148, 163, 184, 0.18)');
  ctx.lineWidth = 1;

  for (let index = 0; index <= GRID_LINES; index += 1) {
    const y = (height / GRID_LINES) * index;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  for (let index = 0; index <= GRID_LINES; index += 1) {
    const x = (width / GRID_LINES) * index;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawLine(ctx, values, color, width, height) {
  if (values.length < 2) {
    return;
  }

  const stepX = width / Math.max(1, MAX_POINTS - 1);
  const points = values.map((value, index) => {
    const normalized = Math.max(0, Math.min(1, Number(value || 0) / 100));
    return {
      x: index * stepX,
      y: height - normalized * height,
    };
  });

  ctx.beginPath();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.25;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const controlX = (current.x + next.x) / 2;
    const controlY = (current.y + next.y) / 2;
    ctx.quadraticCurveTo(current.x, current.y, controlX, controlY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();

  ctx.shadowBlur = 0;
}

function drawGraph() {
  if (!state.ctx || !state.canvas) {
    return;
  }

  const ctx = state.ctx;
  const width = state.width;
  const height = state.height;

  ctx.clearRect(0, 0, width, height);

  // Faded overlay creates a soft trail effect for previous frames.
  ctx.fillStyle = getCssVar('--bg-card', 'rgba(30, 41, 59, 0.6)');
  ctx.globalAlpha = 0.18;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;

  drawGrid(ctx, width, height);

  const cpuVisible = elements.toggleCpu ? elements.toggleCpu.checked : true;
  const ramVisible = elements.toggleRam ? elements.toggleRam.checked : true;

  const cpuColor = getCssVar('--chart-cpu', '#7C3AED');
  const ramColor = getCssVar('--chart-ram', '#8B5CF6');

  if (cpuVisible) {
    drawLine(ctx, state.points.map((entry) => entry.cpu), cpuColor, width, height);
  }

  if (ramVisible) {
    drawLine(ctx, state.points.map((entry) => entry.ram), ramColor, width, height);
  }
}

function ingestSnapshot(snapshot, source = 'stream') {
  const cpu = Math.max(0, normalizeNumber(snapshot?.cpu, 0));
  const ramUsed = Math.max(0, normalizeNumber(snapshot?.ramUsed, normalizeNumber(snapshot?.ram, 0) / 1024));
  const ramMax = Math.max(0, normalizeNumber(snapshot?.ramMax, 0));
  const ramPercent = ramMax > 0 ? (ramUsed / ramMax) * 100 : 0;

  state.targetCPU = clamp(cpu, 0, 100);
  state.targetRamUsed = Math.max(0, ramUsed);
  state.targetRamPercent = clamp(ramPercent, 0, 100);
  state.source = source;

  // Prevent a large visual jump on first payload.
  if (!state.points.length && state.animatedCPU === 0 && state.animatedRamUsed === 0) {
    state.animatedCPU = state.targetCPU;
    state.animatedRamUsed = state.targetRamUsed;
    state.animatedRamPercent = state.targetRamPercent;
  }
}

async function fetchSnapshot() {
  try {
    const response = await fetch('/api/data', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      setLiveState('offline', 'OFFLINE');
      return;
    }

    const payload = await response.json();
    const dataRoot = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const latest = dataRoot?.latest && typeof dataRoot.latest === 'object'
      ? dataRoot.latest
      : dataRoot;

    if (latest && typeof latest === 'object') {
      ingestSnapshot(latest, 'fallback');
      setLiveState('online', 'LIVE');
    }
  } catch (error) {
    setLiveState('offline', 'OFFLINE');
  }
}

function bindRealtime(channel) {
  channel.bind('stats_update', (event) => {
    if (!event?.latest) {
      return;
    }

    state.lastRealtimeAt = Date.now();
    ingestSnapshot(event.latest, 'realtime');
    setLiveState('online', 'LIVE');
  });
}

async function connectRealtime() {
  try {
    const response = await fetch('/api/realtime-config', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      state.realtimeConnected = false;
      setLiveState('error', 'FALLBACK');
      return;
    }

    const config = await response.json();

    if (!config?.enabled || !window.Pusher) {
      state.realtimeConnected = false;
      setLiveState('error', 'FALLBACK');
      return;
    }

    state.pusher = new window.Pusher(config.key, {
      cluster: config.cluster,
      forceTLS: true,
    });

    state.channel = state.pusher.subscribe(config.channel);
    bindRealtime(state.channel);

    state.pusher.connection.bind('connected', () => {
      state.realtimeConnected = true;
      state.lastRealtimeAt = Date.now();
      setLiveState('online', 'LIVE');
      fetchSnapshot();
    });

    state.pusher.connection.bind('disconnected', () => {
      state.realtimeConnected = false;
      setLiveState('offline', 'OFFLINE');
    });

    state.pusher.connection.bind('error', () => {
      state.realtimeConnected = false;
      setLiveState('error', 'ERROR');
    });
  } catch (error) {
    state.realtimeConnected = false;
    setLiveState('error', 'FALLBACK');
  }
}

function clearGraph() {
  state.points = [];
  drawGraph();
}

function loop(nowPerf) {
  if (!state.lastFrameAt) {
    state.lastFrameAt = nowPerf;
  }

  state.lastFrameAt = nowPerf;

  if (!state.isPaused) {
    state.animatedCPU += (state.targetCPU - state.animatedCPU) * EASE;
    state.animatedRamUsed += (state.targetRamUsed - state.animatedRamUsed) * EASE;
    state.animatedRamPercent += (state.targetRamPercent - state.animatedRamPercent) * EASE;

    state.animatedCPU = clamp(state.animatedCPU, 0, 100);
    state.animatedRamUsed = Math.max(0, state.animatedRamUsed);
    state.animatedRamPercent = clamp(state.animatedRamPercent, 0, 100);

    state.lastSampleAt = nowPerf;
  }

  if (elements.cpuText) {
    elements.cpuText.textContent = `CPU: ${state.animatedCPU.toFixed(1)}%`;
  }
  if (elements.ramText) {
    elements.ramText.textContent = `RAM: ${state.animatedRamUsed.toFixed(2)} GB (${state.animatedRamPercent.toFixed(1)}%)`;
  }
  if (elements.sourceText) {
    elements.sourceText.textContent = `Source: ${state.source}`;
  }

  drawGraph();

  if (nowPerf - state.lastFallbackAt >= FALLBACK_REFRESH_MS) {
    state.lastFallbackAt = nowPerf;
    const staleRealtime = Date.now() - state.lastRealtimeAt > FALLBACK_REFRESH_MS;
    if (!state.realtimeConnected || staleRealtime) {
      fetchSnapshot();
    }
  }

  state.frameId = window.requestAnimationFrame(loop);
}

function bindEvents() {
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      const next = document.body.classList.contains('light') ? 'dark' : 'light';
      applyTheme(next, true);
    });
  }

  if (elements.pauseGraphBtn) {
    elements.pauseGraphBtn.addEventListener('click', () => {
      state.isPaused = !state.isPaused;
      elements.pauseGraphBtn.textContent = state.isPaused ? 'Resume' : 'Pause';
    });
  }

  if (elements.clearGraphBtn) {
    elements.clearGraphBtn.addEventListener('click', clearGraph);
  }

  window.addEventListener('resize', resizeCanvas);
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getThemeFromStorage(), false);
  bindEvents();
  initCanvas();
  fetchSnapshot();
  state.autoFetchTimer = window.setInterval(fetchSnapshot, AUTO_FETCH_MS);
  state.pointPushTimer = window.setInterval(pushPoint, DATA_PUSH_MS);
  connectRealtime();
  state.frameId = window.requestAnimationFrame(loop);
});

