const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000;
const UPDATE_FOCUS_COOLDOWN = 60 * 1000;

let lastUpdateCheck = 0;
let updateBannerShown = false;
const hadControllerAtLoad = !!navigator.serviceWorker?.controller;

function updateCopy() {
  const language = localStorage.getItem('dropmysong_language')
    || (navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en');

  return language === 'fr'
    ? {
        text: 'Une nouvelle mise à jour de Drop My Song est prête.',
        button: 'Recharger maintenant',
      }
    : {
        text: 'A new Drop My Song update is ready.',
        button: 'Reload now',
      };
}

function showUpdateBanner() {
  if (updateBannerShown || document.querySelector('#dropmysongUpdateBanner')) return;
  updateBannerShown = true;

  const copy = updateCopy();
  const banner = document.createElement('div');
  banner.id = 'dropmysongUpdateBanner';
  banner.setAttribute('role', 'status');
  banner.style.cssText = [
    'position:fixed',
    'left:max(12px,env(safe-area-inset-left))',
    'right:max(12px,env(safe-area-inset-right))',
    'bottom:max(12px,env(safe-area-inset-bottom))',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:12px',
    'padding:12px 14px',
    'border:1px solid rgba(54,219,154,.42)',
    'border-radius:14px',
    'background:rgba(4,10,18,.97)',
    'box-shadow:0 16px 44px rgba(0,0,0,.42),0 0 24px rgba(54,219,154,.08)',
    'color:#eaf5ff',
    'font:700 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'backdrop-filter:blur(14px)',
  ].join(';');

  const text = document.createElement('span');
  text.textContent = copy.text;

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = copy.button;
  button.style.cssText = [
    'flex:0 0 auto',
    'min-height:36px',
    'padding:7px 11px',
    'border:1px solid rgba(54,219,154,.46)',
    'border-radius:10px',
    'background:rgba(54,219,154,.14)',
    'color:#c9ffe9',
    'font:800 12px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'cursor:pointer',
  ].join(';');
  button.addEventListener('click', () => location.reload());

  banner.append(text, button);
  document.body.appendChild(banner);
}

async function checkForUpdate(registration, force = false) {
  const now = Date.now();
  if (!force && now - lastUpdateCheck < UPDATE_FOCUS_COOLDOWN) return;
  lastUpdateCheck = now;

  try {
    await registration.update();
  } catch (error) {
    console.warn('Drop My Song update check failed:', error);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {
        updateViaCache: 'none',
      });

      await checkForUpdate(registration, true);

      setInterval(() => checkForUpdate(registration, true), UPDATE_CHECK_INTERVAL);

      window.addEventListener('focus', () => checkForUpdate(registration));
      window.addEventListener('online', () => checkForUpdate(registration, true));
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate(registration);
      });

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated' && hadControllerAtLoad) {
            showUpdateBanner();
          }
        });
      });
    } catch (error) {
      console.warn('Drop My Song service worker registration failed:', error);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadControllerAtLoad) showUpdateBanner();
  });
}
