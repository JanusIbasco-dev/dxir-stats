const POLL_INTERVAL_MS = 2000;
const PLAYTIME_REFRESH_MS = 8000;
const PLAYTIME_TICK_MS = 1000;
const OFFLINE_THRESHOLD_MS = 8000;
const PLAYER_RENDER_THROTTLE_MS = 140;
const THEME_STORAGE_KEY = 'dxir-theme';

const state = {
  hasData: false,
  pollTimer: null,
  playtimeFetchTimer: null,
  playtimeTickTimer: null,
  chart: null,
  maxPoints: 50,
  lastSeenUpdate: 0,
  lastFreshAt: 0,
  lastChartSignature: '',
  theme: 'dark',
  players: [],
  playerNodeMap: new Map(),
  playerStatsMap: new Map(),
  playerAvatarCache: new Map(),
  selectedPlayerKey: '',
  pendingPlayerRender: null,
  playerRenderAt: 0,
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
  playerHoverTotal: document.getElementById('playerHoverTotal'),
  playerHoverDaily: document.getElementById('playerHoverDaily'),
  playerHoverWeekly: document.getElementById('playerHoverWeekly'),
  chartCanvas: document.getElementById('usageChart'),
  chartCard: document.getElementById('usageChart')?.closest('.chart-card'),
};

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
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (totalSeconds < 60) {
    return `${secs}s`;
  }

  return [hours > 0 ? `${hours}h` : null, `${minutes}m`, `${secs}s`].filter(Boolean).join(' ');
}

function formatSecondsAgo(timestampMs) {
  const delta = Math.max(0, Math.floor((Date.now() - Number(timestampMs || 0)) / 1000));
  if (delta < 60) {
    return `${delta}s ago`;
  }

  const mins = Math.floor(delta / 60);
  const secs = delta % 60;
  return `${mins}m ${secs}s ago`;
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
    elements.chartCard.style.opacity = isOffline ? '0.72' : '1';
  }
}

function getCssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function hexToRgba(hex, alpha) {
  const value = String(hex || '').trim().replace('#', '');
  if (value.length !== 6) {
    return `rgba(124, 58, 237, ${alpha})`;
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
    grid: getCssVar('--chart-grid') || 'rgba(148, 163, 184, 0.14)',
    ticks: getCssVar('--chart-ticks') || '#94A3B8',
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
  cpuDataset.backgroundColor = hexToRgba(palette.cpu, 0.15);
  ramDataset.borderColor = palette.ram;
  ramDataset.backgroundColor = hexToRgba(palette.ram, 0.12);

  state.chart.options.scales.x.grid.color = palette.grid;
  state.chart.options.scales.y.grid.color = palette.grid;
  state.chart.options.scales.x.ticks.color = palette.ticks;
  state.chart.options.scales.y.ticks.color = palette.ticks;
  state.chart.options.scales.y1.ticks.color = palette.ticks;
  state.chart.options.plugins.tooltip.backgroundColor = palette.tooltipBg;
  state.chart.options.plugins.tooltip.borderColor = palette.tooltipBorder;
  state.chart.update('none');
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
          backgroundColor: hexToRgba(palette.cpu, 0.15),
          fill: true,
          tension: 0.32,
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
          tension: 0.32,
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
          labels: { color: palette.ticks, usePointStyle: true, boxWidth: 10, boxHeight: 10, padding: 16 },
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
        x: { ticks: { color: palette.ticks }, grid: { color: palette.grid } },
        y: { beginAtZero: true, suggestedMax: 100, ticks: { color: palette.ticks }, grid: { color: palette.grid } },
        y1: { beginAtZero: true, position: 'right', ticks: { color: palette.ticks }, grid: { drawOnChartArea: false } },
      },
    },
  });
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
  chartState.labels = points.map((point) => normalizeString(point.time, '--'));
  chartState.cpuData = points.map((point) => normalizeNumber(point.cpu, 0));
  chartState.ramData = points.map((point) => normalizeNumber(point.ram, 0));

  state.chart.data.labels = [...chartState.labels];
  state.chart.data.datasets[0].data = [...chartState.cpuData];
  state.chart.data.datasets[1].data = [...chartState.ramData];
  state.chart.update();
}

function unwrapApiPayload(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  if (data && typeof data === 'object' && ('latest' in data || Array.isArray(data.history))) {
    return { latest: data.latest || null, history: Array.isArray(data.history) ? data.history : [] };
  }
  return { latest: data || null, history: Array.isArray(root.history) ? root.history : [] };
}

function normalizePlayer(rawPlayer) {
  if (!rawPlayer || typeof rawPlayer !== 'object') {
    return null;
  }

  const name = String(rawPlayer.name || rawPlayer.username || rawPlayer.player || '').trim();
  const uuid = String(rawPlayer.uuid || rawPlayer.id || '').trim();
  const key = uuid || name.toLowerCase();

  if (!name || !key) {
    return null;
  }

  return {
    key,
    uuid,
    name,
    status: String(rawPlayer.status || 'online').toLowerCase() === 'offline' ? 'offline' : 'online',
    ping: Math.max(0, normalizeNumber(rawPlayer.ping, 0)),
    isAFK: Boolean(rawPlayer.isAFK),
    sessionTime: Math.max(0, Math.floor(normalizeNumber(rawPlayer.sessionTime, 0))),
    totalPlaytime: Math.max(0, Math.floor(normalizeNumber(rawPlayer.totalPlaytime, 0))),
    dailyPlaytime: Math.max(0, Math.floor(normalizeNumber(rawPlayer.dailyPlaytime, 0))),
    weeklyPlaytime: Math.max(0, Math.floor(normalizeNumber(rawPlayer.weeklyPlaytime, 0))),
  };
}

function configureAvatarImage(image, player, size = 64) {
  if (!image || !player) {
    return;
  }

  const cache = state.playerAvatarCache.get(player.key) || {};
  const primarySource = player.uuid || player.name;
  const primary = `https://mc-heads.net/avatar/${encodeURIComponent(primarySource)}/${size}`;
  const fallback = `https://minotar.net/avatar/${encodeURIComponent(player.name)}/${size}`;

  image.alt = `${player.name} avatar`;
  image.dataset.avatarKey = player.key;
  image.classList.remove('loaded');

  if (cache.current && image.src === cache.current) {
    if (image.complete && image.naturalWidth > 0) {
      image.classList.add('loaded');
    }
    return;
  }

  const nextUrl = cache.current || primary;
  if (image.src !== nextUrl) {
    image.src = nextUrl;
  }

  image.onerror = () => {
    if (image.src !== fallback) {
      image.src = fallback;
      state.playerAvatarCache.set(player.key, { current: fallback });
      return;
    }

    image.onerror = null;
    image.classList.add('loaded');
  };

  image.onload = () => {
    state.playerAvatarCache.set(player.key, { current: image.src || primary });
    image.classList.add('loaded');
  };
}

function createPlayerNode(player) {
  const item = document.createElement('div');
  item.className = 'player-item player-item--entering';
  item.dataset.playerKey = player.key;
  item.tabIndex = 0;

  const left = document.createElement('div');
  left.className = 'player-item__left';

  const avatarShell = document.createElement('div');
  avatarShell.className = 'player-avatar-shell';

  const avatar = document.createElement('img');
  avatar.className = 'player-avatar';
  avatar.width = 40;
  avatar.height = 40;
  avatar.loading = 'lazy';
  avatar.decoding = 'async';
  avatar.referrerPolicy = 'no-referrer';
  configureAvatarImage(avatar, player, 64);

  const dot = document.createElement('span');
  dot.className = 'player-status-dot';

  avatarShell.appendChild(avatar);
  avatarShell.appendChild(dot);

  const info = document.createElement('div');
  info.className = 'player-info';

  const name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = player.name;

  const meta = document.createElement('span');
  meta.className = 'player-status';

  const session = document.createElement('span');
  session.className = 'player-session';

  info.appendChild(name);
  info.appendChild(meta);
  info.appendChild(session);

  left.appendChild(avatarShell);
  left.appendChild(info);

  const right = document.createElement('div');
  right.className = 'player-item__right';

  const ping = document.createElement('span');
  ping.className = 'player-ping-badge';
  right.appendChild(ping);

  item.appendChild(left);
  item.appendChild(right);

  item.addEventListener('mouseenter', () => setHoveredPlayer(player.key));
  item.addEventListener('focus', () => setHoveredPlayer(player.key));
  item.addEventListener('click', () => setHoveredPlayer(player.key));

  updatePlayerNode(item, player);
  window.setTimeout(() => item.classList.remove('player-item--entering'), 180);
  return item;
}

function updatePlayerNode(node, player) {
  if (!node) {
    return;
  }

  node.dataset.playerKey = player.key;
  node.classList.toggle('is-active', state.selectedPlayerKey === player.key);

  const statusNode = node.querySelector('.player-status');
  const sessionNode = node.querySelector('.player-session');
  const pingNode = node.querySelector('.player-ping-badge');
  const dotNode = node.querySelector('.player-status-dot');
  const avatarNode = node.querySelector('.player-avatar');
  const nameNode = node.querySelector('.player-name');

  if (nameNode && nameNode.textContent !== player.name) {
    nameNode.textContent = player.name;
  }

  if (statusNode) {
    const statusText = player.status === 'offline' ? 'Offline' : player.isAFK ? 'AFK' : 'Online';
    statusNode.textContent = statusText;
    statusNode.dataset.state = player.status;
  }

  if (sessionNode) {
    sessionNode.textContent = `Session: ${formatUptime(player.sessionTime)}`;
  }

  if (pingNode) {
    pingNode.textContent = player.ping > 0 ? `Ping: ${Math.round(player.ping)} ms` : 'Ping: --';
  }

  if (dotNode) {
    dotNode.dataset.state = player.status === 'offline' ? 'offline' : player.isAFK ? 'afk' : 'online';
  }

  if (avatarNode) {
    configureAvatarImage(avatarNode, player, 64);
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
  state.playerNodeMap.clear();
  state.selectedPlayerKey = '';
  renderHoverCard(null);
}

function setHoveredPlayer(playerKey) {
  state.selectedPlayerKey = playerKey;
  const player = state.players.find((entry) => entry.key === playerKey) || null;
  renderHoverCard(player);
  state.playerNodeMap.forEach((node, key) => {
    node.classList.toggle('is-active', key === playerKey);
  });
}

function renderHoverCard(player) {
  if (!elements.playerHoverCard || !elements.playerHoverPlaceholder || !elements.playerHoverContent) {
    return;
  }

  if (!player) {
    elements.playerHoverCard.classList.remove('is-active');
    elements.playerHoverPlaceholder.hidden = false;
    elements.playerHoverPlaceholder.textContent = state.players.length
      ? 'Hover a player to see live details'
      : 'No players online';
    elements.playerHoverContent.hidden = true;
    return;
  }

  elements.playerHoverCard.classList.add('is-active');
  elements.playerHoverPlaceholder.hidden = true;
  elements.playerHoverContent.hidden = false;

  if (elements.playerHoverAvatar) {
    configureAvatarImage(elements.playerHoverAvatar, player, 96);
  }

  if (elements.playerHoverName) {
    elements.playerHoverName.textContent = player.name;
  }

  if (elements.playerHoverStatus) {
    elements.playerHoverStatus.textContent = player.status === 'offline' ? 'Offline' : player.isAFK ? 'AFK' : 'Online';
  }

  if (elements.playerHoverPing) {
    elements.playerHoverPing.textContent = player.ping > 0 ? `${Math.round(player.ping)} ms` : '--';
  }

  if (elements.playerHoverSession) {
    elements.playerHoverSession.textContent = formatUptime(player.sessionTime);
  }

  if (elements.playerHoverTotal) {
    elements.playerHoverTotal.textContent = formatUptime(player.totalPlaytime);
  }

  if (elements.playerHoverDaily) {
    elements.playerHoverDaily.textContent = formatUptime(player.dailyPlaytime);
  }

  if (elements.playerHoverWeekly) {
    elements.playerHoverWeekly.textContent = formatUptime(player.weeklyPlaytime);
  }
}

function syncPlayerList(players) {
  if (!elements.playerList) {
    return;
  }

  if (!players.length) {
    renderEmptyPlayerState();
    return;
  }

  const nextKeys = new Set(players.map((player) => player.key));
  state.playerNodeMap.forEach((node, key) => {
    if (!nextKeys.has(key)) {
      node.classList.add('player-item--leaving');
      window.setTimeout(() => node.remove(), 180);
      state.playerNodeMap.delete(key);
      state.playerStatsMap.delete(key);
    }
  });

  players.forEach((player) => {
    let node = state.playerNodeMap.get(player.key);

    if (!node) {
      node = createPlayerNode(player);
      state.playerNodeMap.set(player.key, node);
    } else {
      updatePlayerNode(node, player);
    }

    elements.playerList.appendChild(node);
  });

  if (!state.selectedPlayerKey || !players.some((player) => player.key === state.selectedPlayerKey)) {
    state.selectedPlayerKey = players[0].key;
  }

  setHoveredPlayer(state.selectedPlayerKey);
}

function schedulePlayerRender(players) {
  state.pendingPlayerRender = players;
  const elapsed = Date.now() - state.playerRenderAt;
  const wait = elapsed >= PLAYER_RENDER_THROTTLE_MS ? 0 : PLAYER_RENDER_THROTTLE_MS - elapsed;

  window.setTimeout(() => {
    if (!state.pendingPlayerRender) {
      return;
    }

    const nextPlayers = state.pendingPlayerRender;
    state.pendingPlayerRender = null;
    state.playerRenderAt = Date.now();
    syncPlayerList(nextPlayers);
  }, wait);
}

async function refreshPlayerStats(players) {
  if (!players.length) {
    return;
  }

  await Promise.all(
    players.map(async (player) => {
      try {
        const response = await fetch(`/api/player/${encodeURIComponent(player.key)}/stats`, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        if (!payload || payload.success === false) {
          return;
        }

        const stats = {
          sessionTime: Math.max(0, Math.floor(normalizeNumber(payload.sessionTime, player.sessionTime))),
          totalPlaytime: Math.max(0, Math.floor(normalizeNumber(payload.total, player.totalPlaytime))),
          dailyPlaytime: Math.max(0, Math.floor(normalizeNumber(payload.daily, player.dailyPlaytime))),
          weeklyPlaytime: Math.max(0, Math.floor(normalizeNumber(payload.weekly, player.weeklyPlaytime))),
          isAFK: Boolean(payload.isAFK),
          isOnline: Boolean(payload.isOnline),
          fetchedAt: Date.now(),
        };

        state.playerStatsMap.set(player.key, stats);
      } catch (error) {
        // Keep previous stats on network errors.
      }
    })
  );

  state.players = state.players.map((player) => {
    const extra = state.playerStatsMap.get(player.key);
    return extra
      ? {
          ...player,
          sessionTime: extra.sessionTime,
          totalPlaytime: extra.totalPlaytime,
          dailyPlaytime: extra.dailyPlaytime,
          weeklyPlaytime: extra.weeklyPlaytime,
          isAFK: extra.isAFK,
        }
      : player;
  });

  schedulePlayerRender(state.players);
}

function tickPlayerCounters() {
  if (!state.players.length) {
    return;
  }

  let changed = false;

  state.players = state.players.map((player) => {
    const stats = state.playerStatsMap.get(player.key);
    if (!stats || !stats.isOnline || stats.isAFK) {
      return player;
    }

    changed = true;
    stats.sessionTime += 1;
    stats.totalPlaytime += 1;
    stats.dailyPlaytime += 1;
    stats.weeklyPlaytime += 1;

    return {
      ...player,
      sessionTime: stats.sessionTime,
      totalPlaytime: stats.totalPlaytime,
      dailyPlaytime: stats.dailyPlaytime,
      weeklyPlaytime: stats.weeklyPlaytime,
    };
  });

  if (changed) {
    schedulePlayerRender(state.players);
  }
}

function renderLoading() {
  state.hasData = false;
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
  setChartOpacity(false);
  renderEmptyPlayerState();
}

function markOffline() {
  setConnectionState('offline', 'Offline');
  setChartOpacity(true);

  if (elements.serverValue) {
    elements.serverValue.textContent = 'Offline';
    elements.serverValue.dataset.state = 'offline';
  }

  if (elements.apiMessage) {
    const text = state.lastFreshAt > 0
      ? `No recent data received. Last update ${formatSecondsAgo(state.lastFreshAt)}.`
      : 'No recent data received';
    elements.apiMessage.textContent = text;
  }
}

function renderSnapshot(snapshot) {
  const cpu = Math.max(0, normalizeNumber(snapshot.cpu, 0));
  const ramUsed = Math.max(0, normalizeNumber(snapshot.ramUsed, normalizeNumber(snapshot.ram, 0) / 1024));
  const ramMax = Math.max(0, normalizeNumber(snapshot.ramMax, 0));
  const players = Math.max(0, Math.floor(normalizeNumber(snapshot.players, 0)));
  const status = String(snapshot.status || 'offline').toLowerCase() === 'online' ? 'online' : 'offline';

  if (elements.uptimeValue) elements.uptimeValue.textContent = formatUptime(snapshot.uptime);
  if (elements.serverIpValue) elements.serverIpValue.textContent = normalizeString(snapshot.ip, 'dxir.live');
  if (elements.cpuValue) elements.cpuValue.textContent = `${cpu.toFixed(cpu % 1 === 0 ? 0 : 1)}%`;
  if (elements.ramValue) elements.ramValue.textContent = `${ramUsed.toFixed(2)} / ${ramMax.toFixed(2)} GB`;
  if (elements.playersValue) elements.playersValue.textContent = String(players);
  if (elements.serverValue) {
    elements.serverValue.textContent = status === 'online' ? 'Online' : 'Offline';
    elements.serverValue.dataset.state = status;
  }
  if (elements.timeValue) elements.timeValue.textContent = snapshot.time || '--';

  setConnectionState(status, status === 'online' ? 'Online' : 'Offline');
  setChartOpacity(status !== 'online');

  if (elements.apiMessage) {
    elements.apiMessage.textContent = `Live data received. Last update ${formatSecondsAgo(snapshot.lastUpdate)}.`;
  }

  const playersFromApi = Array.isArray(snapshot.playerList) ? snapshot.playerList.map(normalizePlayer).filter(Boolean) : [];
  state.players = playersFromApi;

  state.players.forEach((player) => {
    state.playerStatsMap.set(player.key, {
      sessionTime: player.sessionTime,
      totalPlaytime: player.totalPlaytime,
      dailyPlaytime: player.dailyPlaytime,
      weeklyPlaytime: player.weeklyPlaytime,
      isAFK: player.isAFK,
      isOnline: player.status === 'online',
      fetchedAt: Date.now(),
    });
  });

  schedulePlayerRender(state.players);
}

function renderData(payload) {
  const { latest, history } = unwrapApiPayload(payload);
  const snapshot = latest && typeof latest === 'object' ? latest : null;

  if (!snapshot || !Number.isFinite(Number(snapshot.lastUpdate)) || Number(snapshot.lastUpdate) <= 0) {
    if (!state.hasData) {
      renderLoading();
    } else if (Date.now() - state.lastFreshAt > OFFLINE_THRESHOLD_MS) {
      markOffline();
    }
    return;
  }

  const snapshotUpdate = Number(snapshot.lastUpdate);

  if (snapshotUpdate === state.lastSeenUpdate) {
    if (Date.now() - state.lastFreshAt > OFFLINE_THRESHOLD_MS) {
      markOffline();
    }
    return;
  }

  state.hasData = true;
  state.lastSeenUpdate = snapshotUpdate;
  state.lastFreshAt = Date.now();

  renderSnapshot(snapshot);
  applyHistoryToChart(Array.isArray(history) && history.length ? history : [snapshot]);
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

    if (Date.now() - state.lastFreshAt > OFFLINE_THRESHOLD_MS) {
      markOffline();
    }
  }
}

function startPolling() {
  fetchStats();
  state.pollTimer = window.setInterval(fetchStats, POLL_INTERVAL_MS);
  state.playtimeFetchTimer = window.setInterval(() => refreshPlayerStats(state.players), PLAYTIME_REFRESH_MS);
  state.playtimeTickTimer = window.setInterval(tickPlayerCounters, PLAYTIME_TICK_MS);
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

    state.selectedPlayerKey = '';
    renderHoverCard(null);
    state.playerNodeMap.forEach((node) => node.classList.remove('is-active'));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getThemeFromStorage(), false);
  bindEvents();
  initChart();
  renderLoading();
  startPolling();
});

