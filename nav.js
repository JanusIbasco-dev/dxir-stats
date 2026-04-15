(function () {
  const body = document.body;
  const sidebar = document.getElementById('sidebarNav');
  if (!body || !sidebar) {
    return;
  }

  const toggleButton = document.querySelector('[data-sidebar-toggle]');
  const closeButtons = Array.from(document.querySelectorAll('[data-sidebar-close]'));
  const links = Array.from(sidebar.querySelectorAll('.sidebar-link'));
  const page = String(body.dataset.page || '').trim().toLowerCase();
  const storageKey = 'dxir-sidebar-open';

  function applyActiveLink() {
    const hash = String(window.location.hash || '').toLowerCase();

    links.forEach((link) => {
      const navKey = String(link.dataset.nav || '').toLowerCase();
      const shouldActivateByHash =
        hash === '#settings-section' && navKey === 'settings';

      const shouldActivate = shouldActivateByHash || (hash === '' && navKey === page);
      link.classList.toggle('is-active', shouldActivate);
      if (shouldActivate) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function setOpen(open) {
    body.classList.toggle('sidebar-open', open);
    if (toggleButton) {
      toggleButton.setAttribute('aria-expanded', String(open));
    }

    try {
      localStorage.setItem(storageKey, open ? '1' : '0');
    } catch (error) {
      // Ignore storage issues.
    }
  }

  function isMobile() {
    return window.matchMedia('(max-width: 980px)').matches;
  }

  function initializeOpenState() {
    if (!isMobile()) {
      setOpen(false);
      return;
    }

    let open;
    try {
      open = localStorage.getItem(storageKey) === '1';
    } catch (error) {
      open = false;
    }

    setOpen(open);
  }

  if (toggleButton) {
    toggleButton.addEventListener('click', () => {
      setOpen(!body.classList.contains('sidebar-open'));
    });
  }

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => setOpen(false));
  });

  links.forEach((link) => {
    link.addEventListener('click', () => {
      if (isMobile()) {
        setOpen(false);
      }
    });
  });

  window.addEventListener('hashchange', applyActiveLink);
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('sidebar-open')) {
      setOpen(false);
    }
  });

  initializeOpenState();
  applyActiveLink();
})();


