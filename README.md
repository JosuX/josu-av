# AV Control

A local web panel for the assembly stream. It starts and supervises MediaMTX (and FFmpeg in RTMP mode),
shows the live WebRTC feed, streams their logs, and adjusts OBS's camera source and bitrate.

```
OBS ──WHIP (H.264 + Opus)──▶ MediaMTX /assembly ──WHEP──▶ browser
```

OBS publishes over WebRTC (WHIP), which already carries Opus audio, so browsers play the
path directly with no transcoding step. OBS must send H.264 (not H.265 or AV1). Point OBS at
MediaMTX under **Settings → Stream**: Service **WHIP**, Server
`http://127.0.0.1:8889/assembly/whip`, or use **Switch to WHIP** on the panel's Settings page.

### RTMP ingest (legacy)

With `AV_INGEST=rtmp` the panel runs the original pipeline, where FFmpeg re-encodes OBS's AAC
audio to Opus (browsers can't play AAC over WebRTC) and copies the video through:

```
OBS ──RTMP──▶ MediaMTX /assembly ──RTSP──▶ FFmpeg (AAC → Opus) ──▶ MediaMTX /assembly-webrtc ──WHEP──▶ browser
```

## Pages

- **Dashboard** (`/`): a LIVE/offline badge with how long it's been live, three stat tiles
  (viewers by page, bitrate received and OBS's target, playback health), the live feed with `/assembly` and `/watch` tabs, share and open-in-new-tab, the
  viewers list with each one's playback and any bitrate recommendation, MediaMTX with its
  controls (command line under Details), and compact network and memory charts at the bottom.
- **Log monitor** (`/logs`): live, filterable logs with download: each process's output, plus
  **Clients** (viewers joining and leaving with their address and page, each viewer's playback
  verdicts with the numbers behind them, and every WebRTC player or publisher MediaMTX sees),
  **OBS** (connection, stream starts/stops/reconnects, frame-drop warnings, and every change the
  panel or automation made, with camera passwords masked) and **Automation**.
- **Settings** (`/settings`): sections for the camera URL, stream output (bitrate, x264 preset,
  frame rate; unapplied changes collect in a bar at the bottom), automation and adaptive
  bitrate, with a section nav that follows the page.
- **Viewer page** (`/watch`, and the whole of port 8080): just the live video, for the audience.
  See [Viewer port](#viewer-port).

## Requirements

- Linux (system stats come from `/proc`)
- Node.js 24+ and pnpm
- `mediamtx` and `pgrep` on `PATH` (plus `ffmpeg` in RTMP mode); `setpriv` (util-linux) is recommended, see below
- OBS 30+ (WHIP output, built-in obs-websocket v5) on the same host, with **Tools → WebSocket Server Settings → Enable WebSocket server** ticked

## Running

```bash
pnpm install
pnpm dev                    # development, http://<host>:3000
pnpm build && pnpm start    # production
```

Both bind to `0.0.0.0:3000` so phones and tablets on the LAN can reach the panel.

To keep it running, use a systemd user unit (`~/.config/systemd/user/av-control.service`):

```ini
[Unit]
Description=AV Control panel
After=network-online.target

[Service]
WorkingDirectory=%h/Projects/jw-av
# systemd does not see your shell PATH: use the full path from `which pnpm`.
ExecStart=/home/you/.local/share/mise/installs/node/25.2.1/bin/pnpm start
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
pnpm build
systemctl --user enable --now av-control
loginctl enable-linger "$USER"   # keep it running while logged out
```

## Configuration

Everything has a default that matches the original hand-run setup. Override with environment
variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AV_MEDIAMTX_BIN` | `mediamtx` | MediaMTX binary |
| `AV_MEDIAMTX_CONFIG` | `/etc/mediamtx/mediamtx.yml` | MediaMTX config file |
| `AV_MEDIAMTX_API` | `http://127.0.0.1:9997` | MediaMTX control API; the panel enables it on this address (via `MTX_API`/`MTX_APIADDRESS`) when it starts MediaMTX |
| `AV_MEDIAMTX_HLS` | `http://127.0.0.1:8888` | HLS server, used to probe readiness when the API is off |
| `AV_WEBRTC_PORT` | `8889` | MediaMTX WebRTC port the browser connects to |
| `AV_RTSP_BASE` | `rtsp://127.0.0.1:8554` | RTSP address FFmpeg reads from and publishes to |
| `AV_INGEST` | `whip` | `whip`: OBS publishes over WebRTC, no FFmpeg. `rtmp`: OBS publishes RTMP and FFmpeg transcodes the audio |
| `AV_INPUT_PATH` | `assembly` | Path OBS publishes to (and, in WHIP mode, the path browsers play) |
| `AV_OUTPUT_PATH` | `assembly-webrtc` | RTMP mode only: path FFmpeg publishes the Opus stream to |
| `AV_FFMPEG_BIN` | `ffmpeg` | FFmpeg binary (RTMP mode) |
| `AV_OBS_WS_URL` | `ws://127.0.0.1:4455` | obs-websocket address |
| `AV_OBS_WS_PASSWORD` | *(read from OBS's config)* | obs-websocket password |
| `AV_OBS_CONFIG_DIR` | `$XDG_CONFIG_HOME/obs-studio` | OBS config directory (profiles, logs, websocket config) |
| `AV_PDEATHSIG` | `1` | Set to `0` to spawn children directly instead of through `setpriv` |
| `AV_OBS_BIN` | `obs` | OBS binary, for **Launch OBS** |
| `AV_OBS_ARGS` | *(none)* | Extra OBS arguments when the panel launches it, e.g. `--minimize-to-tray` |
| `AV_OBS_PROCESS` | *(binary name)* | Process name used to tell whether OBS is running (`pgrep -x`) |
| `AV_WEBRTC_INTERFACES` | *(the LAN interface, e.g. `wlo1`)* | Interfaces MediaMTX offers for WebRTC when the panel starts it (comma-separated; empty offers all) |
| `AV_VIEWER_PORT` | `8080` | Port serving only the viewer page; `0` turns it off |
| `AV_STATE_DIR` | `$XDG_STATE_HOME/av-control` | Where the automation switches are saved (`automation.json`), and the files shared with the OBS live-bitrate script |

The commands themselves are defined in `src/lib/config.ts`.

## How it behaves

- **Live updates.** Pages get their data pushed over Server-Sent Events (`/api/events/<topic>`
  for `status`, `obs`, `automation` and `watch`) instead of polling. Each topic is computed once
  for all open pages, only while someone is watching, and only sent when it changed; process
  state changes and automation checks push at once. If the push connection drops, pages poll
  every 3 s until it reconnects.

- **Process supervision.** The panel spawns MediaMTX (and FFmpeg in RTMP mode) as child
  processes and keeps the last 3,000 log lines of each. MediaMTX restarts after a crash, waiting
  3 s and doubling up to 30 s; after 6 crashes in a row (each within 30 s of starting) it gives up
  and the dashboard says so. FFmpeg restarts every 3 s after it exits, because it exits whenever
  OBS stops publishing. Neither is restarted if its binary can't be started at all.
- **WebRTC interfaces.** Left to itself MediaMTX offers every interface for WebRTC, Docker
  bridges and VPNs included. The panel starts it with only the LAN interface
  (`AV_WEBRTC_INTERFACES`), so fewer addresses get tried when a connection is set up.
- **Player.** The dashboard's WebRTC player sends its offer after at most 250 ms of ICE
  gathering, asks the browser for no extra playout buffering, rides out brief network drops
  for 2 s, and otherwise reconnects with a backoff from 0.5 s up to 5 s.
- **Shutdown.** Open event streams are closed as soon as the server gets SIGTERM/SIGINT, since
  Next waits for open requests before exiting. Children get SIGTERM when the server exits normally. They are spawned through
  `setpriv --pdeathsig TERM` as well, so the kernel stops them even if the server is killed
  outright. Without `setpriv` a hard kill leaves them running; the panel then shows them as
  "running outside this app" and offers to stop them.
- **External instances.** A MediaMTX or FFmpeg started from a terminal or systemd is detected
  with `pgrep`, and the panel refuses to start a second one on the same ports.
- **Bitrate.** OBS has no WebSocket request for encoder settings, so the panel writes the bitrate
  into the current profile's `streamEncoder.json` and restarts the stream, which makes OBS re-read
  the file. This needs OBS in **Advanced** output mode with CBR/VBR/ABR rate control. OBS rewrites
  that file when its own Settings dialog is saved, which can undo the change; the panel reports
  when that happens. The "Encoding at" figure comes from the latest OBS log.
- **Stream restarts.** Applying a bitrate, restarting, or switching to WHIP stops OBS's stream
  and starts it again. A start only counts once MediaMTX is receiving the stream: OBS calls its
  output active while the WebRTC connection is still being set up, and one that never comes up
  sends nothing for about 35 s. After 15 s without the stream arriving, the panel stops OBS's
  output and retries. If the start fails, the panel retries once after 2 s; if that fails too,
  the Settings page shows **The stream is OFF** with a button to start it. Switching to WHIP
  restarts the stream even when OBS rejects the new service settings.

## Automation

A background supervisor runs every 3 s from server start (`src/instrumentation.ts`), whether or
not a browser is open. Its switches are on the Settings page and are saved across restarts;
what it does is listed there under **Recent activity** and in the server log (`[automation]`).

- **Launch OBS** (off by default). When MediaMTX is up and OBS isn't running, opens OBS on the
  desktop, with `--startstreaming` if Keep stream live is on. It runs as its own systemd unit
  (`uwsm app`, else `systemd-run --user`), so restarting the panel doesn't close it. Before
  launching it deletes the crash markers in `obs-studio/.sentinel`, which would otherwise make
  OBS ask about Safe Mode (which disables the WebSocket server) and wait for an answer. It
  needs someone logged in to the desktop, gives up after 3 launches that don't stay connected
  for a minute, and must be turned off before closing OBS on purpose. The Settings page also
  has a one-off **Launch OBS** button while OBS is disconnected.
- **Keep stream live** (off by default). Starts OBS's stream whenever it is off, once MediaMTX is
  up. Failed starts are retried after 5 s, doubling up to a minute, and it gives up after 5.
  Turn it off before ending the stream, or it will start it again.
- **Reconnect cameras** (on). A network media source that is on screen and in an error, ended or
  stopped state for 5 s, or stuck opening/buffering for 20 s, is reloaded (at most every 30 s).
  A source that freezes while OBS still reports it as playing can't be detected.
- **Keep OBS on WHIP** (on, WHIP ingest only). If OBS's stream service is not the panel's WHIP
  endpoint while the stream is idle, it is switched back.

Always on, and shown as alerts on the dashboard while they last:

- **Codec check.** OBS set to (or MediaMTX receiving) H.265, AV1 or VP9, which browsers can't
  play over WebRTC, with the OBS setting to change.
- **Quality warnings.** 2% or more of frames dropped over the last 15 s for network, encoding
  or rendering reasons, or output congestion of 50% or more, each with the likely fix.

## Adaptive bitrate

MediaMTX forwards one stream to every viewer without re-encoding, so the panel picks one bitrate
that works for most of them. It measures quality from the dashboard's own players: each sends
its browser's WebRTC stats (packets lost, frames dropped, time frozen) every 5 s. Viewers who
watch elsewhere, such as MediaMTX's player page, are counted but can't be measured.

Over a 25 s window each viewer is **smooth**, **losing packets** (2% or more lost, or frozen
while losing some: the network can't keep up), **lagging** (dropping frames or freezing without
loss: the device can't decode smoothly) or **stream stalled**: lagging, but the stream itself
stalled before reaching them. The panel blames the source when MediaMTX lost packets coming from
OBS in the same window, when OBS is dropping frames while encoding, or when half or more of the
measured viewers (at least two) freeze at once; the dashboard then says so and points at Stream
output instead of at viewers' devices.

- When half or more of the measured viewers are struggling (losing packets, lagging or stalled), the
  bitrate drops 20%, then waits 30 s before judging again. It never goes below the floor
  (default 1500 kbps). For lagging devices a lower bitrate eases decoding; if they keep lagging,
  the dashboard suggests lowering OBS's output resolution, which helps most.
- After 10 minutes with no one struggling it rises 10% at a time, never above the bitrate saved
  in Settings → Stream output.

Set the mode under Settings → Automation: **Off** (stats only), **Recommend** (the default; the
dashboard suggests a bitrate for you to apply), or **Automatic**.

Changes are applied live, without restarting the stream, by an OBS script: add
`obs/av-live-bitrate.lua` under **Tools → Scripts → +** in OBS (the Settings page shows its full
path). It swaps files with the panel in `AV_STATE_DIR`, so if you change that, set the same folder
in the script's settings. Only encoders that accept a new bitrate while running can do this:
x264 and NVENC. With another encoder, or without the script, Automatic only recommends and a
change needs **Apply & restart stream**. A new stream always starts at the saved bitrate.

## Viewer port

Viewers should not get the control panel, which has no login. The panel therefore also listens
on a second port, `AV_VIEWER_PORT` (8080), that serves only the viewer page: `/` redirects to
`/watch`, and only that page, its scripts and styles, a read-only "is the stream live" endpoint
(`/api/watch`) and the playback-stats endpoint are forwarded to the panel. Everything else gets
a 404, including every control endpoint. Share `http://<host>:8080` with viewers.

The page starts **with sound** where the browser allows it (desktop browsers on a site the
person has used before). Browsers refuse sound before the person interacts with the page (most
phones always do), so then it plays muted with a "Tap for sound" prompt, and the first tap or key
anywhere on the page turns the sound on; it stays on across reconnects. `/watch?muted` starts
muted; the dashboard's embedded preview uses that.

Viewers on this page report playback stats like the dashboard's player, so they count towards
[adaptive bitrate](#adaptive-bitrate); they show up as "(watch page)" in the viewer list.
The live-feed card's link opens this page.

The separate port only keeps viewers away from the controls if the firewall does too. With
ufw, open the viewer page and WebRTC to the LAN, and the panel only to operators' devices:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp   # viewer page
sudo ufw allow from 192.168.1.0/24 to any port 8889 proto tcp   # WebRTC signalling
sudo ufw allow from 192.168.1.0/24 to any port 8189 proto udp   # WebRTC media
sudo ufw allow from <operator-device-ip> to any port 3000 proto tcp
```

The viewer port starts with the server, so after changing it restart the panel (in development,
restart `pnpm dev`).

## Security

The panel has **no authentication**. Anyone who can reach port 3000 (not the viewer port) can
start and stop the stream, signal the external processes it detects, and change OBS's source URL. Only run it on a
trusted network, or restrict it with the host firewall.

## Development

The UI uses shadcn/ui, [Motion](https://motion.dev) for animation (page transitions, sliding
highlights, list and alert enter/exit; it follows the system's reduced-motion setting) and a few
[React Bits](https://reactbits.dev) components in `src/components/reactbits` (CountUp, ShinyText,
SpotlightCard, Aurora), adapted to the theme tokens.


```bash
pnpm test        # unit tests (vitest)
pnpm test:e2e    # browser tests (Playwright)
pnpm typecheck
pnpm lint
```

The browser tests build the panel and run it on test-only ports (panel 3290, viewer port 18080)
against a MediaMTX of their own (`e2e/fixtures/mediamtx.yml`, ports 18554/18889/18189/19997)
fed a synthetic H.264 + Opus stream by ffmpeg, with no OBS, so they can run next to a live
setup. They need `mediamtx`, `ffmpeg` (libx264, libopus) and an installed Chrome or Chromium,
since Playwright's own Chromium can't decode H.264; set `E2E_CHROMIUM` to pick one. They
cover the viewer port (watch page plays, controls refused), the dashboard (feed plays, live
push instead of polling), viewer detection and analysis, and Settings without OBS.

Server code lives in `src/lib` (`procman.ts`, `obs.ts`, `mediamtx.ts`, `sysstats.ts`) and is
exposed through the route handlers in `src/app/api`. `src/lib/shared.ts` holds the constants and
types the client uses too.
