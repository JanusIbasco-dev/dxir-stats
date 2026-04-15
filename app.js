const FALLBACK_REFRESH_MS = 15000;
const AUTO_FETCH_MS = 2000;
const OFFLINE_THRESHOLD_MS = 8000;
const THEME_STORAGE_KEY = 'dxir-theme';
const CHART_STREAM_MS = 120;

const state = {
  hasData: false,
  theme: 'dark',
  fallbackTimer: null,
  staleTimer: null,
  realtimeConnected: false,
  lastRealtimeAt: 0,
  pusher: null,
  realtimeChannel: null,
  chart: null,
  chartResizeTimer: null,
  maxPoints: 140,
  lastSeenUpdate: 0,
  lastFreshAt: 0,
  lastChartSignature: '',
  uiFrameId: 0,
  lastUiFrameAt: 0,
  lastStaleCheckAt: 0,
  lastFallbackCheckAt: 0,
  lastChartAnimateAt: 0,
  targetStats: {
    cpu: 0,
    ramUsed: 0,
    ramMax: 0,
    uptime: 0,
    uptimeReceivedPerf: 0,
  },
  animatedStats: {
    cpu: 0,
    ramUsed: 0,
    ramMax: 0,
  },
  currentSnapshot: null,
  chartTargetPoint: {
    cpu: 0,
    ram: 0,
  },
  chartLastUpdateKey: 0,
  chartStreamAccumulator: 0,
  lastSnapshotUpdateAt: 0,
  autoFetchTimer: 0,
};

const elements = {
  connectionStatus: document.getElementById('connectionStatus'),
  connectionLabel: document.getElementById('connectionLabel'),
  themeToggle: document.getElementById('themeToggle'),
  themeToggleLabel: document.getElementById('themeToggleLabel'),
  uptimeValue: document.getElementById('uptimeValue'),
  serverIpValue: document.getElementById('serverIpValue'),
  cpuValue: document.getElementById('cpuValue'),
  ramValue: document.getElementById('ramValue'),
  serverValue: document.getElementById('serverValue'),
  timeValue: document.getElementById('timeValue'),
  apiMessage: document.getElementById('apiMessage'),
  healthOverall: document.getElementById('healthOverall'),
  healthOverallText: document.getElementById('healthOverallText'),
  healthSubtitle: document.getElementById('healthSubtitle'),
  healthStateLine: document.getElementById('healthStateLine'),
  healthStateText: document.getElementById('healthStateText'),
  healthResourceLine: document.getElementById('healthResourceLine'),
  healthResourceText: document.getElementById('healthResourceText'),
  healthUptimeLine: document.getElementById('healthUptimeLine'),
  healthUptimeText: document.getElementById('healthUptimeText'),
  healthRecommendationLine: document.getElementById('healthRecommendationLine'),
  healthRecommendationText: document.getElementById('healthRecommendationText'),
  chartCanvas: document.getElementById('usageChart'),
  chartCard: document.querySelector('.chart-card'),
};

function setAnimatedText(element, nextText) {
  if (!element || element.textContent === nextText) {
    return;
  }

  element.textContent = nextText;
  element.classList.remove('is-updating');
  void element.offsetWidth;
  element.classList.add('is-updating');
}

const chartState = {
  labels: [],
  cpuData: [],
  ramData: [],
};

function normalizeNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback = '--') {
  const text = String(value || '').trim();
  return text || fallback;
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (total < 60) {
    return `${secs}s`;
  }

  return [hours > 0 ? `${hours}h` : null, `${minutes}m`, `${secs}s`].filter(Boolean).join(' ');
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s ago`;
  }

  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s ago`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function lerp(current, target, factor) {
  return current + (target - current) * factor;
}

function formatStatNumber(value, digits = 1) {
  const amount = Number(value || 0);
  return amount.toFixed(digits);
}

function getCPUColor(cpu) {
  if (cpu < 50) return '#22c55e';
  if (cpu < 80) return '#eab308';
  return '#ef4444';
}

function getRAMColor(ramPercent) {
  if (ramPercent < 50) return '#22c55e';
  if (ramPercent < 80) return '#eab308';
  return '#ef4444';
}

function getTimeAgoLabel(timestampMs) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - Number(timestampMs || 0)) / 1000));
  return diffSeconds <= 1 ? 'just now' : `${diffSeconds}s ago`;
}

function getUsageState(valuePercent) {
  if (valuePercent < 50) return 'good';
  if (valuePercent < 80) return 'warning';
  return 'critical';
}

function getOverallHealth(cpuPercent, ramPercent) {
  if (cpuPercent > 80 || ramPercent > 80) {
    return { state: 'critical', text: 'Critical' };
  }

  if ((cpuPercent >= 50 && cpuPercent <= 80) || (ramPercent >= 50 && ramPercent <= 80)) {
    return { state: 'warning', text: 'Warning' };
  }

  if (cpuPercent < 50 && ramPercent < 50) {
    return { state: 'excellent', text: 'Excellent' };
  }

  return { state: 'critical', text: 'Critical' };
}

function formatUptimeCompact(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function getThemeFromStorage() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch (error) {
    return 'dark';
  }
}

function updateThemeButton(theme) {
  const isLight = theme === 'light';
  if (elements.themeToggle) {
    elements.themeToggle.setAttribute('aria-pressed', String(isLight));
    elements.themeToggle.dataset.theme = isLight ? 'light' : 'dark';
  }
  if (elements.themeToggleLabel) {
    elements.themeToggleLabel.textContent = isLight ? 'Dark mode' : 'Light mode';
  }
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  state.theme = nextTheme;
  document.body.classList.toggle('light', nextTheme === 'light');
  updateThemeButton(nextTheme);

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (error) {
      // Ignore storage failures.
    }
  }

  if (state.chart) {
    syncChartTheme();
  }
}

function setConnectionState(stateName, label) {
  if (elements.connectionStatus) {
    elements.connectionStatus.dataset.state = stateName;
  }
  if (elements.connectionLabel) {
    elements.connectionLabel.textContent = label;
  }
}

function setChartOpacity(isOffline) {
  if (elements.chartCard) {
    elements.chartCard.style.opacity = isOffline ? '0.78' : '1';
  }
}

function getCssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '').trim().replace('#', '');
  if (value.length !== 6) {
    return `rgba(139, 92, 246, ${alpha})`;
  }

  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getChartPalette() {
  return {
    cpu: getCssVar('--chart-cpu') || '#7C3AED',
    ram: getCssVar('--chart-ram') || '#8B5CF6',
    grid: getCssVar('--chart-grid') || 'rgba(148, 163, 184, 0.18)',
    ticks: getCssVar('--chart-ticks') || '#94A3B8',
    tooltipBg: getCssVar('--chart-tooltip-bg') || '#111827',
    tooltipBorder: getCssVar('--chart-tooltip-border') || 'rgba(148, 163, 184, 0.2)',
  };
}

function isCompactViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function syncChartDensity() {
  if (!state.chart) {
    return;
  }

  const compact = isCompactViewport();
  state.chart.options.plugins.legend.labels.padding = compact ? 10 : 16;
  state.chart.options.plugins.legend.labels.boxWidth = compact ? 8 : 10;
  state.chart.options.plugins.legend.labels.boxHeight = compact ? 8 : 10;
  state.chart.options.scales.x.ticks.maxTicksLimit = compact ? 6 : 12;
  state.chart.options.scales.y.ticks.maxTicksLimit = compact ? 4 : 6;
  state.chart.options.scales.y1.ticks.maxTicksLimit = compact ? 4 : 6;
  state.chart.update('none');
}

function syncChartTheme() {
  if (!state.chart) {
    return;
  }

  const palette = getChartPalette();
  const [cpuDataset, ramDataset] = state.chart.data.datasets;
  cpuDataset.borderColor = palette.cpu;
  cpuDataset.backgroundColor = hexToRgba(palette.cpu, 0.16);
  ramDataset.borderColor = palette.ram;
  ramDataset.backgroundColor = hexToRgba(palette.ram, 0.12);

  state.chart.options.scales.x.grid.color = palette.grid;
  state.chart.options.scales.y.grid.color = palette.grid;
  state.chart.options.scales.x.ticks.color = palette.ticks;
  state.chart.options.scales.y.ticks.color = palette.ticks;
  state.chart.options.scales.y1.ticks.color = palette.ticks;
  state.chart.options.plugins.tooltip.backgroundColor = palette.tooltipBg;
  state.chart.options.plugins.tooltip.borderColor = palette.tooltipBorder;
  syncChartDensity();
}

function initChart() {
  if (!window.Chart || !elements.chartCanvas) {
    return;
  }

  const palette = getChartPalette();
  state.chart = new Chart(elements.chartCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: chartState.labels,
      datasets: [
        {
          label: 'CPU (%)',
          data: chartState.cpuData,
          yAxisID: 'y',
          borderColor: palette.cpu,
          backgroundColor: hexToRgba(palette.cpu, 0.16),
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'RAM (MB)',
          data: chartState.ramData,
          yAxisID: 'y1',
          borderColor: palette.ram,
          backgroundColor: hexToRgba(palette.ram, 0.12),
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: palette.ticks,
            usePointStyle: true,
            boxWidth: 10,
            boxHeight: 10,
            padding: 16,
          },
        },
        tooltip: {
          backgroundColor: palette.tooltipBg,
          borderColor: palette.tooltipBorder,
          borderWidth: 1,
          titleColor: getCssVar('--text-primary') || '#E5E7EB',
          bodyColor: getCssVar('--text-primary') || '#E5E7EB',
          padding: 10,
        },
      },
      scales: {
        x: {
          ticks: { color: palette.ticks, autoSkip: true, maxRotation: 0 },
          grid: { color: palette.grid },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 100,
          ticks: { color: palette.ticks },
          grid: { color: palette.grid },
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          ticks: { color: palette.ticks },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });

  syncChartDensity();
}

function buildHistorySignature(history) {
  return history.map((item) => `${item.lastUpdate}|${item.time}|${item.cpu}|${item.ram}`).join('~');
}

function applyHistoryToChart(history) {
  if (!state.chart) {
    return;
  }

  const points = Array.isArray(history) ? history.slice(-state.maxPoints) : [];
  const signature = buildHistorySignature(points);

  if (signature === state.lastChartSignature) {
    return;
  }

  state.lastChartSignature = signature;
  chartState.labels = points.map((item) => normalizeString(item.time, '--'));
  chartState.cpuData = points.map((item) => normalizeNumber(item.cpu, 0));
  chartState.ramData = points.map((item) => normalizeNumber(item.ram, 0));

  state.chart.data.labels = [...chartState.labels];
  state.chart.data.datasets[0].data = [...chartState.cpuData];
  state.chart.data.datasets[1].data = [...chartState.ramData];
  state.chart.update();

  if (chartState.cpuData.length) {
    state.chartTargetPoint.cpu = Number(chartState.cpuData[chartState.cpuData.length - 1] || 0);
    state.chartTargetPoint.ram = Number(chartState.ramData[chartState.ramData.length - 1] || 0);
  }
}

function appendSnapshotToChart(snapshot) {
  if (!state.chart || !snapshot) {
    return;
  }

  const updateKey = Number(snapshot.lastUpdate || 0);
  if (updateKey > 0 && updateKey === state.chartLastUpdateKey) {
    return;
  }

  state.chartLastUpdateKey = updateKey;

  chartState.labels.push(normalizeString(snapshot.time, '--'));
  chartState.cpuData.push(normalizeNumber(snapshot.cpu, 0));
  chartState.ramData.push(normalizeNumber(snapshot.ram, 0));

  if (chartState.labels.length > state.maxPoints) {
    chartState.labels.shift();
    chartState.cpuData.shift();
    chartState.ramData.shift();
  }

  state.chartTargetPoint.cpu = Number(chartState.cpuData[chartState.cpuData.length - 1] || 0);
  state.chartTargetPoint.ram = Number(chartState.ramData[chartState.ramData.length - 1] || 0);

  state.chart.data.labels = [...chartState.labels];
  state.chart.data.datasets[0].data = [...chartState.cpuData];
  state.chart.data.datasets[1].data = [...chartState.ramData];
  state.chart.update('none');
}

function animateChartTowardsTarget(nowPerf) {
  if (!state.chart || chartState.cpuData.length === 0) {
    return;
  }

  if (nowPerf - state.lastChartAnimateAt < 48) {
    return;
  }

  state.lastChartAnimateAt = nowPerf;

  const lastIndex = chartState.cpuData.length - 1;
  chartState.cpuData[lastIndex] = lerp(chartState.cpuData[lastIndex], state.chartTargetPoint.cpu, 0.18);
  chartState.ramData[lastIndex] = lerp(chartState.ramData[lastIndex], state.chartTargetPoint.ram, 0.18);

  state.chart.data.datasets[0].data[lastIndex] = chartState.cpuData[lastIndex];
  state.chart.data.datasets[1].data[lastIndex] = chartState.ramData[lastIndex];
  state.chart.update('none');
}

function streamAnimatedChart(nowPerf) {
  if (!state.chart || !state.currentSnapshot) {
    return;
  }

  state.chartStreamAccumulator += Math.max(0, nowPerf - state.lastUiFrameAt);
  if (state.chartStreamAccumulator < CHART_STREAM_MS) {
    return;
  }

  state.chartStreamAccumulator -= CHART_STREAM_MS;

  const streamLabel = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  chartState.labels.push(streamLabel);
  chartState.cpuData.push(Number(state.animatedStats.cpu || 0));
  chartState.ramData.push(Number(state.animatedStats.ramUsed || 0));

  if (chartState.labels.length > state.maxPoints) {
    chartState.labels.shift();
    chartState.cpuData.shift();
    chartState.ramData.shift();
  }

  state.chart.data.labels = [...chartState.labels];
  state.chart.data.datasets[0].data = [...chartState.cpuData];
  state.chart.data.datasets[1].data = [...chartState.ramData];
  state.chart.update('none');
}

function unwrapApiPayload(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;

  if (data && typeof data === 'object' && ('latest' in data || Array.isArray(data.history))) {
    return {
      latest: data.latest && typeof data.latest === 'object' ? data.latest : null,
      history: Array.isArray(data.history) ? data.history : [],
    };
  }

  return {
    latest: data && typeof data === 'object' ? data : null,
    history: Array.isArray(root.history) ? root.history : [],
  };
}

function renderLoading() {
  state.hasData = false;
  state.currentSnapshot = null;
  state.lastSnapshotUpdateAt = 0;
  state.targetStats.uptimeReceivedPerf = performance.now();
  setConnectionState('loading', 'Connecting');
  setChartOpacity(false);

  if (elements.uptimeValue) elements.uptimeValue.textContent = '--';
  if (elements.serverIpValue) elements.serverIpValue.textContent = '--';
  if (elements.cpuValue) elements.cpuValue.textContent = '--';
  if (elements.ramValue) elements.ramValue.textContent = '--';
  if (elements.serverValue) {
    elements.serverValue.textContent = '--';
    elements.serverValue.dataset.state = 'loading';
  }
  if (elements.timeValue) elements.timeValue.textContent = '--';
  if (elements.apiMessage) elements.apiMessage.textContent = 'Waiting for the first server payload...';

}

function markOffline() {
  if (state.currentSnapshot) {
    state.currentSnapshot.status = 'offline';
  }

  setConnectionState('offline', 'Offline');
  setChartOpacity(true);

  if (elements.serverValue) {
    elements.serverValue.textContent = 'Offline';
    elements.serverValue.dataset.state = 'offline';
  }

  if (elements.apiMessage) {
    const age = state.lastFreshAt > 0 ? formatElapsed(Date.now() - state.lastFreshAt) : 'unknown';
    elements.apiMessage.textContent = `No recent data received (${age}).`;
  }
}

function applySnapshotTargets(snapshot) {
  const cpu = Math.max(0, normalizeNumber(snapshot.cpu, 0));
  const ramUsed = Math.max(0, normalizeNumber(snapshot.ramUsed, normalizeNumber(snapshot.ram, 0) / 1024));
  const ramMax = Math.max(0, normalizeNumber(snapshot.ramMax, 0));
  const uptime = Math.max(0, Math.floor(normalizeNumber(snapshot.uptime, 0)));

  state.targetStats.cpu = cpu;
  state.targetStats.ramUsed = ramUsed;
  state.targetStats.ramMax = ramMax;
  state.targetStats.uptime = uptime;
  state.targetStats.uptimeReceivedPerf = performance.now();

  if (!state.currentSnapshot) {
    state.animatedStats.cpu = cpu;
    state.animatedStats.ramUsed = ramUsed;
    state.animatedStats.ramMax = ramMax;
  }
}

function renderAnimatedStats(nowPerf) {
  if (!state.currentSnapshot) {
    return;
  }

  state.animatedStats.cpu = lerp(state.animatedStats.cpu, state.targetStats.cpu, 0.12);
  state.animatedStats.ramUsed = lerp(state.animatedStats.ramUsed, state.targetStats.ramUsed, 0.12);
  state.animatedStats.ramMax = lerp(state.animatedStats.ramMax, state.targetStats.ramMax, 0.08);
  const activeUptime = state.currentSnapshot.status === 'online' && state.hasData;
  const uptimeSeconds = activeUptime
    ? state.targetStats.uptime + Math.max(0, (nowPerf - state.targetStats.uptimeReceivedPerf) / 1000)
    : state.targetStats.uptime;

  if (elements.uptimeValue) {
    elements.uptimeValue.textContent = formatUptime(uptimeSeconds);
  }
  if (elements.cpuValue) {
    elements.cpuValue.textContent = `${formatStatNumber(state.animatedStats.cpu, 1)}%`;
    elements.cpuValue.style.color = getCPUColor(state.animatedStats.cpu);
  }
  if (elements.ramValue) {
    elements.ramValue.textContent = `${formatStatNumber(state.animatedStats.ramUsed, 2)} / ${formatStatNumber(state.animatedStats.ramMax, 2)} GB`;
    const ramPercent = state.animatedStats.ramMax > 0
      ? (state.animatedStats.ramUsed / state.animatedStats.ramMax) * 100
      : 0;
    elements.ramValue.style.color = getRAMColor(ramPercent);
  }

  const cpuPercent = clampNumber(state.animatedStats.cpu, 0, 100);
  const ramPercent = state.animatedStats.ramMax > 0
    ? clampNumber((state.animatedStats.ramUsed / state.animatedStats.ramMax) * 100, 0, 100)
    : 0;
  const overall = getOverallHealth(cpuPercent, ramPercent);

  if (elements.healthOverall) {
    elements.healthOverall.dataset.state = overall.state;
  }
  if (elements.healthOverallText) {
    setAnimatedText(elements.healthOverallText, overall.text);
  }
  if (elements.healthSubtitle) {
    if (overall.state === 'excellent' || overall.state === 'good') {
      setAnimatedText(elements.healthSubtitle, 'System running smoothly');
    } else if (overall.state === 'warning') {
      setAnimatedText(elements.healthSubtitle, 'Resource pressure detected');
    } else {
      setAnimatedText(elements.healthSubtitle, 'Performance needs attention');
    }
  }

  if (elements.healthStateLine) {
    elements.healthStateLine.dataset.state = overall.state;
  }
  if (elements.healthStateText) {
    if (overall.state === 'excellent') {
      setAnimatedText(elements.healthStateText, 'All systems operational');
    } else if (overall.state === 'warning') {
      setAnimatedText(elements.healthStateText, 'System under moderate load');
    } else {
      setAnimatedText(elements.healthStateText, 'High system load detected');
    }
  }

  if (elements.healthResourceLine) {
    elements.healthResourceLine.dataset.state = overall.state;
  }
  if (elements.healthResourceText) {
    if (overall.state === 'excellent') {
      setAnimatedText(elements.healthResourceText, 'Resource usage is low');
    } else if (overall.state === 'warning') {
      setAnimatedText(elements.healthResourceText, 'Memory usage increasing');
    } else {
      setAnimatedText(elements.healthResourceText, 'CPU usage high');
    }
  }

  if (elements.healthUptimeLine) {
    elements.healthUptimeLine.dataset.state = overall.state;
  }
  if (elements.healthUptimeText) {
    setAnimatedText(elements.healthUptimeText, `Uptime stable (${formatUptimeCompact(uptimeSeconds)})`);
  }

  if (elements.healthRecommendationLine) {
    elements.healthRecommendationLine.dataset.state = overall.state;
  }
  if (elements.healthRecommendationText) {
    if (overall.state === 'excellent') {
      setAnimatedText(elements.healthRecommendationText, 'No action required');
    } else if (overall.state === 'warning') {
      setAnimatedText(elements.healthRecommendationText, 'Monitor resource usage');
    } else {
      setAnimatedText(elements.healthRecommendationText, 'Immediate attention required');
    }
  }

  if (elements.timeValue && state.lastSnapshotUpdateAt > 0) {
    elements.timeValue.textContent = getTimeAgoLabel(state.lastSnapshotUpdateAt);
  }

  if (elements.apiMessage && state.lastSnapshotUpdateAt > 0 && state.currentSnapshot?.status === 'online') {
    elements.apiMessage.textContent = `Updated ${getTimeAgoLabel(state.lastSnapshotUpdateAt)}`;
  }
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function renderSnapshot(snapshot) {
  const status = String(snapshot.status || 'offline').toLowerCase() === 'online' ? 'Online' : 'Offline';

  applySnapshotTargets(snapshot);
  state.currentSnapshot = {
    ...snapshot,
    status: status.toLowerCase(),
  };
  state.lastSnapshotUpdateAt = Number(snapshot.lastUpdate || Date.now());

  if (elements.serverIpValue) elements.serverIpValue.textContent = normalizeString(snapshot.ip, 'dxir.live');

  if (elements.serverValue) {
    elements.serverValue.textContent = status;
    elements.serverValue.dataset.state = status.toLowerCase();
  }

  if (elements.timeValue) elements.timeValue.textContent = getTimeAgoLabel(state.lastSnapshotUpdateAt);
  if (elements.apiMessage) {
    elements.apiMessage.textContent = `Updated ${getTimeAgoLabel(state.lastSnapshotUpdateAt)}`;
  }

  setConnectionState(status.toLowerCase(), status);
  setChartOpacity(status !== 'Online');

}

function renderData(payload, source = 'api') {
  const { latest, history } = unwrapApiPayload(payload);
  const snapshot = latest || (history.length ? history[history.length - 1] : null);

  if (!snapshot || !Number.isFinite(Number(snapshot.lastUpdate)) || Number(snapshot.lastUpdate) <= 0) {
    if (!state.hasData) {
      renderLoading();
    } else if (Date.now() - state.lastFreshAt > OFFLINE_THRESHOLD_MS) {
      markOffline();
    }
    return;
  }

  const lastUpdate = Number(snapshot.lastUpdate);
  if (lastUpdate === state.lastSeenUpdate) {
    if (Date.now() - state.lastFreshAt > OFFLINE_THRESHOLD_MS) {
      markOffline();
    }
    return;
  }

  state.hasData = true;
  state.lastSeenUpdate = lastUpdate;
  state.lastFreshAt = Date.now();

  renderSnapshot(snapshot);

  if (history.length) {
    applyHistoryToChart(history);
  } else {
    appendSnapshotToChart(snapshot);
  }

  if (elements.apiMessage && source === 'realtime') {
    elements.apiMessage.textContent = 'Updated just now';
  }
}

async function fetchStats() {
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
    renderData(payload, 'api');
  } catch (error) {
    if (!state.hasData) {
      renderLoading();
      setConnectionState('error', 'API error');
      if (elements.apiMessage) {
        elements.apiMessage.textContent = 'Unable to reach the API. Retrying automatically...';
      }
      return;
    }

    if (Date.now() - state.lastFreshAt > OFFLINE_THRESHOLD_MS) {
      markOffline();
    }
  }
}

function checkStaleConnection() {
  if (!state.hasData) {
    return;
  }

  if (Date.now() - state.lastFreshAt > OFFLINE_THRESHOLD_MS) {
    markOffline();
  }
}

function runFallbackRefresh() {
  fetchStats();
}

function attachRealtimeBindings(channel) {
  channel.bind('stats_update', (event) => {
    if (!event || !event.latest) {
      return;
    }

    state.lastRealtimeAt = Date.now();
    console.log('[DXIR RT] stats_update');

    renderData({ data: { latest: event.latest, history: [] } }, 'realtime');
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
      if (elements.apiMessage) {
        elements.apiMessage.textContent = 'Realtime unavailable. Fallback refresh runs every 15s.';
      }
      state.realtimeConnected = false;
      return;
    }

    const pusher = new window.Pusher(config.key, {
      cluster: config.cluster,
      forceTLS: true,
    });

    state.pusher = pusher;
    state.realtimeChannel = pusher.subscribe(config.channel);
    attachRealtimeBindings(state.realtimeChannel);

    pusher.connection.bind('connected', () => {
      state.realtimeConnected = true;
      state.lastRealtimeAt = Date.now();
      console.log('[DXIR RT] WebSocket connected');
      setConnectionState('online', 'Live');
      fetchStats();
    });

    pusher.connection.bind('disconnected', () => {
      state.realtimeConnected = false;
      console.warn('[DXIR RT] WebSocket disconnected');
      setConnectionState('offline', 'Disconnected');
      runFallbackRefresh();
    });

    pusher.connection.bind('state_change', (event) => {
      if (event?.current === 'connected' && event?.previous !== 'connected') {
        console.log('[DXIR RT] WebSocket reconnected');
      }
    });

    pusher.connection.bind('error', () => {
      state.realtimeConnected = false;
      console.warn('[DXIR RT] WebSocket error');
      setConnectionState('error', 'Realtime error');
      runFallbackRefresh();
    });
  } catch (error) {
    state.realtimeConnected = false;
    if (elements.apiMessage) {
      elements.apiMessage.textContent = 'Unable to initialize realtime connection. Fallback refresh enabled.';
    }
  }
}

function uiAnimationLoop(nowPerf) {
  if (!state.lastUiFrameAt) {
    state.lastUiFrameAt = nowPerf;
  }

  renderAnimatedStats(nowPerf);
  animateChartTowardsTarget(nowPerf);
  streamAnimatedChart(nowPerf);

  if (nowPerf - state.lastStaleCheckAt >= 1000) {
    state.lastStaleCheckAt = nowPerf;
    checkStaleConnection();
  }

  if (nowPerf - state.lastFallbackCheckAt >= FALLBACK_REFRESH_MS) {
    state.lastFallbackCheckAt = nowPerf;
    const staleRealtime = Date.now() - state.lastRealtimeAt > FALLBACK_REFRESH_MS;
    if (!state.realtimeConnected || staleRealtime) {
      runFallbackRefresh();
    }
  }

  state.uiFrameId = window.requestAnimationFrame(uiAnimationLoop);
}

function startRealtime() {
  fetchStats();
  connectRealtime();
  state.autoFetchTimer = window.setInterval(fetchStats, AUTO_FETCH_MS);
  state.uiFrameId = window.requestAnimationFrame(uiAnimationLoop);
}

function bindEvents() {
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'light' ? 'dark' : 'light');
    });
  }


  window.addEventListener('resize', () => {
    if (state.chartResizeTimer) {
      window.clearTimeout(state.chartResizeTimer);
    }

    state.chartResizeTimer = window.setTimeout(syncChartDensity, 120);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getThemeFromStorage(), false);
  bindEvents();
  initChart();
  renderLoading();
  startRealtime();
});

