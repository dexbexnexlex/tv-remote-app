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
// Known app IDs — verified on most 2018+ Tizen models; may differ by region/firmware.
const APP_IDS = {
  netflix: '3201907018807',
  youtube: '111299001912',
  disneyplus: '3201901017640',
  appletv: '3201807016597',
};

function getTvIp() { return localStorage.getItem('tvIp') || ''; }
function getTvToken() { return localStorage.getItem('tvToken') || ''; }

function tvSocketUrl(ip, token) {
  const name = btoa('TV Remote PWA');
  let url = `wss://${ip}:8002/api/v2/channels/samsung.remote.control?name=${name}`;
  if (token) url += `&token=${token}`;
  return url;
}

function sendToTv(payload, { onConnect } = {}) {
  const ip = getTvIp();
  if (!ip) {
    toast('Set your TV\'s IP address in Settings first');
    openSettings();
    return;
  }
  let settled = false;
  logDebug(`Connecting to ${ip} …`);
  const ws = new WebSocket(tvSocketUrl(ip, getTvToken()));

  const failTimer = setTimeout(() => {
    if (!settled) {
      logDebug('Timed out waiting for ms.channel.connect');
      toast('Could not reach the TV. Check the IP, and that you\'ve trusted its certificate once (see Settings hint).');
      try { ws.close(); } catch (e) {}
    }
  }, 5000);

  ws.addEventListener('message', (event) => {
    logDebug(`recv: ${event.data}`);
    try {
      const msg = JSON.parse(event.data);
      if (msg.event === 'ms.channel.connect') {
        settled = true;
        clearTimeout(failTimer);
        if (msg.data && msg.data.token) {
          localStorage.setItem('tvToken', msg.data.token);
        }
        if (onConnect) onConnect(ws);
        else {
          logDebug(`send: ${JSON.stringify(payload)}`);
          ws.send(JSON.stringify(payload));
          setTimeout(() => ws.close(), 600);
        }
      }
    } catch (e) { /* ignore non-JSON frames */ }
  });

  ws.addEventListener('error', (e) => {
    settled = true;
    clearTimeout(failTimer);
    logDebug(`ws error`);
    toast('Connection failed. See the pairing hint in Settings.');
  });

  ws.addEventListener('close', (e) => {
    logDebug(`ws closed (code ${e.code})`);
  });
}

function sendKey(key) {
  sendToTv({
    method: 'ms.remote.control',
    params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
  });
}

function launchApp(appId) {
  sendToTv({
    method: 'ms.channel.emit',
    params: { event: 'ed.apps.launch', to: 'host', data: { appId, action_type: 'NATIVE_LAUNCH' } },
  });
}

async function listInstalledApps() {
  const ip = getTvIp();
  if (!ip) { toast('Set your TV\'s IP address first'); openSettings(); return; }
  document.getElementById('debugLog').hidden = false;
  const url = `https://${ip}:8002/api/v2/applications/`;
  logDebug(`REST GET ${url}`);
  try {
    const res = await fetch(url);
    const text = await res.text();
    logDebug(`REST status ${res.status}: ${text}`);
  } catch (e) {
    logDebug(`REST fetch failed: ${e.message}`);
  }
}

async function restLaunchApp(appId) {
  const ip = getTvIp();
  if (!ip) { toast('Set your TV\'s IP address first'); openSettings(); return; }
  document.getElementById('debugLog').hidden = false;
  const url = `https://${ip}:8002/api/v2/applications/${appId}`;
  logDebug(`REST POST ${url}`);
  try {
    const res = await fetch(url, { method: 'POST' });
    const text = await res.text();
    logDebug(`REST status ${res.status}: ${text}`);
  } catch (e) {
    logDebug(`REST fetch failed: ${e.message}`);
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
  else if (action === 'hdmi1') sendKey('KEY_HDMI1');
  else if (action === 'hdmi2') sendKey('KEY_HDMI2');
  else if (action === 'hdmi3') sendKey('KEY_HDMI3');
  else if (action.startsWith('app:')) restLaunchApp(APP_IDS[action.slice(4)]);
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
  document.getElementById('pairStatus').textContent = '';
  document.getElementById('settingsPanel').hidden = false;
}
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettings').addEventListener('click', () => {
  document.getElementById('settingsPanel').hidden = true;
});
document.getElementById('pairBtn').addEventListener('click', pairWithTv);
document.getElementById('listAppsBtn').addEventListener('click', listInstalledApps);
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
