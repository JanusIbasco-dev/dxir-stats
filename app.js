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
  players: [],
  expandedPlayers: new Set(),
  playerNodeMap: new Map(),
  playerAvatarCache: new Map(),
  lastPlayersSignature: '',
  leaderboardAvatarCache: new Map(),
  leaderboardsReady: false,
  leaderboardObserver: null,
  leaderboards: {
    kills: { signature: '' },
    balance: { signature: '' },
    bounty: { signature: '' },
    earnings: { signature: '' },
  },
  uiFrameId: 0,
  lastUiFrameAt: 0,
  lastStaleCheckAt: 0,
  lastFallbackCheckAt: 0,
  lastChartAnimateAt: 0,
  targetStats: {
    cpu: 0,
    ramUsed: 0,
    ramMax: 0,
    players: 0,
    uptime: 0,
    uptimeReceivedPerf: 0,
  },
  animatedStats: {
    cpu: 0,
    ramUsed: 0,
    ramMax: 0,
    players: 0,
  },
  currentSnapshot: null,
  chartTargetPoint: {
    cpu: 0,
    ram: 0,
  },
  chartLastUpdateKey: 0,
  chartStreamAccumulator: 0,
  lastSnapshotUpdateAt: 0,
  playerTransitionTimers: new Map(),
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
  playersValue: document.getElementById('playersValue'),
  playersCountMirror: document.getElementById('playersCountMirror'),
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
  playerList: document.getElementById('playerList'),
  chartCanvas: document.getElementById('usageChart'),
  chartCard: document.querySelector('.chart-card'),
  leaderboardLists: {
    kills: document.getElementById('killsLeaderboardList'),
    balance: document.getElementById('balanceLeaderboardList'),
    bounty: document.getElementById('bountyLeaderboardList'),
    earnings: document.getElementById('earningsLeaderboardList'),
  },
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

function normalizePlayer(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const name = String(raw.name || raw.username || raw.player || '').trim();
  const uuid = String(raw.uuid || raw.id || '').trim();
  const key = uuid || name.toLowerCase();

  if (!name || !key) {
    return null;
  }

  return {
    key,
    uuid,
    name,
    avatarUrl: String(raw.avatarUrl || '').trim(),
    ping: Math.max(0, normalizeNumber(raw.ping, 0)),
    status: String(raw.status || 'online').toLowerCase() === 'offline' ? 'offline' : 'online',
    isAFK: Boolean(raw.isAFK),
    sessionTime: Math.max(0, Math.floor(normalizeNumber(raw.sessionTime, 0))),
    totalPlaytime: Math.max(0, Math.floor(normalizeNumber(raw.totalPlaytime, 0))),
    dailyPlaytime: Math.max(0, Math.floor(normalizeNumber(raw.dailyPlaytime, 0))),
    weeklyPlaytime: Math.max(0, Math.floor(normalizeNumber(raw.weeklyPlaytime, 0))),
    counterUpdatedPerf: performance.now(),
  };
}

function buildPlayersSignature(players) {
  return players
    .map((player) => {
      const statusState = player.status === 'offline' ? 'offline' : player.isAFK ? 'afk' : 'online';
      return [
        player.key,
        player.name,
        player.uuid,
        statusState,
        Math.round(player.ping || 0),
        Math.floor(player.sessionTime || 0),
        Math.floor(player.totalPlaytime || 0),
        Math.floor(player.dailyPlaytime || 0),
        Math.floor(player.weeklyPlaytime || 0),
      ].join(':');
    })
    .join('|');
}

function configureAvatarImage(image, cacheMap, cacheKey, sourceId, fallbackName, size = 64, cachedAvatarUrl = '') {
  if (!image || !cacheMap || !cacheKey) {
    return;
  }

  const normalizedUuid = String(sourceId || '').trim().replace(/-/g, '').toLowerCase();
  const hasMojangUuid = /^[0-9a-f]{32}$/.test(normalizedUuid);

  const primary = cachedAvatarUrl
    ? String(cachedAvatarUrl).trim()
    : hasMojangUuid
      ? `https://mc-heads.net/avatar/${encodeURIComponent(normalizedUuid)}/${size}`
      : '';
  const fallback = fallbackName
    ? `https://minotar.net/avatar/${encodeURIComponent(fallbackName)}/${size}`
    : '';
  const defaultAvatar = '/minecraft-logo.svg';
  const cached = cacheMap.get(cacheKey) || '';
  const next = cached || primary || fallback || defaultAvatar;

  if (!next) {
    return;
  }

  if (image.src === next && image.classList.contains('loaded')) {
    return;
  }

  const shouldReplaceSource = image.src !== next;
  if (shouldReplaceSource) {
    image.classList.remove('loaded');
    image.src = next;
  }

  image.onload = () => {
    cacheMap.set(cacheKey, image.src || next);
    image.classList.add('loaded');
  };

  image.onerror = () => {
    if (fallback && image.src !== fallback) {
      cacheMap.set(cacheKey, fallback);
      image.src = fallback;
      return;
    }

    if (image.src !== defaultAvatar) {
      cacheMap.set(cacheKey, defaultAvatar);
      image.src = defaultAvatar;
      return;
    }

    image.onerror = null;
    image.classList.add('loaded');
  };

  if (image.complete && image.naturalWidth > 0) {
    cacheMap.set(cacheKey, image.src || next);
    image.classList.add('loaded');
  }
}

function createPlayerCard(player) {
  const card = document.createElement('article');
  card.className = 'player-card';
  card.dataset.playerKey = player.key;

  const top = document.createElement('div');
  top.className = 'player-card__top';

  const avatar = document.createElement('img');
  avatar.className = 'player-avatar';
  avatar.width = 38;
  avatar.height = 38;
  avatar.alt = `${player.name} avatar`;
  avatar.loading = 'lazy';
  avatar.decoding = 'async';

  const identity = document.createElement('div');
  identity.className = 'player-identity';

  const name = document.createElement('div');
  name.className = 'player-name';

  const statusLine = document.createElement('div');
  statusLine.className = 'player-status-line';

  const dot = document.createElement('span');
  dot.className = 'player-status-dot';
  dot.setAttribute('aria-hidden', 'true');

  const statusText = document.createElement('span');
  statusText.className = 'player-status-text';

  statusLine.appendChild(dot);
  statusLine.appendChild(statusText);
  identity.appendChild(name);
  identity.appendChild(statusLine);
  top.appendChild(avatar);
  top.appendChild(identity);

  const rowOne = document.createElement('div');
  rowOne.className = 'player-meta-row';

  const ping = document.createElement('span');
  ping.className = 'meta-pill';

  const session = document.createElement('span');
  session.className = 'meta-pill';

  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'player-expand';
  expand.dataset.playerToggle = player.key;
  expand.textContent = 'More';

  rowOne.appendChild(ping);
  rowOne.appendChild(session);
  rowOne.appendChild(expand);

  const rowTwo = document.createElement('div');
  rowTwo.className = 'player-meta-row player-extra';

  const total = document.createElement('span');
  total.className = 'meta-pill';

  const daily = document.createElement('span');
  daily.className = 'meta-pill';

  const weekly = document.createElement('span');
  weekly.className = 'meta-pill';

  rowTwo.appendChild(total);
  rowTwo.appendChild(daily);
  rowTwo.appendChild(weekly);

  card.appendChild(top);
  card.appendChild(rowOne);
  card.appendChild(rowTwo);

  updatePlayerCard(card, player);
  return card;
}

function updatePlayerCard(card, player) {
  const avatar = card.querySelector('.player-avatar');
  const name = card.querySelector('.player-name');
  const dot = card.querySelector('.player-status-dot');
  const statusText = card.querySelector('.player-status-text');
  const pills = card.querySelectorAll('.meta-pill');
  const expand = card.querySelector('.player-expand');
  const isExpanded = state.expandedPlayers.has(player.key);

  if (name) {
    name.textContent = player.name;
  }

  const statusState = player.status === 'offline' ? 'offline' : player.isAFK ? 'afk' : 'online';
  if (dot) {
    dot.dataset.state = statusState;
  }

  if (statusText) {
    statusText.textContent = statusState === 'online'
      ? 'Online'
      : statusState === 'afk'
        ? 'AFK'
        : 'Offline';
  }

  if (pills[0]) pills[0].textContent = `Ping: ${player.ping > 0 ? `${Math.round(player.ping)} ms` : '--'}`;
  if (pills[1]) pills[1].textContent = `Session: ${formatUptime(player.sessionTime)}`;
  if (pills[2]) pills[2].textContent = `Total: ${formatUptime(player.totalPlaytime)}`;
  if (pills[3]) pills[3].textContent = `Daily: ${formatUptime(player.dailyPlaytime)}`;
  if (pills[4]) pills[4].textContent = `Weekly: ${formatUptime(player.weeklyPlaytime)}`;

  if (expand) {
    expand.dataset.playerToggle = player.key;
    expand.textContent = isExpanded ? 'Less' : 'More';
    expand.setAttribute('aria-expanded', String(isExpanded));
  }

  card.classList.toggle('is-expanded', isExpanded);

  if (avatar) {
    configureAvatarImage(
      avatar,
      state.playerAvatarCache,
      `player:${player.key}`,
      player.uuid,
      player.name,
      64,
      player.avatarUrl
    );
  }
}

function getLivePlayerCounters(player, nowPerf) {
  const isActive = String(player.status || '').toLowerCase() === 'online' && !player.isAFK;
  const elapsed = isActive
    ? Math.max(0, (nowPerf - Number(player.counterUpdatedPerf || nowPerf)) / 1000)
    : 0;

  return {
    session: Number(player.sessionTime || 0) + elapsed,
    total: Number(player.totalPlaytime || 0) + elapsed,
    daily: Number(player.dailyPlaytime || 0) + elapsed,
    weekly: Number(player.weeklyPlaytime || 0) + elapsed,
  };
}

function animatePlayerCounters(nowPerf) {
  state.players.forEach((player) => {
    const card = state.playerNodeMap.get(player.key);
    if (!card) {
      return;
    }

    const counters = getLivePlayerCounters(player, nowPerf);
    const pills = card.querySelectorAll('.meta-pill');

    if (pills[1]) pills[1].textContent = `Session: ${formatUptime(counters.session)}`;
    if (pills[2]) pills[2].textContent = `Total: ${formatUptime(counters.total)}`;
    if (pills[3]) pills[3].textContent = `Daily: ${formatUptime(counters.daily)}`;
    if (pills[4]) pills[4].textContent = `Weekly: ${formatUptime(counters.weekly)}`;
  });
}

function renderPlayers(players) {
  if (!elements.playerList) {
    return;
  }

  const signature = buildPlayersSignature(players);
  if (signature === state.lastPlayersSignature) {
    return;
  }

  if (!players.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No players online';
    elements.playerList.replaceChildren(empty);
    state.playerNodeMap.clear();
    state.expandedPlayers.clear();
    state.lastPlayersSignature = signature;
    return;
  }

  const existing = state.playerNodeMap;
  const nextKeys = new Set(players.map((player) => player.key));

  existing.forEach((node, key) => {
    if (!nextKeys.has(key)) {
      node.classList.add('player-card--leaving');
      const timer = window.setTimeout(() => {
        node.remove();
      }, 180);
      state.playerTransitionTimers.set(key, timer);
      existing.delete(key);
      state.expandedPlayers.delete(key);
    }
  });

  const fragment = document.createDocumentFragment();
  players.forEach((player) => {
    let node = existing.get(player.key);
    if (!node) {
      node = createPlayerCard(player);
      node.classList.add('player-card--entering');
      window.setTimeout(() => node.classList.remove('player-card--entering'), 180);
      existing.set(player.key, node);
    } else {
      updatePlayerCard(node, player);
    }
    fragment.appendChild(node);
  });

  elements.playerList.replaceChildren(fragment);
  state.lastPlayersSignature = signature;
}

function syncPlayerCount() {
  const onlineCount = state.players.filter((player) => String(player.status || '').toLowerCase() !== 'offline').length;
  state.targetStats.players = onlineCount;
}

function upsertPlayerFromRealtime(payload) {
  const normalized = normalizePlayer(payload);
  if (!normalized) {
    return;
  }

  const index = state.players.findIndex((player) => player.key === normalized.key);
  if (index >= 0) {
    state.players[index] = { ...state.players[index], ...normalized };
  } else {
    state.players.push(normalized);
  }

  renderPlayers(state.players);
  syncPlayerCount();
}

function removePlayerFromRealtime(payload) {
  const key = String(payload?.uuid || '').trim() || String(payload?.username || '').trim().toLowerCase();
  if (!key) {
    return;
  }

  const nextPlayers = state.players.filter((player) => player.key !== key);
  if (nextPlayers.length === state.players.length) {
    return;
  }

  state.players = nextPlayers;
  renderPlayers(state.players);
  syncPlayerCount();
}

function normalizeLeaderboardEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const username = String(entry.username || entry.name || entry.player || '').trim();
  const uuid = String(entry.uuid || entry.id || '').trim();
  const key = uuid || username.toLowerCase();
  const value = Number(entry.value || entry.score || entry.amount || entry.balance || 0);

  if (!username || !key || !Number.isFinite(value)) {
    return null;
  }

  return {
    key,
    uuid,
    username,
    value,
    avatarUrl: String(entry.avatarUrl || '').trim(),
  };
}

function buildLeaderboardSignature(items) {
  return items.map((item) => `${item.key}:${item.value}`).join('|');
}

function renderLeaderboardCategory(name, items, loading = false) {
  const list = elements.leaderboardLists[name];
  if (!list) {
    return;
  }

  if (loading && !items.length) {
    if (state.leaderboards[name].signature) {
      return;
    }
    list.innerHTML = '<div class="mini-empty">Loading...</div>';
    return;
  }

  if (!items.length) {
    list.innerHTML = '<div class="mini-empty">No ranking data yet</div>';
    return;
  }

  const signature = buildLeaderboardSignature(items);
  if (signature === state.leaderboards[name].signature) {
    return;
  }

  state.leaderboards[name].signature = signature;

  const fragment = document.createDocumentFragment();
  items.slice(0, 5).forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-mini-row';

    const rank = document.createElement('span');
    rank.className = 'mini-rank';
    rank.textContent = `#${index + 1}`;

    const avatar = document.createElement('img');
    avatar.className = 'mini-avatar';
    avatar.width = 30;
    avatar.height = 30;
    avatar.alt = `${entry.username} avatar`;
    avatar.loading = 'lazy';
    avatar.decoding = 'async';

    const nameNode = document.createElement('span');
    nameNode.className = 'mini-name';
    nameNode.textContent = entry.username;

    const value = document.createElement('span');
    value.className = 'mini-value';
    value.textContent = formatNumber(entry.value);

    configureAvatarImage(
      avatar,
      state.leaderboardAvatarCache,
      `leaderboard:${name}:${entry.key}`,
      entry.uuid || entry.username,
      entry.username,
      48,
      entry.avatarUrl
    );

    row.appendChild(rank);
    row.appendChild(avatar);
    row.appendChild(nameNode);
    row.appendChild(value);

    fragment.appendChild(row);
  });

  list.replaceChildren(fragment);
}

async function fetchCategory(name, endpoint) {
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rows = (Array.isArray(payload) ? payload : payload?.items || payload?.data || payload?.entries || [])
      .map(normalizeLeaderboardEntry)
      .filter(Boolean)
      .sort((a, b) => b.value - a.value);

    renderLeaderboardCategory(name, rows);
  } catch (error) {
    renderLeaderboardCategory(name, [], false);
  }
}

async function fetchLeaderboards() {
  const firstLoad = !state.leaderboards.kills.signature
    && !state.leaderboards.balance.signature
    && !state.leaderboards.bounty.signature
    && !state.leaderboards.earnings.signature;

  if (firstLoad) {
    renderLeaderboardCategory('kills', [], true);
    renderLeaderboardCategory('balance', [], true);
    renderLeaderboardCategory('bounty', [], true);
    renderLeaderboardCategory('earnings', [], true);
  }

  await Promise.all([
    fetchCategory('kills', '/api/leaderboard/kills'),
    fetchCategory('balance', '/api/leaderboard/balance'),
    fetchCategory('bounty', '/api/leaderboard/bounty'),
    fetchCategory('earnings', '/api/leaderboard/earnings'),
  ]);
}

function setupLeaderboardLazyLoad() {
  const section = document.querySelector('.dashboard-leaderboards');

  if (!section) {
    state.leaderboardsReady = true;
    fetchLeaderboards();
    return;
  }

  const trigger = () => {
    if (state.leaderboardsReady) {
      return;
    }

    state.leaderboardsReady = true;
    fetchLeaderboards();

    if (state.leaderboardObserver) {
      state.leaderboardObserver.disconnect();
      state.leaderboardObserver = null;
    }
  };

  if (!('IntersectionObserver' in window)) {
    trigger();
    return;
  }

  state.leaderboardObserver = new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    if (visible) {
      trigger();
    }
  }, {
    rootMargin: '120px',
  });

  state.leaderboardObserver.observe(section);
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
  if (elements.playersValue) elements.playersValue.textContent = '--';
  if (elements.playersCountMirror) elements.playersCountMirror.textContent = '--';
  if (elements.serverValue) {
    elements.serverValue.textContent = '--';
    elements.serverValue.dataset.state = 'loading';
  }
  if (elements.timeValue) elements.timeValue.textContent = '--';
  if (elements.apiMessage) elements.apiMessage.textContent = 'Waiting for the first server payload...';

  renderPlayers([]);
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
  const players = Math.max(0, Math.floor(normalizeNumber(snapshot.players, 0)));
  const uptime = Math.max(0, Math.floor(normalizeNumber(snapshot.uptime, 0)));

  state.targetStats.cpu = cpu;
  state.targetStats.ramUsed = ramUsed;
  state.targetStats.ramMax = ramMax;
  state.targetStats.players = players;
  state.targetStats.uptime = uptime;
  state.targetStats.uptimeReceivedPerf = performance.now();

  if (!state.currentSnapshot) {
    state.animatedStats.cpu = cpu;
    state.animatedStats.ramUsed = ramUsed;
    state.animatedStats.ramMax = ramMax;
    state.animatedStats.players = players;
  }
}

function renderAnimatedStats(nowPerf) {
  if (!state.currentSnapshot) {
    return;
  }

  state.animatedStats.cpu = lerp(state.animatedStats.cpu, state.targetStats.cpu, 0.12);
  state.animatedStats.ramUsed = lerp(state.animatedStats.ramUsed, state.targetStats.ramUsed, 0.12);
  state.animatedStats.ramMax = lerp(state.animatedStats.ramMax, state.targetStats.ramMax, 0.08);
  state.animatedStats.players = lerp(state.animatedStats.players, state.targetStats.players, 0.12);

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

  const playerCount = Math.max(0, Math.round(state.animatedStats.players));
  if (elements.playersValue) {
    elements.playersValue.textContent = String(playerCount);
  }
  if (elements.playersCountMirror) {
    elements.playersCountMirror.textContent = String(playerCount);
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

  state.players = Array.isArray(snapshot.playerList)
    ? snapshot.playerList.map(normalizePlayer).filter(Boolean)
    : [];

  renderPlayers(state.players);
  syncPlayerCount();
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

async function fetchPlayers() {
  try {
    const response = await fetch('/api/players', {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const items = (Array.isArray(payload?.items) ? payload.items : [])
      .map(normalizePlayer)
      .filter(Boolean);

    state.players = items;
    renderPlayers(state.players);
    syncPlayerCount();
  } catch (error) {
    // Best-effort fallback endpoint.
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
  fetchPlayers();

  if (state.leaderboardsReady) {
    fetchLeaderboards();
  }
}

function normalizeLeaderboardEventItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeLeaderboardEntry)
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);
}

function applyRealtimeLeaderboardUpdate(event) {
  const categoryMap = {
    kills: 'kills',
    balance: 'balance',
    bounty: 'bounty',
    earnings: 'earnings',
  };

  const mapped = categoryMap[String(event?.category || '').toLowerCase()];
  if (!mapped || !state.leaderboardsReady) {
    return;
  }

  renderLeaderboardCategory(mapped, normalizeLeaderboardEventItems(event.items || []));
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

  channel.bind('leaderboard_update', (event) => {
    state.lastRealtimeAt = Date.now();
    console.log('[DXIR RT] leaderboard_update', event?.category || 'unknown');
    applyRealtimeLeaderboardUpdate(event || {});
  });

  channel.bind('player_join', (event) => {
    state.lastRealtimeAt = Date.now();
    console.log('[DXIR RT] player_join', event?.username || event?.uuid || 'unknown');

    upsertPlayerFromRealtime({
      name: event?.username || event?.name,
      uuid: event?.uuid,
      avatarUrl: event?.avatarUrl,
      ping: event?.ping,
      status: 'online',
      isAFK: Boolean(event?.isAFK),
      sessionTime: event?.sessionTime,
      totalPlaytime: event?.playtime,
      dailyPlaytime: event?.dailyPlaytime,
      weeklyPlaytime: event?.weeklyPlaytime,
    });

    if (state.realtimeConnected) {
      setConnectionState('online', 'Live');
    }
  });

  channel.bind('player_update', (event) => {
    state.lastRealtimeAt = Date.now();
    console.log('[DXIR RT] player_update', event?.username || event?.uuid || 'unknown');

    upsertPlayerFromRealtime({
      name: event?.username || event?.name,
      uuid: event?.uuid,
      avatarUrl: event?.avatarUrl,
      ping: event?.ping,
      status: event?.status,
      isAFK: Boolean(event?.isAFK),
      sessionTime: event?.sessionTime,
      totalPlaytime: event?.playtime,
      dailyPlaytime: event?.dailyPlaytime,
      weeklyPlaytime: event?.weeklyPlaytime,
    });
  });

  channel.bind('player_leave', (event) => {
    state.lastRealtimeAt = Date.now();
    console.log('[DXIR RT] player_leave', event?.username || event?.uuid || 'unknown');
    removePlayerFromRealtime(event || {});
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
  animatePlayerCounters(nowPerf);
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
  setupLeaderboardLazyLoad();
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

  if (elements.playerList) {
    elements.playerList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-player-toggle]');
      if (!button) {
        return;
      }

      const playerKey = String(button.dataset.playerToggle || '').trim();
      if (!playerKey) {
        return;
      }

      if (state.expandedPlayers.has(playerKey)) {
        state.expandedPlayers.delete(playerKey);
      } else {
        state.expandedPlayers.add(playerKey);
      }

      const card = state.playerNodeMap.get(playerKey);
      const player = state.players.find((entry) => entry.key === playerKey);

      if (card && player) {
        updatePlayerCard(card, player);
      }
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

