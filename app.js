// ---------- Clock ----------
function tickClock() {
  const now = new Date();
  document.getElementById('time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  document.getElementById('date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
tickClock();
setInterval(tickClock, 15000);

// ---------- Debug log ----------
const debugLines = [];
function logDebug(msg) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  debugLines.push(`[${time}] ${msg}`);
  if (debugLines.length > 40) debugLines.shift();
  const el = document.getElementById('debugLog');
  if (el) { el.textContent = debugLines.join('\n'); el.scrollTop = el.scrollHeight; }
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Weather (Open-Meteo, no API key) ----------
const WEATHER_CODES = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Cloudy',
  45: 'Foggy', 48: 'Foggy',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  80: 'Rain Showers', 81: 'Rain Showers', 82: 'Heavy Showers',
  95: 'Thunderstorms', 96: 'Thunderstorms', 99: 'Thunderstorms',
};

async function fetchWeatherForCoords(lat, lon, label) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`);
    const data = await res.json();
    const temp = Math.round(data.current.temperature_2m);
    const desc = WEATHER_CODES[data.current.weather_code] || 'Weather';
    document.getElementById('weatherTemp').textContent = `${temp}°F`;
    document.getElementById('weatherPlace').textContent = `${desc} · ${label}`;
  } catch (e) {
    document.getElementById('weatherPlace').textContent = 'Weather unavailable';
  }
}

async function fetchWeatherForCity(city) {
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then(r => r.json());
    if (!geo.results || !geo.results.length) {
      document.getElementById('weatherPlace').textContent = 'City not found';
      return;
    }
    const { latitude, longitude, name } = geo.results[0];
    await fetchWeatherForCoords(latitude, longitude, name);
  } catch (e) {
    document.getElementById('weatherPlace').textContent = 'Weather unavailable';
  }
}

function loadWeather() {
  const city = localStorage.getItem('weatherCity');
  if (city) {
    fetchWeatherForCity(city);
    return;
  }
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeatherForCoords(pos.coords.latitude, pos.coords.longitude, 'Current Location'),
      () => { document.getElementById('weatherPlace').textContent = 'Set location in Settings'; },
      { timeout: 6000 }
    );
  }
}
loadWeather();
setInterval(loadWeather, 15 * 60 * 1000);

// ---------- Samsung TV local control ----------
function getTvIp() { return localStorage.getItem('tvIp') || ''; }
function getTvToken() { return localStorage.getItem('tvToken') || ''; }

function tvSocketUrl(ip, token) {
  const name = btoa('TV Remote PWA');
  let url = `wss://${ip}:8002/api/v2/channels/samsung.remote.control?name=${name}`;
  if (token) url += `&token=${token}`;
  return url;
}

function sendToTv(payload, { onConnect } = {}) {
  return new Promise((resolve) => {
    const ip = getTvIp();
    if (!ip) {
      toast('Set your TV\'s IP address in Settings first');
      openSettings();
      resolve();
      return;
    }
    let settled = false;
    logDebug(`Connecting to ${ip} …`);
    const ws = new WebSocket(tvSocketUrl(ip, getTvToken()));

    const failTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        logDebug('Timed out waiting for ms.channel.connect');
        toast('Could not reach the TV. Check the IP, and that you\'ve trusted its certificate once (see Settings hint).');
        try { ws.close(); } catch (e) {}
        resolve();
      }
    }, 5000);

    ws.addEventListener('message', (event) => {
      logDebug(`recv: ${event.data}`);
      try {
        const msg = JSON.parse(event.data);
        if (msg.event === 'ms.channel.connect' && !settled) {
          settled = true;
          clearTimeout(failTimer);
          if (msg.data && msg.data.token) {
            localStorage.setItem('tvToken', msg.data.token);
          }
          if (onConnect) {
            onConnect(ws);
          } else {
            logDebug(`send: ${JSON.stringify(payload)}`);
            ws.send(JSON.stringify(payload));
            setTimeout(() => ws.close(), 300);
          }
          resolve();
        }
      } catch (e) { /* ignore non-JSON frames */ }
    });

    ws.addEventListener('error', (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(failTimer);
        logDebug(`ws error`);
        toast('Connection failed. See the pairing hint in Settings.');
        resolve();
      }
    });

    ws.addEventListener('close', (e) => {
      logDebug(`ws closed (code ${e.code})`);
    });
  });
}

function sendKey(key) {
  return sendToTv({
    method: 'ms.remote.control',
    params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
  });
}

// ---------- Navigate-to-app shortcuts (Home + calibrated swipe sequence) ----------
const NAV_KEY_MAP = { UP: 'KEY_UP', DOWN: 'KEY_DOWN', LEFT: 'KEY_LEFT', RIGHT: 'KEY_RIGHT', ENTER: 'KEY_ENTER' };

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

let navBusy = false;

async function navigateWithShortcut(navKey, entryKey) {
  if (navBusy) {
    toast('Still running the last shortcut — wait for it to finish');
    return;
  }
  const raw = localStorage.getItem(`nav_${navKey}`) || '';
  const steps = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!steps.length) {
    toast(`No shortcut saved yet — set one in Settings`);
    openSettings();
    return;
  }
  navBusy = true;
  try {
    await sendKey(entryKey);
    await sleep(1200);
    for (const step of steps) {
      const key = NAV_KEY_MAP[step];
      if (!key) continue;
      await sendKey(key);
      await sleep(500);
    }
  } finally {
    navBusy = false;
  }
}

function pairWithTv() {
  const ip = document.getElementById('tvIp').value.trim();
  if (!ip) { toast('Enter the TV\'s IP address first'); return; }
  localStorage.setItem('tvIp', ip);
  document.getElementById('pairStatus').textContent = 'Connecting… check your TV for an "Allow" prompt.';
  sendToTv(null, {
    onConnect: (ws) => {
      document.getElementById('pairStatus').textContent = 'Paired! You can close Settings.';
      ws.close();
    },
  });
}

// ---------- Tile actions ----------
document.getElementById('tiles').addEventListener('click', (e) => {
  const btn = e.target.closest('.tile');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'guide') sendKey('KEY_GUIDE');
  else if (action === 'hdmi1') navigateWithShortcut('hdmi1', 'KEY_SOURCE');
  else if (action === 'hdmi2') navigateWithShortcut('hdmi2', 'KEY_SOURCE');
  else if (action === 'hdmi3') navigateWithShortcut('hdmi3', 'KEY_SOURCE');
  else if (action === 'app:netflix') sendKey('KEY_NETFLIX');
  else if (action.startsWith('app:')) navigateWithShortcut(action.slice(4), 'KEY_HOME');
});

// ---------- Touchpad (swipe to navigate, tap to select) ----------
const touchpad = document.getElementById('touchpad');
let padStart = null;
touchpad.addEventListener('pointerdown', (e) => {
  padStart = { x: e.clientX, y: e.clientY };
  touchpad.classList.add('active');
});
touchpad.addEventListener('pointerup', (e) => {
  touchpad.classList.remove('active');
  if (!padStart) return;
  const dx = e.clientX - padStart.x;
  const dy = e.clientY - padStart.y;
  padStart = null;
  const threshold = 24;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
    sendKey('KEY_ENTER');
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    sendKey(dx > 0 ? 'KEY_RIGHT' : 'KEY_LEFT');
  } else {
    sendKey(dy > 0 ? 'KEY_DOWN' : 'KEY_UP');
  }
});
touchpad.addEventListener('pointercancel', () => {
  touchpad.classList.remove('active');
  padStart = null;
});

document.querySelectorAll('.padBtn').forEach((btn) => {
  btn.addEventListener('click', () => sendKey(btn.dataset.key));
});

// ---------- Settings sheet ----------
function openSettings() {
  document.getElementById('tvIp').value = getTvIp();
  document.getElementById('cityInput').value = localStorage.getItem('weatherCity') || '';
  document.getElementById('navDisneyplus').value = localStorage.getItem('nav_disneyplus') || '';
  document.getElementById('navAppletv').value = localStorage.getItem('nav_appletv') || '';
  document.getElementById('navYoutube').value = localStorage.getItem('nav_youtube') || '';
  document.getElementById('navHdmi1').value = localStorage.getItem('nav_hdmi1') || '';
  document.getElementById('navHdmi2').value = localStorage.getItem('nav_hdmi2') || '';
  document.getElementById('navHdmi3').value = localStorage.getItem('nav_hdmi3') || '';
  document.getElementById('pairStatus').textContent = '';
  document.getElementById('settingsPanel').hidden = false;
}
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettings').addEventListener('click', () => {
  document.getElementById('settingsPanel').hidden = true;
});
document.getElementById('pairBtn').addEventListener('click', pairWithTv);
document.getElementById('saveShortcutsBtn').addEventListener('click', () => {
  localStorage.setItem('nav_disneyplus', document.getElementById('navDisneyplus').value.trim());
  localStorage.setItem('nav_appletv', document.getElementById('navAppletv').value.trim());
  localStorage.setItem('nav_youtube', document.getElementById('navYoutube').value.trim());
  localStorage.setItem('nav_hdmi1', document.getElementById('navHdmi1').value.trim());
  localStorage.setItem('nav_hdmi2', document.getElementById('navHdmi2').value.trim());
  localStorage.setItem('nav_hdmi3', document.getElementById('navHdmi3').value.trim());
  toast('Shortcuts saved');
});
document.getElementById('toggleLogBtn').addEventListener('click', () => {
  const el = document.getElementById('debugLog');
  el.hidden = !el.hidden;
});
document.getElementById('saveLocationBtn').addEventListener('click', () => {
  const city = document.getElementById('cityInput').value.trim();
  if (city) localStorage.setItem('weatherCity', city);
  else localStorage.removeItem('weatherCity');
  loadWeather();
  toast('Location saved');
});

// ---------- Remove any old service worker (was causing stale-update bugs) ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}
if ('caches' in window) {
  caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
}
