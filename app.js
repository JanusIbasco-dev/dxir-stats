const state = {
  hasData: false,
  timer: null,
  chart: null,
  maxPoints: 50,
  lastHistorySignature: '',
  theme: 'dark',
};

const THEME_STORAGE_KEY = 'dxir-theme';

const elements = {
  connectionStatus: document.getElementById('connectionStatus'),
  connectionLabel: document.getElementById('connectionLabel'),
  themeToggle: document.getElementById('themeToggle'),
  themeToggleLabel: document.getElementById('themeToggleLabel'),
  uptimeValue: document.getElementById('uptimeValue'),
  serverIpValue: document.getElementById('serverIpValue'),
  cpuValue: document.getElementById('cpuValue'),
  ramValue: document.getElementById('ramValue'),
  playersValue: document.getElementById('playersValue'),
  serverValue: document.getElementById('serverValue'),
  timeValue: document.getElementById('timeValue'),
  apiMessage: document.getElementById('apiMessage'),
  playerList: document.getElementById('playerList'),
  chartCanvas: document.getElementById('usageChart'),
};

const chartState = {
  labels: [],
  cpuData: [],
  ramData: [],
};

function normalizeNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback = '--') {
  const text = String(value || '').trim();
  return text || fallback;
}

function hexToRgba(hex, alpha) {
  const normalized = String(hex || '').trim().replace('#', '');

  if (normalized.length !== 6) {
    return `rgba(108, 92, 231, ${alpha})`;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatUptime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (totalSeconds < 60) {
    return `${secs}s`;
  }

  return [
    hours > 0 ? `${hours}h` : null,
    `${minutes}m`,
    `${secs}s`,
  ]
    .filter(Boolean)
    .join(' ');
}

function setConnectionState(stateName, label) {
  if (elements.connectionStatus) {
    elements.connectionStatus.dataset.state = stateName;
  }

  if (elements.connectionLabel) {
    elements.connectionLabel.textContent = label;
  }
}

function setLoadingNodes(isLoading) {
  [
    elements.uptimeValue,
    elements.serverIpValue,
    elements.cpuValue,
    elements.ramValue,
    elements.playersValue,
    elements.serverValue,
    elements.timeValue,
  ].forEach((node) => {
    if (node) {
      node.classList.toggle('is-loading', isLoading);
    }
  });
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

function getCssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function getChartPalette() {
  return {
    cpu: getCssVar('--chart-cpu') || '#6C5CE7',
    ram: getCssVar('--chart-ram') || '#8B5CF6',
    grid: getCssVar('--chart-grid') || 'rgba(148, 163, 184, 0.14)',
    ticks: getCssVar('--chart-ticks') || '#9CA3AF',
    tooltipBg: getCssVar('--chart-tooltip-bg') || '#111827',
    tooltipBorder: getCssVar('--chart-tooltip-border') || 'rgba(148, 163, 184, 0.2)',
    cardBg: getCssVar('--chart-card-bg') || 'rgba(255, 255, 255, 0.02)',
  };
}

function syncChartTheme() {
  if (!state.chart) {
    return;
  }

  const palette = getChartPalette();
  const [cpuDataset, ramDataset] = state.chart.data.datasets;

  cpuDataset.borderColor = palette.cpu;
  cpuDataset.backgroundColor = hexToRgba(palette.cpu, 0.12);
  ramDataset.borderColor = palette.ram;
  ramDataset.backgroundColor = hexToRgba(palette.ram, 0.10);

  state.chart.options.scales.x.grid.color = palette.grid;
  state.chart.options.scales.y.grid.color = palette.grid;
  state.chart.options.scales.y1.grid.color = 'transparent';
  state.chart.options.scales.x.ticks.color = palette.ticks;
  state.chart.options.scales.y.ticks.color = palette.ticks;
  state.chart.options.scales.y1.ticks.color = palette.ticks;
  state.chart.options.plugins.tooltip.backgroundColor = palette.tooltipBg;
  state.chart.options.plugins.tooltip.borderColor = palette.tooltipBorder;
  state.chart.update('none');
}

function formatTimeLabel(label) {
  const text = String(label || '').trim();
  return text || new Date().toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function renderPlayerList(playerList) {
  if (!elements.playerList) {
    return;
  }

  const players = Array.isArray(playerList) ? playerList.filter(Boolean) : [];

  if (!players.length) {
    elements.playerList.innerHTML = '<div class="empty-state">No players online</div>';
    return;
  }

  elements.playerList.innerHTML = players
    .map((player) => `<span class="player-chip">${player}</span>`)
    .join('');
}

function initChart() {
  if (!window.Chart || !elements.chartCanvas) {
    return null;
  }

  const palette = getChartPalette();
  const context = elements.chartCanvas.getContext('2d');

  state.chart = new Chart(context, {
    type: 'line',
    data: {
      labels: chartState.labels,
      datasets: [
        {
          label: 'CPU (%)',
          data: chartState.cpuData,
          yAxisID: 'y',
          borderColor: palette.cpu,
          backgroundColor: hexToRgba(palette.cpu, 0.12),
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 8,
        },
        {
          label: 'RAM (MB)',
          data: chartState.ramData,
          yAxisID: 'y1',
          borderColor: palette.ram,
          backgroundColor: hexToRgba(palette.ram, 0.10),
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: palette.ticks,
            usePointStyle: true,
            boxWidth: 10,
            boxHeight: 10,
            padding: 18,
          },
        },
        tooltip: {
          backgroundColor: palette.tooltipBg,
          borderColor: palette.tooltipBorder,
          borderWidth: 1,
          titleColor: getCssVar('--text-color') || '#E5E7EB',
          bodyColor: getCssVar('--text-color') || '#E5E7EB',
          padding: 12,
          displayColors: true,
        },
      },
      scales: {
        x: {
          ticks: {
            color: palette.ticks,
            maxRotation: 0,
            autoSkip: true,
          },
          grid: {
            color: palette.grid,
          },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 100,
          ticks: {
            color: palette.ticks,
          },
          grid: {
            color: palette.grid,
          },
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          ticks: {
            color: palette.ticks,
          },
          grid: {
            drawOnChartArea: false,
          },
        },
      },
    },
  });

  return state.chart;
}

function buildHistorySignature(history) {
  return history
    .map((item) => `${item.time}|${item.cpu}|${item.ram}|${item.uptime}|${item.players}`)
    .join('~');
}

function applyHistoryToChart(history) {
  if (!state.chart) {
    return;
  }

  const series = Array.isArray(history) ? history.slice(-state.maxPoints) : [];
  const signature = buildHistorySignature(series);

  if (signature === state.lastHistorySignature) {
    return;
  }

  state.lastHistorySignature = signature;
  chartState.labels = series.map((item) => formatTimeLabel(item.time));
  chartState.cpuData = series.map((item) => normalizeNumber(item.cpu, 0));
  chartState.ramData = series.map((item) => normalizeNumber(item.ram, 0));

  state.chart.data.labels = [...chartState.labels];
  state.chart.data.datasets[0].data = [...chartState.cpuData];
  state.chart.data.datasets[1].data = [...chartState.ramData];
  state.chart.update();
}

function renderLoading() {
  state.hasData = false;
  setLoadingNodes(true);
  setConnectionState('loading', 'Connecting');
  if (elements.apiMessage) {
    elements.apiMessage.textContent = 'Waiting for the first server payload...';
  }
  if (elements.uptimeValue) elements.uptimeValue.textContent = '--';
  if (elements.serverIpValue) elements.serverIpValue.textContent = '--';
  if (elements.cpuValue) elements.cpuValue.textContent = '--';
  if (elements.ramValue) elements.ramValue.textContent = '--';
  if (elements.playersValue) elements.playersValue.textContent = '--';
  if (elements.serverValue) {
    elements.serverValue.textContent = '--';
    elements.serverValue.dataset.state = 'loading';
  }
  if (elements.timeValue) elements.timeValue.textContent = '--';
  renderPlayerList([]);
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

function renderData(payload) {
  const { latest, history } = unwrapApiPayload(payload);
  const snapshot = latest || (Array.isArray(history) && history.length ? history[history.length - 1] : null);

  if (!snapshot || snapshot.ready === false) {
    renderLoading();
    applyHistoryToChart(Array.isArray(history) ? history : []);
    return;
  }

  state.hasData = true;
  setLoadingNodes(false);

  const serverState = String(snapshot.status || 'offline').toLowerCase() === 'online' ? 'online' : 'offline';
  const players = Math.max(0, Math.floor(normalizeNumber(snapshot.players, 0)));
  const cpu = Math.max(0, normalizeNumber(snapshot.cpu, 0));
  const ram = Math.max(0, normalizeNumber(snapshot.ram, 0));
  const uptime = formatUptime(snapshot.uptime);
  const ip = normalizeString(snapshot.ip, 'dxir.live');

  setConnectionState(serverState, serverState === 'online' ? 'Online' : 'Offline');

  if (elements.uptimeValue) elements.uptimeValue.textContent = uptime;
  if (elements.serverIpValue) elements.serverIpValue.textContent = ip;
  if (elements.cpuValue) elements.cpuValue.textContent = `${cpu.toFixed(cpu % 1 === 0 ? 0 : 1)}%`;
  if (elements.ramValue) elements.ramValue.textContent = `${Math.round(ram)} MB`;
  if (elements.playersValue) elements.playersValue.textContent = String(players);
  if (elements.serverValue) {
    elements.serverValue.textContent = serverState === 'online' ? 'Online' : 'Offline';
    elements.serverValue.dataset.state = serverState;
  }
  if (elements.timeValue) elements.timeValue.textContent = snapshot.time || '--';
  if (elements.apiMessage) {
    elements.apiMessage.textContent = `History loaded: ${Array.isArray(history) ? history.length : 0} entries. Refreshing every 2 seconds.`;
  }

  renderPlayerList(snapshot.playerList);
  applyHistoryToChart(Array.isArray(history) ? history : [snapshot]);
}

async function fetchStats() {
  try {
    const response = await fetch('/api/data', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    renderData(payload);
  } catch (error) {
    if (!state.hasData) {
      renderLoading();
      setConnectionState('error', 'API error');
      if (elements.apiMessage) {
        elements.apiMessage.textContent = 'Unable to reach the API yet. Retrying automatically...';
      }
      return;
    }

    setConnectionState('error', 'API error');
    if (elements.apiMessage) {
      elements.apiMessage.textContent = `Using the last known values. Refresh error: ${error.message}`;
    }
  }
}

function startPolling() {
  fetchStats();
  state.timer = window.setInterval(fetchStats, 2000);
}

function bindEvents() {
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'light' ? 'dark' : 'light');
    });
  }
}

function bootstrapTheme() {
  applyTheme(getThemeFromStorage(), false);
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrapTheme();
  bindEvents();
  initChart();
  renderLoading();
  startPolling();
});


