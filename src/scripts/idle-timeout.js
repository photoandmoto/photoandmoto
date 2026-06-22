// Auto-logout on inactivity for gated pages (Toimitus, Avustajat, Toimituskeskus).
// 25 min → non-blocking warning banner; 30 min → POST /api/auth/logout and
// redirect to /fi/toimitus. Any activity (or clicking the banner) resets it.

const IDLE_MS = 30 * 60 * 1000; // 30 minutes
const WARN_MS = 25 * 60 * 1000; // 25 minutes (5 min before logout)
const THROTTLE_MS = 2000;       // don't churn timers on every mousemove pixel

let warnTimer = null;
let logoutTimer = null;
let banner = null;
let lastReset = 0;

function ensureBanner() {
  if (banner) return banner;
  banner = document.createElement('div');
  banner.id = 'idle-warning';
  banner.setAttribute('role', 'alert');
  banner.textContent = 'Istuntosi vanhenee 5 minuutissa. Jatka kirjautumista klikkaamalla.';
  Object.assign(banner.style, {
    position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
    zIndex: '99999', maxWidth: 'min(92vw, 480px)', background: '#1a1a1a', color: '#fff',
    border: '1px solid #ff9900', borderLeft: '4px solid #ff9900', borderRadius: '10px',
    padding: '14px 18px', font: '600 0.9rem/1.4 system-ui, sans-serif', cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(0,0,0,.4)', display: 'none', textAlign: 'center',
  });
  // Clicking the banner counts as activity → reset (also caught by the global
  // click listener, but explicit per spec).
  banner.addEventListener('click', reset);
  document.body.appendChild(banner);
  return banner;
}

function showWarning() { ensureBanner().style.display = 'block'; }
function hideWarning() { if (banner) banner.style.display = 'none'; }

async function doLogout() {
  hideWarning();
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch { /* redirect regardless */ }
  window.location.href = '/fi/toimitus';
}

function reset() {
  hideWarning();
  clearTimeout(warnTimer);
  clearTimeout(logoutTimer);
  warnTimer = setTimeout(showWarning, WARN_MS);
  logoutTimer = setTimeout(doLogout, IDLE_MS);
}

function onActivity() {
  // Always reset immediately while the warning is visible; otherwise throttle.
  if (banner && banner.style.display === 'block') { lastReset = Date.now(); reset(); return; }
  const now = Date.now();
  if (now - lastReset < THROTTLE_MS) return;
  lastReset = now;
  reset();
}

['mousemove', 'keydown', 'click', 'touchstart'].forEach((evt) =>
  document.addEventListener(evt, onActivity, { passive: true })
);

reset();
