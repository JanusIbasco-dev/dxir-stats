const CATEGORY_ORDER = ['topKills', 'richest', 'bounty', 'earnings', 'playtime'];
const MAX_VISIBLE_ROWS = 10;
const THEME_STORAGE_KEY = 'dxir-theme';
const POLL_INTERVAL_MS = 10000;

const state = {
  theme: 'dark',
  timer: null,
  clock: null,
  lastUpdatedAt: 0,
  categories: {
    topKills: createCategoryState('/api/leaderboard/kills', 'kills'),
    richest: createCategoryState('/api/leaderboard/balance', 'coins'),
    bounty: createCategoryState('/api/leaderboard/bounty', 'bounty'),
    earnings: createCategoryState('/api/leaderboard/earnings', 'earned'),
    playtime: createCategoryState('/api/leaderboard/playtime', 'seconds'),
  },
  avatarCache: new Map(),
  search: '',
};

const elements = {
  themeToggle: document.getElementById('themeToggle'),
  themeToggleLabel: document.getElementById('themeToggleLabel'),
  status: document.getElementById('leaderboardStatus'),
  lists: {
    topKills: document.getElementById('topKillsList'),
    richest: document.getElementById('richestList'),
    bounty: document.getElementById('bountyList'),
    earnings: document.getElementById('earningsList'),
    playtime: document.getElementById('playtimeList'),
  },
  search: document.getElementById('leaderboardSearch'),
};

const cards = {
  topKills: { title: 'Top Kills', unit: 'kills' },
  richest: { title: 'Richest Players', unit: 'coins' },
  bounty: { title: 'Highest Bounty', unit: 'bounty' },
  earnings: { title: 'Top Earners', unit: 'earned' },
  playtime: { title: 'Top Playtime', unit: 'seconds' },
};

function createCategoryState(endpoint, unit) {
  return {
    endpoint,
    unit,
    loaded: false,
    loading: true,
    error: '',
    updatedAt: 0,
    signature: '',
    items: [],
    rowMap: new Map(),
    rankMap: new Map(),
  };
}

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
  state.theme = nextTheme;
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

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s ago`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${seconds}s ago`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m ago`;
}

function setStatus(message, stateName = 'ready') {
  if (!elements.status) {
    return;
  }

  elements.status.textContent = message;
  elements.status.dataset.state = stateName;
}

function getAvatarUrl(entry) {
  const source = String(entry?.uuid || entry?.username || '').trim();
  return source ? `https://mc-heads.net/avatar/${encodeURIComponent(source)}/64` : '';
}

function getAvatarFallbackUrl(entry) {
  const source = String(entry?.username || '').trim();
  return source ? `https://minotar.net/avatar/${encodeURIComponent(source)}/64` : '';
}

function configureAvatar(image, entry) {
  if (!image || !entry) {
    return;
  }

  const key = entry.key;
  const primary = getAvatarUrl(entry);
  const fallback = getAvatarFallbackUrl(entry);
  const cached = state.avatarCache.get(key) || {};
  let usedFallback = false;

  image.classList.remove('loaded');
  image.dataset.avatarKey = key;
  image.alt = `${entry.username} avatar`;

  if (cached.current === primary || cached.current === fallback) {
    if (image.src !== cached.current) {
      image.src = cached.current;
    }
    if (image.complete && image.naturalWidth > 0) {
      image.classList.add('loaded');
    }
    return;
  }

  image.src = primary;
  image.onload = () => {
    state.avatarCache.set(key, { current: primary });
    image.classList.add('loaded');
  };

  image.onerror = () => {
    if (!usedFallback && fallback) {
      usedFallback = true;
      state.avatarCache.set(key, { current: fallback });
      image.src = fallback;
      return;
    }

    image.onerror = null;
    image.classList.add('loaded');
  };

  if (image.complete && image.naturalWidth > 0) {
    state.avatarCache.set(key, { current: image.src });
    image.classList.add('loaded');
  }
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const username = String(entry.username || entry.name || entry.player || '').trim();
  const uuid = String(entry.uuid || entry.id || '').trim();
  const value = Number(entry.value || entry.score || entry.amount || entry.balance || 0);

  if (!username) {
    return null;
  }

  return {
    key: uuid || username.toLowerCase(),
    username,
    uuid,
    value: Number.isFinite(value) && value >= 0 ? value : 0,
  };
}

function normalizeItems(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.entries)
          ? payload.entries
          : [];

  return items
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_VISIBLE_ROWS);
}

function getFilteredItems(items) {
  const query = state.search.trim().toLowerCase();
  if (!query) {
    return items;
  }

  return items.filter((item) => item.username.toLowerCase().includes(query));
}

function buildSignature(items) {
  return items.map((item) => `${item.key}:${item.value}`).join('|');
}

function renderLoadingState(list, title) {
  if (!list) {
    return;
  }

  list.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 3; index += 1) {
    const row = document.createElement('div');
    row.className = 'leaderboard-loading';
    row.innerHTML = `
      <span class="leaderboard-loading__rank"></span>
      <span class="leaderboard-loading__avatar"></span>
      <span class="leaderboard-loading__text"></span>
      <span class="leaderboard-loading__value"></span>
    `;
    fragment.appendChild(row);
  }

  list.appendChild(fragment);
}

function renderEmptyState(list, message = 'No ranking data yet') {
  if (!list) {
    return;
  }

  list.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'leaderboard-empty';
  empty.textContent = message;
  list.appendChild(empty);
}

function createRow(entry, rank, previousRank) {
  const row = document.createElement('div');
  row.className = 'leaderboard-row';
  row.dataset.leaderboardKey = entry.key;
  row.dataset.rank = String(rank);

  if (rank === 1) {
    row.classList.add('leaderboard-row--top');
  }

  if (previousRank && previousRank !== rank) {
    row.classList.add('leaderboard-row--rank-shift');
    window.setTimeout(() => row.classList.remove('leaderboard-row--rank-shift'), 500);
  }

  const rankBadge = document.createElement('div');
  rankBadge.className = 'leaderboard-rank';
  rankBadge.textContent = `#${rank}`;

  const avatar = document.createElement('img');
  avatar.className = 'leaderboard-avatar';
  avatar.loading = 'lazy';
  avatar.decoding = 'async';
  avatar.referrerPolicy = 'no-referrer';
  configureAvatar(avatar, entry);

  const identity = document.createElement('div');
  identity.className = 'leaderboard-identity';

  const name = document.createElement('div');
  name.className = 'leaderboard-name';
  name.textContent = entry.username;

  const meta = document.createElement('div');
  meta.className = 'leaderboard-meta';
  meta.textContent = rank === 1 ? 'Top performer' : 'Contender';

  identity.appendChild(name);
  identity.appendChild(meta);

  const value = document.createElement('div');
  value.className = 'leaderboard-value';
  value.textContent = formatNumber(entry.value);

  row.appendChild(rankBadge);
  row.appendChild(avatar);
  row.appendChild(identity);
  row.appendChild(value);

  return row;
}

function syncCategory(name) {
  const category = state.categories[name];
  const list = elements.lists[name];

  if (!list) {
    return;
  }

  if (!category.loaded) {
    renderLoadingState(list, cards[name].title);
    return;
  }

  const filtered = getFilteredItems(category.items);

  if (!filtered.length) {
    renderEmptyState(list, state.search ? 'No matching players' : 'Waiting for live plugin data...');
    category.rowMap.clear();
    category.rankMap.clear();
    return;
  }

  const existingRows = new Map(category.rowMap);
  const nextRows = new Map();
  const fragment = document.createDocumentFragment();
  const currentKeys = new Set(filtered.map((item) => item.key));

  existingRows.forEach((row, key) => {
    if (!currentKeys.has(key)) {
      row.classList.add('leaderboard-row--leaving');
      window.setTimeout(() => row.remove(), 180);
    }
  });

  filtered.forEach((entry, index) => {
    const rank = index + 1;
    const previousRank = category.rankMap.get(entry.key);
    let row = existingRows.get(entry.key);

    if (row) {
      const avatar = row.querySelector('.leaderboard-avatar');
      const name = row.querySelector('.leaderboard-name');
      const meta = row.querySelector('.leaderboard-meta');
      const value = row.querySelector('.leaderboard-value');

      row.dataset.rank = String(rank);
      row.classList.toggle('leaderboard-row--top', rank === 1);
      row.classList.remove('leaderboard-row--leaving');

      if (previousRank && previousRank !== rank) {
        row.classList.add('leaderboard-row--rank-shift');
        window.setTimeout(() => row.classList.remove('leaderboard-row--rank-shift'), 500);
      }

      if (avatar) {
        configureAvatar(avatar, entry);
      }

      if (name) {
        name.textContent = entry.username;
      }

      if (meta) {
        meta.textContent = rank === 1 ? 'Top performer' : 'Contender';
      }

      if (value) {
        value.textContent = formatNumber(entry.value);
      }
    } else {
      row = createRow(entry, rank, previousRank);
      row.classList.add('leaderboard-row--entering');
      window.setTimeout(() => row.classList.remove('leaderboard-row--entering'), 180);
    }

    nextRows.set(entry.key, row);
    fragment.appendChild(row);
  });

  list.replaceChildren(fragment);
  category.rowMap = nextRows;
  category.rankMap = new Map(filtered.map((entry, index) => [entry.key, index + 1]));
}

function updateStatusLine() {
  const loaded = CATEGORY_ORDER.every((name) => state.categories[name].loaded);
  const anyError = CATEGORY_ORDER.some((name) => state.categories[name].error);
  const activeUpdatedAt = Math.max(...CATEGORY_ORDER.map((name) => state.categories[name].updatedAt || 0));

  if (!loaded) {
    setStatus('Loading leaderboard data...', 'loading');
    return;
  }

  if (activeUpdatedAt > 0) {
    const age = Date.now() - activeUpdatedAt;
    const prefix = anyError ? 'Partial data loaded' : 'Live leaderboard data loaded';
    setStatus(`${prefix} · Updated ${formatElapsed(age)}`, anyError ? 'error' : 'ready');
    return;
  }

  setStatus('No ranking data yet', 'ready');
}

async function fetchCategory(name) {
  const category = state.categories[name];

  try {
    const response = await fetch(category.endpoint, {
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
    const items = normalizeItems(payload);
    const signature = buildSignature(items);
    const updatedAt = Number(response.headers.get('X-Updated-At')) || Date.now();

    category.loaded = true;
    category.loading = false;
    category.error = '';
    category.updatedAt = updatedAt;
    state.lastUpdatedAt = Math.max(state.lastUpdatedAt, updatedAt);

    if (signature !== category.signature || !category.items.length) {
      category.signature = signature;
      category.items = items;
      syncCategory(name);
    }

    return true;
  } catch (error) {
    category.error = String(error?.message || 'Unknown error');
    category.loaded = category.items.length > 0;
    category.loading = false;

    if (!category.items.length) {
      renderLoadingState(elements.lists[name], cards[name].title);
    }

    return false;
  }
}

async function refreshAll() {
  const results = await Promise.allSettled(CATEGORY_ORDER.map((name) => fetchCategory(name)));
  const failed = results.some((result) => result.status === 'rejected' || result.value === false);

  if (failed) {
    updateStatusLine();
    return;
  }

  updateStatusLine();
}

function renderInitialLoading() {
  CATEGORY_ORDER.forEach((name) => {
    renderLoadingState(elements.lists[name], cards[name].title);
  });
  setStatus('Loading leaderboard data...', 'loading');
}

function startPolling() {
  renderInitialLoading();
  refreshAll();
  state.timer = window.setInterval(refreshAll, POLL_INTERVAL_MS);
  state.clock = window.setInterval(updateStatusLine, 1000);
}

function bindEvents() {
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'light' ? 'dark' : 'light');
    });
  }

  if (elements.search) {
    elements.search.addEventListener('input', () => {
      state.search = String(elements.search.value || '');
      CATEGORY_ORDER.forEach((name) => syncCategory(name));
      updateStatusLine();
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getThemeFromStorage(), false);
  bindEvents();
  startPolling();
});
