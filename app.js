const state = {
  hasData: false,
  timer: null,
  chart: null,
  maxPoints: 50,
  lastSeenUpdate: 0,
  lastChartSignature: '',
  theme: 'dark',
  playerRecords: [],
  playerSessions: new Map(),
  playerPreviewName: '',
  playerPinnedName: '',
  playerTicker: null,
};

let previousPlayers = [];

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
  playerHoverCard: document.getElementById('playerHoverCard'),
  playerHoverPlaceholder: document.getElementById('playerHoverPlaceholder'),
  playerHoverContent: document.getElementById('playerHoverContent'),
  playerHoverAvatar: document.getElementById('playerHoverAvatar'),
  playerHoverName: document.getElementById('playerHoverName'),
  playerHoverStatus: document.getElementById('playerHoverStatus'),
  playerHoverPing: document.getElementById('playerHoverPing'),
  playerHoverSession: document.getElementById('playerHoverSession'),
  chartCanvas: document.getElementById('usageChart'),
  chartCard: document.getElementById('usageChart')?.closest('.chart-card'),
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

function formatUptime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (totalSeconds < 60) {
    return `${secs}s`;
  }

  return [hours > 0 ? `${hours}h` : null, `${minutes}m`, `${secs}s`]
    .filter(Boolean)
    .join(' ');
}

function formatSessionTime(joinedAt) {
  return `Online for ${formatUptime((Date.now() - Number(joinedAt || 0)) / 1000)}`;
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

function setChartOpacity(isOffline) {
  if (elements.chartCard) {
    elements.chartCard.style.opacity = isOffline ? '0.72' : '1';
  }
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

function hexToRgba(hex, alpha) {
  const normalized = String(hex || '').trim().replace('#', '');

  if (normalized.length !== 6) {
    return `rgba(124, 58, 237, ${alpha})`;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getChartPalette() {
  return {
    cpu: getCssVar('--chart-cpu') || '#7C3AED',
    ram: getCssVar('--chart-ram') || '#8B5CF6',
    grid: getCssVar('--chart-grid') || 'rgba(148, 163, 184, 0.14)',
    ticks: getCssVar('--chart-ticks') || '#9CA3AF',
    tooltipBg: getCssVar('--chart-tooltip-bg') || '#111827',
    tooltipBorder: getCssVar('--chart-tooltip-border') || 'rgba(148, 163, 184, 0.2)',
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

function getPlayerRecordName(player) {
  if (typeof player === 'string') {
    return player.trim();
  }

  if (!player || typeof player !== 'object') {
    return '';
  }

  return String(player.name || player.player || player.username || '').trim();
}

function getPlayerRecordPing(player) {
  if (!player || typeof player !== 'object') {
    return 0;
  }

  return Math.max(0, normalizeNumber(player.ping ?? player.latency ?? player.ms, 0));
}

function getPlayerAvatarUrl(username) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(String(username || '').trim())}/64`;
}

function getPlayerAvatarFallbackUrl(username) {
  return `https://minotar.net/avatar/${encodeURIComponent(String(username || '').trim())}/64`;
}

function configureAvatarImage(image, username, size = 64) {
  if (!image) {
    return;
  }

  const normalizedName = String(username || '').trim();
  const primary = `https://mc-heads.net/avatar/${encodeURIComponent(normalizedName)}/${size}`;
  const fallback = `https://minotar.net/avatar/${encodeURIComponent(normalizedName)}/${size}`;
  let usedFallback = false;

  image.classList.remove('loaded');
  image.src = primary;
  image.onload = () => {
    image.classList.add('loaded');
  };
  image.onerror = () => {
    if (!usedFallback) {
      usedFallback = true;
      image.src = fallback;
      return;
    }

    image.onerror = null;
    image.classList.add('loaded');
  };

  if (image.complete && image.naturalWidth > 0) {
    image.classList.add('loaded');
  }
}

function normalizePlayerList(playerList) {
  return Array.isArray(playerList)
    ? playerList
      .map((player) => {
        const name = getPlayerRecordName(player);

        if (!name) {
          return null;
        }

        return {
          name,
          ping: getPlayerRecordPing(player),
        };
      })
      .filter(Boolean)
    : [];
}

function setPlayerHoverCardPlaceholder(message = 'Hover a player to see live details') {
  if (elements.playerHoverCard) {
    elements.playerHoverCard.classList.remove('is-active');
    elements.playerHoverCard.dataset.player = '';
  }

  if (elements.playerHoverPlaceholder) {
    elements.playerHoverPlaceholder.textContent = message;
    elements.playerHoverPlaceholder.hidden = false;
  }

  if (elements.playerHoverContent) {
    elements.playerHoverContent.hidden = true;
  }
}

function syncPlayerPreviewStyles(playerName) {
  if (!elements.playerList) {
    return;
  }

  elements.playerList.querySelectorAll('.player-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.player === playerName);
  });
}

function renderPlayerHoverCard(playerName) {
  const record = state.playerRecords.find((player) => player.name === playerName);

  if (!record) {
    setPlayerHoverCardPlaceholder('Hover a player to see live details');
    syncPlayerPreviewStyles('');
    return;
  }

  const joinedAt = state.playerSessions.get(playerName) || Date.now();
  const sessionText = formatSessionTime(joinedAt);
  const pingText = record.ping > 0 ? `${Math.round(record.ping)} ms` : '—';

  if (elements.playerHoverCard) {
    elements.playerHoverCard.classList.add('is-active');
    elements.playerHoverCard.dataset.player = playerName;
  }

  if (elements.playerHoverPlaceholder) {
    elements.playerHoverPlaceholder.hidden = true;
  }

  if (elements.playerHoverContent) {
    elements.playerHoverContent.hidden = false;
  }

  if (elements.playerHoverAvatar) {
    configureAvatarImage(elements.playerHoverAvatar, playerName, 96);
  }

  if (elements.playerHoverName) {
    elements.playerHoverName.textContent = playerName;
  }

  if (elements.playerHoverStatus) {
    elements.playerHoverStatus.textContent = 'Online';
  }

  if (elements.playerHoverPing) {
    elements.playerHoverPing.textContent = pingText;
  }

  if (elements.playerHoverSession) {
    elements.playerHoverSession.textContent = sessionText;
  }

  syncPlayerPreviewStyles(playerName);
}

function setPlayerPreview(playerName, pinned = false) {
  const normalizedName = String(playerName || '').trim();

  if (!normalizedName) {
    return;
  }

  state.playerPreviewName = normalizedName;

  if (pinned) {
    state.playerPinnedName = normalizedName;
  }

  renderPlayerHoverCard(normalizedName);
}

function clearPlayerPreview() {
  state.playerPinnedName = '';
  state.playerPreviewName = '';

  if (state.playerRecords.length) {
    setPlayerHoverCardPlaceholder('Hover a player to see live details');
    syncPlayerPreviewStyles('');
  } else {
    setPlayerHoverCardPlaceholder('No players online');
  }
}

function buildPlayerRecordSignature(players) {
  return players.map((player) => `${player.name}:${player.ping}`).join('|');
}

function ensurePlayerSessions(players) {
  const nextNames = new Set(players.map((player) => player.name));

  Array.from(state.playerSessions.keys()).forEach((name) => {
    if (!nextNames.has(name)) {
      state.playerSessions.delete(name);
    }
  });

  players.forEach((player) => {
    if (!state.playerSessions.has(player.name)) {
      state.playerSessions.set(player.name, Date.now());
    }
  });
}

function createPlayerItem(player) {
  const item = document.createElement('div');
  item.className = 'player-item';
  item.dataset.player = player.name;
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.setAttribute('aria-label', `${player.name} profile`);

  const left = document.createElement('div');
  left.className = 'player-item__left';

  const statusDot = document.createElement('span');
  statusDot.className = 'player-status-dot';
  statusDot.setAttribute('aria-hidden', 'true');

  const avatarShell = document.createElement('div');
  avatarShell.className = 'player-avatar-shell';

  const avatar = document.createElement('img');
  avatar.className = 'player-avatar';
  avatar.alt = `${player.name} avatar`;
  avatar.width = 38;
  avatar.height = 38;
  avatar.loading = 'lazy';
  avatar.decoding = 'async';
  avatar.referrerPolicy = 'no-referrer';
  configureAvatarImage(avatar, player.name, 64);

  avatarShell.appendChild(avatar);
  avatarShell.appendChild(statusDot);

  const info = document.createElement('div');
  info.className = 'player-info';

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = player.name;

  const session = document.createElement('span');
  session.className = 'player-session';
  session.dataset.playerSessionName = player.name;
  session.textContent = 'Online for 0s';

  info.appendChild(name);
  info.appendChild(session);
  left.appendChild(avatarShell);
  left.appendChild(info);

  const right = document.createElement('div');
  right.className = 'player-item__right';

  const ping = document.createElement('span');
  ping.className = 'player-ping-badge';
  ping.dataset.playerPingName = player.name;
  ping.textContent = player.ping > 0 ? `${Math.round(player.ping)} ms` : 'Ping: —';

  right.appendChild(ping);
  item.appendChild(left);
  item.appendChild(right);

  const activate = () => setPlayerPreview(player.name);
  const pin = () => setPlayerPreview(player.name, true);

  item.addEventListener('mouseenter', activate);
  item.addEventListener('focus', activate);
  item.addEventListener('click', pin);
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pin();
    }
  });

  return item;
}

function updatePlayerItem(item, player) {
  if (!item) {
    return;
  }

  item.dataset.player = player.name;

  const avatar = item.querySelector('.player-avatar');
  if (avatar) {
    avatar.alt = `${player.name} avatar`;
    configureAvatarImage(avatar, player.name, 64);
  }

  const name = item.querySelector('.player-name');
  if (name) {
    name.textContent = player.name;
  }

  const session = item.querySelector('.player-session');
  if (session) {
    session.dataset.playerSessionName = player.name;
    session.textContent = formatSessionTime(state.playerSessions.get(player.name) || Date.now());
  }

  const ping = item.querySelector('.player-ping-badge');
  if (ping) {
    ping.dataset.playerPingName = player.name;
    ping.textContent = player.ping > 0 ? `${Math.round(player.ping)} ms` : 'Ping: —';
  }
}

function renderEmptyPlayerState() {
  if (!elements.playerList) {
    return;
  }

  const empty = document.createElement('div');
  empty.className = 'empty-state empty-state--players';
  empty.textContent = 'No players online';
  elements.playerList.replaceChildren(empty);
  setPlayerHoverCardPlaceholder('No players online');
}

function syncPlayerListDom(players) {
  if (!elements.playerList) {
    return;
  }

  if (!players.length) {
    state.playerRecords = [];
    previousPlayers = [];
    state.playerSessions.clear();
    renderEmptyPlayerState();
    return;
  }

  const listElement = elements.playerList;
  const existingItems = new Map(
    Array.from(listElement.querySelectorAll('.player-item')).map((item) => [item.dataset.player || '', item])
  );
  const nextNames = new Set(players.map((player) => player.name));

  existingItems.forEach((item, name) => {
    if (!nextNames.has(name)) {
      item.remove();
    }
  });

  const fragment = document.createDocumentFragment();

  players.forEach((player) => {
    let item = existingItems.get(player.name);

    if (!item) {
      item = createPlayerItem(player);
      item.classList.add('player-item--entering');
      window.setTimeout(() => item.classList.remove('player-item--entering'), 180);
    } else {
      updatePlayerItem(item, player);
    }

    fragment.appendChild(item);
  });

  listElement.appendChild(fragment);
}

function renderPlayerList(playerList) {
  if (!elements.playerList) {
    return;
  }

  const players = normalizePlayerList(playerList);
  const isSame = JSON.stringify(previousPlayers) === JSON.stringify(players);

  state.playerRecords = players;
  ensurePlayerSessions(players);

  if (!isSame) {
    previousPlayers = [...players];
    syncPlayerListDom(players);
  }

  if (!players.length) {
    clearPlayerPreview();
    return;
  }

  const currentPinnedExists = state.playerPinnedName && players.some((player) => player.name === state.playerPinnedName);
  const currentPreviewExists = state.playerPreviewName && players.some((player) => player.name === state.playerPreviewName);
  const preferredPreview = currentPinnedExists
    ? state.playerPinnedName
    : currentPreviewExists
      ? state.playerPreviewName
      : '';

  if (preferredPreview) {
    renderPlayerHoverCard(preferredPreview);
    return;
  }

  state.playerPinnedName = '';
  state.playerPreviewName = '';
  setPlayerHoverCardPlaceholder('Hover a player to see live details');
}

function updatePlayerSessionTimes() {
  if (!elements.playerList) {
    return;
  }

  const now = Date.now();

  elements.playerList.querySelectorAll('.player-session').forEach((node) => {
    const playerName = node.dataset.playerSessionName || '';
    const joinedAt = state.playerSessions.get(playerName);

    if (joinedAt) {
      node.textContent = `Online for ${formatUptime((now - joinedAt) / 1000)}`;
    }
  });

  if (state.playerPreviewName) {
    const previewRecord = state.playerRecords.find((player) => player.name === state.playerPreviewName);
    if (previewRecord) {
      renderPlayerHoverCard(previewRecord.name);
    }
  }
}

function startPlayerTicker() {
  if (state.playerTicker) {
    window.clearInterval(state.playerTicker);
  }

  state.playerTicker = window.setInterval(updatePlayerSessionTimes, 1000);
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
          titleColor: getCssVar('--text-primary') || '#E5E7EB',
          bodyColor: getCssVar('--text-primary') || '#E5E7EB',
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
  return history.map((item) => `${item.lastUpdate}|${item.time}|${item.cpu}|${item.ram}|${item.uptime}|${item.players}`).join('~');
}

function applyHistoryToChart(history) {
  if (!state.chart) {
    return;
  }

  const series = Array.isArray(history) ? history.slice(-state.maxPoints) : [];
  const signature = buildHistorySignature(series);

  if (signature === state.lastChartSignature) {
    return;
  }

  state.lastChartSignature = signature;
  chartState.labels = series.map((item) => item.time || '--');
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
  setChartOpacity(false);

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

function renderSnapshotValues(snapshot) {
  const players = Math.max(0, Math.floor(normalizeNumber(snapshot.players, 0)));
  const cpu = Math.max(0, normalizeNumber(snapshot.cpu, 0));
  const ram = Math.max(0, normalizeNumber(snapshot.ram, 0));
  const ramUsed = Math.max(0, normalizeNumber(snapshot.ramUsed, ram / 1024));
  const ramMax = Math.max(0, normalizeNumber(snapshot.ramMax, 0));
  const status = String(snapshot.status || 'offline').toLowerCase() === 'online' ? 'Online' : 'Offline';
  const ip = normalizeString(snapshot.ip, 'dxir.live');

  if (elements.uptimeValue) elements.uptimeValue.textContent = formatUptime(snapshot.uptime);
  if (elements.serverIpValue) elements.serverIpValue.textContent = ip;
  if (elements.cpuValue) elements.cpuValue.textContent = `${cpu.toFixed(cpu % 1 === 0 ? 0 : 1)}%`;
  if (elements.ramValue) {
    elements.ramValue.textContent = `${ramUsed.toFixed(2)} / ${ramMax.toFixed(2)} GB`;
  }
  if (elements.playersValue) elements.playersValue.textContent = String(players);
  if (elements.serverValue) {
    elements.serverValue.textContent = status;
    elements.serverValue.dataset.state = status.toLowerCase();
  }
  if (elements.timeValue) elements.timeValue.textContent = snapshot.time || '--';

  return { players, cpu, ram, status, ip };
}

function markOffline() {
  setConnectionState('offline', 'Offline');
  setChartOpacity(true);

  if (elements.serverValue) {
    elements.serverValue.textContent = 'Offline';
    elements.serverValue.dataset.state = 'offline';
  }

  if (elements.apiMessage) {
    elements.apiMessage.textContent = 'No recent data received';
  }
}

function renderData(payload) {
  const { latest, history } = unwrapApiPayload(payload);
  const snapshot = latest || (Array.isArray(history) && history.length ? history[history.length - 1] : null);

  if (!snapshot || snapshot.ready === false || !Number.isFinite(Number(snapshot.lastUpdate)) || Number(snapshot.lastUpdate) <= 0) {
    if (!state.hasData) {
      renderLoading();
    } else {
      markOffline();
    }
    return;
  }

  if (snapshot.lastUpdate === state.lastSeenUpdate) {
    markOffline();
    return;
  }

  state.hasData = true;
  state.lastSeenUpdate = snapshot.lastUpdate;
  setLoadingNodes(false);

  const { status } = renderSnapshotValues(snapshot);
  setConnectionState(status.toLowerCase(), status);
  setChartOpacity(false);

  if (elements.apiMessage) {
    elements.apiMessage.textContent = 'Live data received from API.';
  }

  renderPlayerList(snapshot.playerList);
  applyHistoryToChart(Array.isArray(history) && history.length ? history : [snapshot]);
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

    markOffline();
  }
}

function startPolling() {
  fetchStats();
  startPlayerTicker();
  state.timer = window.setInterval(fetchStats, 2000);
}

function bindEvents() {
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'light' ? 'dark' : 'light');
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target;

    if (elements.playerList?.contains(target) || elements.playerHoverCard?.contains(target)) {
      return;
    }

    if (!state.playerPinnedName) {
      return;
    }

    state.playerPinnedName = '';

    if (state.playerPreviewName && state.playerRecords.some((player) => player.name === state.playerPreviewName)) {
      renderPlayerHoverCard(state.playerPreviewName);
    } else {
      setPlayerHoverCardPlaceholder(state.playerRecords.length ? 'Hover a player to see live details' : 'No players online');
    }
  });
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

