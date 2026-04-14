const state = {
  theme: 'dark',
  lastSignature: null,
  timer: null,
};

const THEME_STORAGE_KEY = 'dxir-theme';
const MAX_VISIBLE_ROWS = 10;

const elements = {
  themeToggle: document.getElementById('themeToggle'),
  themeToggleLabel: document.getElementById('themeToggleLabel'),
  status: document.getElementById('leaderboardStatus'),
  lists: {
    topKills: document.getElementById('topKillsList'),
    richest: document.getElementById('richestList'),
    bounty: document.getElementById('bountyList'),
    earnings: document.getElementById('earningsList'),
  },
};

const cards = {
  topKills: { title: 'Top Kills', unit: 'kills' },
  richest: { title: 'Richest Players', unit: 'coins' },
  bounty: { title: 'Highest Bounty', unit: 'bounty' },
  earnings: { title: 'Top Earners', unit: 'earned' },
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

function formatValue(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function getAvatarUrl(name) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(String(name || '').trim())}/64`;
}

function getAvatarFallbackUrl(name) {
  return `https://minotar.net/avatar/${encodeURIComponent(String(name || '').trim())}/64`;
}

function configureAvatar(image, name) {
  if (!image) {
    return;
  }

  const primary = getAvatarUrl(name);
  const fallback = getAvatarFallbackUrl(name);
  let usedFallback = false;

  image.classList.remove('loaded');
  image.alt = `${name} avatar`;
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

function normalizeItems(items) {
  return Array.isArray(items)
    ? items
      .map((item) => ({
        name: String(item?.name || '').trim(),
        value: Number(item?.value || 0),
      }))
      .filter((item) => item.name)
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_VISIBLE_ROWS)
    : [];
}

function buildSignature(data) {
  return ['topKills', 'richest', 'bounty', 'earnings']
    .map((key) => `${key}:${(data?.[key] || []).map((item) => `${item.name}:${item.value}`).join('|')}`)
    .join('~');
}

function setStatus(message, isError = false) {
  if (!elements.status) {
    return;
  }

  elements.status.textContent = message;
  elements.status.dataset.state = isError ? 'error' : 'ready';
}

function createRow(rank, item) {
  const row = document.createElement('div');
  row.className = `leaderboard-row${rank === 1 ? ' leaderboard-row--top' : ''}`;

  const rankBadge = document.createElement('div');
  rankBadge.className = 'leaderboard-rank';
  rankBadge.textContent = `#${rank}`;

  const avatar = document.createElement('img');
  avatar.className = 'leaderboard-avatar';
  avatar.loading = 'lazy';
  avatar.decoding = 'async';
  configureAvatar(avatar, item.name);

  const identity = document.createElement('div');
  identity.className = 'leaderboard-identity';

  const name = document.createElement('div');
  name.className = 'leaderboard-name';
  name.textContent = item.name;

  const meta = document.createElement('div');
  meta.className = 'leaderboard-meta';
  meta.textContent = rank === 1 ? 'Top performer' : 'Contender';

  identity.appendChild(name);
  identity.appendChild(meta);

  const value = document.createElement('div');
  value.className = 'leaderboard-value';
  value.textContent = formatValue(item.value);

  row.appendChild(rankBadge);
  row.appendChild(avatar);
  row.appendChild(identity);
  row.appendChild(value);

  return row;
}

function renderCategory(key, data) {
  const list = elements.lists[key];
  if (!list) {
    return;
  }

  const items = normalizeItems(data?.[key]);

  if (!items.length) {
    list.innerHTML = '<div class="leaderboard-empty">No ranking data yet</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    fragment.appendChild(createRow(index + 1, item));
  });

  list.replaceChildren(fragment);
}

function renderLeaderboard(data) {
  const signature = buildSignature(data);

  if (state.lastSignature !== null && signature === state.lastSignature) {
    return;
  }

  state.lastSignature = signature;

  Object.keys(cards).forEach((key) => {
    renderCategory(key, data);
  });

  setStatus('Live leaderboard data loaded');
}

async function fetchLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      setStatus(`Unable to load leaderboard (${response.status})`, true);
      return;
    }

    const payload = await response.json();
    renderLeaderboard(payload || {});
  } catch (error) {
    if (elements.status) {
      setStatus('Unable to load leaderboard', true);
    }
  }
}

function startPolling() {
  fetchLeaderboard();
  state.timer = window.setInterval(fetchLeaderboard, 15000);
}

function bindEvents() {
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      applyTheme(state.theme === 'light' ? 'dark' : 'light');
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getThemeFromStorage(), false);
  bindEvents();
  startPolling();
});
