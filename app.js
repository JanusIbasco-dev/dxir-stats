const state = {
  hasData: false,
  timer: null,
  chart: null,
  maxPoints: 30,
};

const elements = {
  connectionStatus: document.getElementById('connectionStatus'),
  connectionLabel: document.getElementById('connectionLabel'),
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
  elements.connectionStatus.dataset.state = stateName;
  elements.connectionLabel.textContent = label;
}

function setLoadingNodes(isLoading) {
  [elements.uptimeValue, elements.serverIpValue, elements.cpuValue, elements.ramValue, elements.playersValue, elements.serverValue, elements.timeValue].forEach((node) => {
    if (node) {
      node.classList.toggle('is-loading', isLoading);
    }
  });
}

function formatTimeLabel() {
  return new Date().toLocaleTimeString([], {
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
          borderColor: '#6C5CE7',
          backgroundColor: 'rgba(108, 92, 231, 0.12)',
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
          borderColor: '#8B5CF6',
          backgroundColor: 'rgba(139, 92, 246, 0.10)',
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
            color: '#9CA3AF',
            usePointStyle: true,
            boxWidth: 10,
            boxHeight: 10,
            padding: 18,
          },
        },
        tooltip: {
          backgroundColor: '#111827',
          borderColor: 'rgba(148, 163, 184, 0.2)',
          borderWidth: 1,
          titleColor: '#E5E7EB',
          bodyColor: '#E5E7EB',
          padding: 12,
          displayColors: true,
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#9CA3AF',
            maxRotation: 0,
            autoSkip: true,
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.10)',
          },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 100,
          ticks: {
            color: '#9CA3AF',
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.10)',
          },
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          ticks: {
            color: '#9CA3AF',
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

function pushChartPoint(cpu, ram, label = formatTimeLabel()) {
  chartState.labels.push(label);
  chartState.cpuData.push(cpu);
  chartState.ramData.push(ram);

  while (chartState.labels.length > state.maxPoints) {
    chartState.labels.shift();
    chartState.cpuData.shift();
    chartState.ramData.shift();
  }

  if (state.chart) {
    state.chart.update();
  }
}

function renderLoading() {
  state.hasData = false;
  setLoadingNodes(true);
  setConnectionState('loading', 'Connecting');
  elements.apiMessage.textContent = 'Waiting for the first server payload...';
  elements.uptimeValue.textContent = '--';
  elements.serverIpValue.textContent = '--';
  elements.cpuValue.textContent = '--';
  elements.ramValue.textContent = '--';
  elements.playersValue.textContent = '--';
  elements.serverValue.textContent = '--';
  elements.serverValue.dataset.state = 'loading';
  elements.timeValue.textContent = '--';
  renderPlayerList([]);
}

function renderData(data) {
  if (!data || data.ready === false) {
    renderLoading();
    return;
  }

  state.hasData = true;
  setLoadingNodes(false);

  const serverState = String(data.status || 'offline').toLowerCase() === 'online' ? 'online' : 'offline';
  const players = Math.max(0, Math.floor(normalizeNumber(data.players, 0)));
  const cpu = Math.max(0, normalizeNumber(data.cpu, 0));
  const ram = Math.max(0, normalizeNumber(data.ram, 0));
  const uptime = formatUptime(data.uptime);
  const ip = String(data.ip || 'dxir.live').trim();

  setConnectionState(serverState, serverState === 'online' ? 'Online' : 'Offline');

  elements.uptimeValue.textContent = uptime;
  elements.serverIpValue.textContent = ip;
  elements.cpuValue.textContent = `${cpu.toFixed(cpu % 1 === 0 ? 0 : 1)}%`;
  elements.ramValue.textContent = `${Math.round(ram)} MB`;
  elements.playersValue.textContent = String(players);
  elements.serverValue.textContent = serverState === 'online' ? 'Online' : 'Offline';
  elements.serverValue.dataset.state = serverState;
  elements.timeValue.textContent = data.time || '--';
  elements.apiMessage.textContent = 'Refreshing every 2 seconds.';

  renderPlayerList(data.playerList);
  pushChartPoint(cpu, ram, formatTimeLabel());
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
      elements.apiMessage.textContent = `Unable to reach the API yet. Retrying automatically...`;
      return;
    }

    setConnectionState('error', 'API error');
    elements.apiMessage.textContent = `Using the last known values. Refresh error: ${error.message}`;
  }
}

function startPolling() {
  fetchStats();
  state.timer = window.setInterval(fetchStats, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  initChart();
  renderLoading();
  startPolling();
});




