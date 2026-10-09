# AV Control

A local web panel for the assembly stream. It starts and supervises MediaMTX and FFmpeg,
shows the live WebRTC feed, streams their logs, and adjusts OBS's camera source and bitrate.

```
OBS ──RTMP──▶ MediaMTX /assembly ──RTSP──▶ FFmpeg (AAC → Opus) ──▶ MediaMTX /assembly-webrtc ──WHEP──▶ browser
```

FFmpeg only re-encodes the audio. Browsers can't play AAC over WebRTC, and the video is
copied through untouched, so OBS must send H.264 (not H.265).

## Pages

- **Dashboard** (`/`): live feed, start/stop/restart for each process, network and memory charts.
- **Log monitor** (`/logs`): live, filterable output from each process, with download.
- **Settings** (`/settings`): the OBS media source URL (IP camera) and the stream bitrate.

## Requirements

- Linux or Windows 10/11
- Node.js 24+ and pnpm (Node 25+ no longer ships corepack: `npm install -g pnpm@10`)
- `mediamtx` and `ffmpeg` on `PATH`
  - Linux: also `pgrep`; `setpriv` (util-linux) is recommended, see below
  - Windows: `winget install bluenviron.mediamtx Gyan.FFmpeg`
- OBS 28+ (built-in obs-websocket v5) on the same host, with **Tools → WebSocket Server Settings → Enable WebSocket server** ticked

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

## Windows desktop app

On Windows the panel can also run as an Electron app. It bundles the Next.js server and
starts it when the app opens, so nothing has to be left running in a terminal:

```powershell
pnpm electron:build    # dist-electron\AV Control Setup <version>.exe (installer)
                       # dist-electron\AV Control-<version>-portable.exe
```

`pnpm build:standalone && pnpm electron` runs the same app without packaging it. The server
still listens on `0.0.0.0:3000` (`AV_PORT` / `AV_HOST` change that), so phones and tablets on
the LAN can use the panel while the app is open; Windows Firewall asks to allow AV Control and
MediaMTX the first time. Closing the window stops the server along with the MediaMTX and FFmpeg
it started. The server's output goes to `%APPDATA%\av-control\server.log`.

## Configuration

Everything has a default that matches the original hand-run setup. Override with environment
variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AV_MEDIAMTX_BIN` | `mediamtx` | MediaMTX binary |
| `AV_MEDIAMTX_CONFIG` | `/etc/mediamtx/mediamtx.yml`; on Windows `mediamtx.yml` next to `mediamtx.exe` | MediaMTX config file |
| `AV_MEDIAMTX_API` | `http://127.0.0.1:9997` | MediaMTX control API; the panel enables it via `MTX_API` when it starts MediaMTX |
| `AV_MEDIAMTX_HLS` | `http://127.0.0.1:8888` | HLS server, used to probe readiness when the API is off |
| `AV_WEBRTC_PORT` | `8889` | MediaMTX WebRTC port the browser connects to |
| `AV_RTSP_BASE` | `rtsp://127.0.0.1:8554` | RTSP address FFmpeg reads from and publishes to |
| `AV_INPUT_PATH` | `assembly` | Path OBS publishes to |
| `AV_OUTPUT_PATH` | `assembly-webrtc` | Path FFmpeg publishes the Opus stream to |
| `AV_FFMPEG_BIN` | `ffmpeg` | FFmpeg binary |
| `AV_OBS_WS_URL` | `ws://127.0.0.1:4455` | obs-websocket address |
| `AV_OBS_WS_PASSWORD` | *(read from OBS's config)* | obs-websocket password |
| `AV_OBS_CONFIG_DIR` | `$XDG_CONFIG_HOME/obs-studio`; on Windows `%APPDATA%obs-studio` | OBS config directory (profiles, logs, websocket config) |
| `AV_PDEATHSIG` | `1` | Linux: set to `0` to spawn children directly instead of through `setpriv` |

The commands themselves are defined in `src/lib/config.ts`.

## How it behaves

- **Process supervision.** The panel spawns MediaMTX and FFmpeg as child processes and keeps the
  last 3,000 log lines of each. FFmpeg restarts itself every 3 s after it exits, because it exits
  whenever OBS stops publishing.
- **Shutdown.** Children get SIGTERM when the server exits normally. They are spawned through
  `setpriv --pdeathsig TERM` as well, so the kernel stops them even if the server is killed
  outright. Without `setpriv` a hard kill leaves them running; the panel then shows them as
  "running outside this app" and offers to stop them. Windows has neither signals nor
  `setpriv`: children are terminated outright, and the desktop app ends the server's whole
  process tree when it closes.
- **External instances.** A MediaMTX or FFmpeg started from a terminal or systemd is detected
  with `pgrep` (on Windows, `tasklist` and the process command lines), and the panel refuses to
  start a second one on the same ports.
- **Bitrate.** OBS has no WebSocket request for encoder settings, so the panel writes the bitrate
  into the current profile's `streamEncoder.json` and restarts the stream, which makes OBS re-read
  the file. This needs OBS in **Advanced** output mode with CBR/VBR/ABR rate control. OBS rewrites
  that file when its own Settings dialog is saved, which can undo the change; the panel reports
  when that happens. The "Encoding at" figure comes from the latest OBS log.

## Security

The panel has **no authentication**. Anyone who can reach port 3000 can start and stop the
stream, signal the external processes it detects, and change OBS's source URL. Only run it on a
trusted network, or restrict it with the host firewall.

## Development

```bash
pnpm test        # vitest
pnpm typecheck
pnpm lint
```

Server code lives in `src/lib` (`procman.ts`, `obs.ts`, `mediamtx.ts`, `sysstats.ts`) and is
exposed through the route handlers in `src/app/api`. `src/lib/shared.ts` holds the constants and
types the client uses too.
