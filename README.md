# TV Remote

A phone-installable web app (PWA) that controls your Samsung TV over your home WiFi —
no TV-side app, no Developer Mode needed. Buttons: Live TV Guide, Netflix, Disney+,
YouTube, Apple TV, HDMI 1/2/3.

## How it works

Samsung Tizen TVs run a local remote-control service that the official Samsung
Remote / SmartThings apps use. This app talks to that same service directly from
your phone's browser over WebSocket (`wss://<tv-ip>:8002/...`) — your TV's actual
home screen and apps are untouched.

## One-time setup

1. **Find your TV's IP address**: on the TV, go to Settings → General → Network →
   Network Status, and note the IP (e.g. `192.168.1.42`). It's a good idea to
   reserve that IP for the TV in your router's settings (sometimes called a
   "DHCP reservation" or "static lease") so it doesn't change later.

2. **Trust the TV's certificate once.** The TV's local control service uses a
   self-signed HTTPS certificate, which your phone's browser won't trust by
   default — and without trusting it, every connection attempt will silently
   fail. On your phone, open a browser tab to:

   `https://<tv-ip>:8002/api/v2`

   You'll get a privacy/certificate warning — this is expected (it's your own TV
   on your own network). Choose "visit this site anyway" / "proceed." You only
   need to do this once per browser.

3. **Open this app and pair.** Tap the gear icon → enter the TV's IP → tap
   "Pair with TV." Your TV screen will show an "Allow this device to connect?"
   prompt — accept it there. The app saves a pairing token so you won't be asked
   again.

4. **Set your weather location** in the same Settings screen (city name works
   best, e.g. "Columbus, OH").

## Installing on your phone

Open this app's hosted URL in your phone's browser, then:
- **iPhone (Safari)**: Share button → "Add to Home Screen."
- **Android (Chrome)**: menu (⋮) → "Add to Home screen" / "Install app."

It then behaves like a normal app icon.

## Known limitations

- **Local network only.** This only works while your phone and TV are on the
  same home WiFi — it won't work from college or anywhere else away from home
  (by design, per your earlier call on this).
- **App IDs can vary slightly by TV model/firmware/region.** The Netflix,
  YouTube, Disney+, and Apple TV buttons use commonly-reported IDs for 2018+
  Samsung Tizen TVs. If a button opens the wrong thing (or nothing), tell me
  and we'll adjust the ID for your exact model.
- **HDMI key behavior varies by model too.** Most modern Tizen TVs respond to
  `KEY_HDMI1`/`KEY_HDMI2`/`KEY_HDMI3` directly; a few older models instead need
  a generic "source" key plus navigation. If your HDMI buttons don't switch
  inputs, say so and we'll switch that button's behavior.
- If the TV is fully powered off (not just standby) or disconnected from WiFi,
  this app can't wake or reach it — same as before, you'd use the regular remote
  to power it on.

## Project files

- `index.html` / `style.css` — the UI (dark starfield + glass theme)
- `app.js` — clock, weather (Open-Meteo, no API key needed), and the Samsung TV
  WebSocket control logic
- `manifest.json`, `icon.svg`, `sw.js` — make it installable as an app
