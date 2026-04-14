const state = {
  hasData: false,
  lastPayload: null,
  timer: null,
};

const elements = {
  connectionStatus: document.getElementById('connectionStatus'),
  connectionLabel: document.getElementById('connectionLabel'),
  cpuValue: document.getElementById('cpuValue'),
  ramValue: document.getElementById('ramValue'),
  playersValue: document.getElementById('playersValue'),
  serverValue: document.getElementById('serverValue'),
  timeValue: document.getElementById('timeValue'),
  apiMessage: document.getElementById('apiMessage'),
};

function setConnectionState(stateName, label) {
  elements.connectionStatus.dataset.state = stateName;
  elements.connectionLabel.textContent = label;
}

function markLoading(isLoading) {
  const targets = [
    elements.cpuValue,
    elements.ramValue,
    elements.playersValue,
    elements.serverValue,
    elements.timeValue,
  ];

  targets.forEach((node) => {
    node.classList.toggle('is-loading', isLoading);
  });
}

function renderData(data) {
  if (!data || data.ready === false) {
    state.hasData = false;
    markLoading(true);
    setConnectionState('loading', 'Connecting');
    elements.apiMessage.textContent = 'Waiting for the first server payload...';
    elements.cpuValue.textContent = '--';
    elements.ramValue.textContent = '--';
    elements.playersValue.textContent = '--';
    elements.serverValue.textContent = '--';
    elements.serverValue.className = 'stat-card__value stat-card__value--status';
    elements.timeValue.textContent = '--';
    return;
  }

  state.hasData = true;
  state.lastPayload = data;
  markLoading(false);

  const serverState = String(data.status || 'offline').toLowerCase() === 'online' ? 'online' : 'offline';
  const players = Number.isFinite(Number(data.players)) ? Number(data.players) : 0;

  setConnectionState(serverState === 'online' ? 'online' : 'offline', serverState === 'online' ? 'Online' : 'Offline');

  elements.cpuValue.textContent = data.cpu || '--';
  elements.ramValue.textContent = data.ram || '--';
  elements.playersValue.textContent = String(players);
  elements.serverValue.textContent = serverState;
  elements.serverValue.className = `stat-card__value stat-card__value--status ${serverState}`;
  elements.timeValue.textContent = data.time || '--';
  elements.apiMessage.textContent = 'Auto-refreshing every 2 seconds.';
}

async function fetchStats() {
  try {
    const response = await fetch('/api/data', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (!state.hasData) {
        markLoading(true);
        setConnectionState('error', 'API error');
        elements.apiMessage.textContent = `Unable to reach the API yet (HTTP ${response.status}). Retrying automatically...`;
        elements.cpuValue.textContent = '--';
        elements.ramValue.textContent = '--';
        elements.playersValue.textContent = '--';
        elements.serverValue.textContent = 'offline';
        elements.serverValue.className = 'stat-card__value stat-card__value--status offline';
        elements.timeValue.textContent = '--';
        return;
      }

      setConnectionState('error', 'API error');
      elements.apiMessage.textContent = `API request failed (HTTP ${response.status}). Keeping the last known values on screen.`;
      return;
    }

    const payload = await response.json();
    renderData(payload);
  } catch (error) {
    if (!state.hasData) {
      markLoading(true);
      setConnectionState('error', 'API error');
      elements.apiMessage.textContent = 'Unable to reach the API yet. Retrying automatically...';
      elements.cpuValue.textContent = '--';
      elements.ramValue.textContent = '--';
      elements.playersValue.textContent = '--';
      elements.serverValue.textContent = 'offline';
      elements.serverValue.className = 'stat-card__value stat-card__value--status offline';
      elements.timeValue.textContent = '--';
      return;
    }

    setConnectionState('online', 'Live');
    elements.apiMessage.textContent = `Last update kept on screen. Refresh error: ${error.message}`;
  }
}

function startPolling() {
  fetchStats();
  state.timer = window.setInterval(fetchStats, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  renderData(null);
  startPolling();
});


