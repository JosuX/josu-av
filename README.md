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

- **Dashboard** (`/`): live feed, start/stop/restart for each process, network and memory charts.
- **Log monitor** (`/logs`): live, filterable output from each process, with download.
- **Settings** (`/settings`): the OBS media source URL (IP camera), the stream bitrate, and
  switching OBS's stream service to WHIP.

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

The commands themselves are defined in `src/lib/config.ts`.

## How it behaves

- **Process supervision.** The panel spawns MediaMTX (and FFmpeg in RTMP mode) as child
  processes and keeps the last 3,000 log lines of each. FFmpeg restarts itself every 3 s after it
  exits, because it exits whenever OBS stops publishing.
- **Player.** The dashboard's WebRTC player sends its offer after at most 250 ms of ICE
  gathering, asks the browser for no extra playout buffering, rides out brief network drops
  for 2 s, and otherwise reconnects with a backoff from 0.5 s up to 5 s.
- **Shutdown.** Children get SIGTERM when the server exits normally. They are spawned through
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
  and starts it again. If the start fails, the panel retries once after 2 s; if that fails too,
  the Settings page shows **The stream is OFF** with a button to start it. Switching to WHIP
  restarts the stream even when OBS rejects the new service settings.

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
