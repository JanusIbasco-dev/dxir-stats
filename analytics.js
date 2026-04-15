const THEME_STORAGE_KEY = 'dxir-theme';
const FALLBACK_REFRESH_MS = 15000;
const MAX_POINTS = 200;
const SAMPLE_INTERVAL_MS = 220;

const state = {
  chart: null,
  labels: [],
  cpuData: [],
  ramData: [],
  isPaused: false,
  source: 'connecting',
  realtimeConnected: false,
  lastRealtimeAt: 0,
  lastFrameAt: 0,
  lastSampleAt: 0,
  lastFallbackAt: 0,
  chartRenderAt: 0,
  frameId: 0,
  targetCPU: 0,
  animatedCPU: 0,
  targetRam: 0,
  animatedRam: 0,
  pusher: null,
  channel: null,
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

function lerp(current, target, factor) {
  return current + (target - current) * factor;
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

function getCssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function initChart() {
  if (!window.Chart || !elements.chartCanvas) {
    return;
  }

  state.chart = new Chart(elements.chartCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: state.labels,
      datasets: [
        {
          label: 'CPU (%)',
          data: state.cpuData,
          borderColor: getCssVar('--chart-cpu') || '#7C3AED',
          backgroundColor: 'rgba(124, 58, 237, 0.15)',
          tension: 0.28,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          hidden: false,
          yAxisID: 'y',
        },
        {
          label: 'RAM (GB)',
          data: state.ramData,
          borderColor: getCssVar('--chart-ram') || '#8B5CF6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          tension: 0.28,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          hidden: false,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: getCssVar('--chart-ticks') || '#94A3B8',
            usePointStyle: true,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: getCssVar('--chart-ticks') || '#94A3B8', maxRotation: 0 },
          grid: { color: getCssVar('--chart-grid') || 'rgba(148, 163, 184, 0.18)' },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 100,
          ticks: { color: getCssVar('--chart-ticks') || '#94A3B8' },
          grid: { color: getCssVar('--chart-grid') || 'rgba(148, 163, 184, 0.18)' },
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          ticks: { color: getCssVar('--chart-ticks') || '#94A3B8' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

function pushPoint(now) {
  const label = new Date(now).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  state.labels.push(label);
  state.cpuData.push(state.animatedCPU);
  state.ramData.push(state.animatedRam);

  if (state.labels.length > MAX_POINTS) {
    state.labels.shift();
    state.cpuData.shift();
    state.ramData.shift();
  }
}

function renderChart(nowPerf) {
  if (!state.chart) {
    return;
  }

  if (nowPerf - state.chartRenderAt < 33) {
    return;
  }

  state.chartRenderAt = nowPerf;

  const cpuVisible = elements.toggleCpu ? elements.toggleCpu.checked : true;
  const ramVisible = elements.toggleRam ? elements.toggleRam.checked : true;

  state.chart.data.labels = [...state.labels];
  state.chart.data.datasets[0].data = [...state.cpuData];
  state.chart.data.datasets[0].hidden = !cpuVisible;
  state.chart.data.datasets[1].data = [...state.ramData];
  state.chart.data.datasets[1].hidden = !ramVisible;
  state.chart.update('none');
}

function ingestSnapshot(snapshot, source = 'stream') {
  const cpu = Math.max(0, normalizeNumber(snapshot?.cpu, 0));
  const ramUsed = Math.max(0, normalizeNumber(snapshot?.ramUsed, normalizeNumber(snapshot?.ram, 0) / 1024));

  state.targetCPU = cpu;
  state.targetRam = ramUsed;
  state.source = source;
}

async function fetchSnapshot() {
  try {
    const response = await fetch('/api/data', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
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
      throw new Error(`HTTP ${response.status}`);
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
  state.labels = [];
  state.cpuData = [];
  state.ramData = [];
  if (state.chart) {
    state.chart.data.labels = [];
    state.chart.data.datasets[0].data = [];
    state.chart.data.datasets[1].data = [];
    state.chart.update('none');
  }
}

function loop(nowPerf) {
  if (!state.lastFrameAt) {
    state.lastFrameAt = nowPerf;
  }

  if (!state.isPaused) {
    state.animatedCPU = lerp(state.animatedCPU, state.targetCPU, 0.1);
    state.animatedRam = lerp(state.animatedRam, state.targetRam, 0.1);

    if (nowPerf - state.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      state.lastSampleAt = nowPerf;
      pushPoint(Date.now());
    }
  }

  if (elements.cpuText) {
    elements.cpuText.textContent = `CPU: ${state.animatedCPU.toFixed(1)}%`;
  }
  if (elements.ramText) {
    elements.ramText.textContent = `RAM: ${state.animatedRam.toFixed(2)} GB`;
  }
  if (elements.sourceText) {
    elements.sourceText.textContent = `Source: ${state.source}`;
  }

  renderChart(nowPerf);

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
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getThemeFromStorage(), false);
  bindEvents();
  initChart();
  fetchSnapshot();
  connectRealtime();
  state.frameId = window.requestAnimationFrame(loop);
});

