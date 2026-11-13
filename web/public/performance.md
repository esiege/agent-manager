# Agent Manager: sending performance data from a game

You are adding performance reporting to a game or app, so its frame rate, frame times and memory show up on the **Performance** tab of Agent Manager for every machine it runs on. This page tells you what to send. It is plain HTTPS and JSON, so it works from any engine.

- **`$MANAGER_URL`** below means the address you fetched this page from, without `/performance.md`.
- **The key** goes in the `X-Agent-Manager-Key` header of every call (not `Authorization`, which the host replaces). Use a **game key**: the person makes one on the **Settings** tab, choosing "A game (performance data only)". A game key can only make the two calls on this page, so it is safe to put in a build that goes to other people's machines. Never put a machine key (the one in `AGENT_MANAGER_KEY`) in a build. Keep the game key out of a public repository all the same: load it from a build setting or a file that isn't committed.
- Every call is a `POST` with a JSON body, and answers JSON. A refused call returns 4xx with `{"error": "<one line saying what to fix>"}`. Add `"test": true` to check a call without storing anything.
- Send nothing personal: no player names, account ids, IP addresses or file paths. A machine name is enough to tell machines apart; for players' machines, use a random id the game makes once and keeps.

## How it fits together

A **session** is one run of the game on one machine. The game makes its id, says what it is running on, then sends **samples**: what it measured over each window of a few seconds. Agent Manager adds the samples up per session, and compares sessions by machine, build and GPU.

1. At startup, make a session id (a UUID) and call **session**.
2. While running, measure each frame. Every 5 to 10 seconds, turn the window into one sample. Send the samples you have every 30 to 60 seconds, in one call.
3. On exit, send what is left, then call **session** again with `"ended": true`.

## Session: `POST $MANAGER_URL/api/v1/perf/session`

Call it again with the same `sessionId` to add to what is known or to end the session. Fields you leave out keep their value.

| Field | Required | Meaning |
| --- | --- | --- |
| `sessionId` | yes | 8 to 64 letters, digits, dots, dashes or underscores. A UUID works. New for every run. |
| `game` | yes | The game's name, the same on every machine. |
| `machine` | yes | The machine: its host name on your own PCs, a stored random id on anyone else's. |
| `build` | no | The version or commit that is running. Send it: comparing builds is half the point. |
| `platform` | no | `windows`, `linux`, `macos`, `steamdeck`, `android`... |
| `cpu`, `gpu`, `os` | no | Their names as the engine reports them. |
| `cpuCores`, `ramMb`, `vramMb`, `refreshHz` | no | Numbers. |
| `resolution` | no | Such as `2560x1440`. |
| `loadSeconds` | no | How long the game took to start, up to its first playable frame. Send it once it's known. |
| `details` | no | Any other JSON worth comparing runs by: quality preset, graphics API, GPU driver, window mode, screen percentage. Unknown top-level fields are kept here too. |
| `ended` | no | `true` when the run is over. |

The answer includes `sessionUrl`, the session's page in Agent Manager.

```bash
curl -fsS -X POST "$MANAGER_URL/api/v1/perf/session" \
  -H "X-Agent-Manager-Key: $GAME_KEY" -H "Content-Type: application/json" \
  -d '{"sessionId":"0b9c1c1e-6f0a-4c56-9a53-2f8f4d1f7a10","game":"musik","machine":"pc-studio","build":"0.4.2","platform":"windows","gpu":"NVIDIA GeForce RTX 4070","cpu":"AMD Ryzen 7 7800X3D","cpuCores":8,"ramMb":32768,"resolution":"2560x1440","refreshHz":144,"details":{"quality":"high"}}'
```

## Samples: `POST $MANAGER_URL/api/v1/perf/samples`

Body: `{"sessionId": "...", "samples": [ ... ], "hitchEvents": [ ... ]}` with up to 500 samples per call (512 KB at most). Either list can be left out. The session must exist: an unknown `sessionId` answers 404. Each sample covers one window:

| Field | Required | Meaning |
| --- | --- | --- |
| `t` | yes | Seconds since the session started, at the end of the window. Use the engine's clock, not the wall clock. It identifies the sample, so each one needs its own. |
| `seconds` | yes | How long the window was. |
| `frames` | yes | Frames drawn in it. Agent Manager works out the FPS: `frames / seconds`. |
| `frameMsP50`, `frameMsP95`, `frameMsP99` | no | Percentiles of the window's frame times, in milliseconds: sort the window's frame times and take the value 50%, 95% and 99% of the way along. |
| `frameMsMax` | no | The slowest frame in the window. |
| `hitches` | no | Frames slow enough to notice. You choose the threshold and keep it the same everywhere; 50 ms is common. |
| `gameMs`, `renderMs`, `gpuMs` | no | Average game-thread, render-thread and GPU time per frame (Unreal's `stat unit` numbers). Agent Manager says which one the frame waited on. An engine that doesn't split the CPU's work by thread sends `cpuMs` and `gpuMs`. |
| `memoryMb`, `vramMb` | no | Memory and video memory in use at the end of the window. |
| `drawCalls` | no | Average per frame. |
| `pingMs` | no | For networked games. |
| `scene` | no | The level, scene or menu the window was in. The session's page breaks the numbers down by it. |
| `metrics` | no | Any other numbers, by name: `{"entities": 412, "particles": 9000}`. Each gets its own chart. Up to 32. A number under any other unknown field is kept as a metric too. |

`hitchEvents` lists single slow frames, so there is something to open in a profiler: `{"t": 41.2, "frameMs": 140.2, "gameMs": 30, "renderMs": 120, "gpuMs": 20, "scene": "fire"}`. Only `t` and `frameMs` are required. Send up to 200 per call; the session keeps the worst 50 of everything it is sent.

**How fine a timeline?** A window is one point on the session's charts, and one stored record. Windows of 1 to 2 seconds give a detailed timeline for a short test run; 5 to 10 seconds suits long sessions. Use `scene` for the stretches of a run you want compared (`load`, `title`, `countdown`, `flight`).

Send as many of the optional fields as the engine can measure cheaply. The frame-time percentiles matter most: an average hides stutter, the 99th percentile shows it.

```bash
curl -fsS -X POST "$MANAGER_URL/api/v1/perf/samples" \
  -H "X-Agent-Manager-Key: $GAME_KEY" -H "Content-Type: application/json" \
  -d '{"sessionId":"0b9c1c1e-6f0a-4c56-9a53-2f8f4d1f7a10","samples":[{"t":10,"seconds":10,"frames":1432,"frameMsP50":6.9,"frameMsP95":8.4,"frameMsP99":11.2,"frameMsMax":41.0,"hitches":0,"memoryMb":1840,"scene":"level-1","metrics":{"entities":412}}]}'
```

The answer's `stored` says how many samples were new (`count`) and how many it already had (`duplicates`).

## Getting it right in the game

- **Never let reporting cost frames.** Measure on the main thread (a subtraction per frame), but do the JSON and the HTTP call off it: a background thread, a coroutine, or the engine's async HTTP client. Use a timeout of a few seconds.
- **Never let it break the game.** If a call fails, keep the samples and try again with the next batch. It is safe to send a sample twice: it is stored once. Keep at most a few hundred unsent samples, then drop the oldest. If the key is refused (401 or 403), stop for the rest of the run.
- **At most a call every few seconds.** Each key is limited to 10 calls a second across every machine that uses it, so batch. One call a minute per running game is plenty.
- **Skip windows that say nothing**: while the game is paused, minimized or loading. Or send them under their own `scene` (`"loading"`), so they don't drag down a level's numbers.
- **Make it easy to turn off**, with a setting or a launch flag, and leave it off where nobody agreed to it.

## Reading it back

An agent on a PC that is set up with `agentctl` (so with a machine key, not a game key) can read what games sent:

```bash
node "$HOME/.agent-manager/agentctl.js" perf --game musik --limit 20   # one line a session, newest first; --json for JSON
node "$HOME/.agent-manager/agentctl.js" perf <sessionId>               # the whole session as JSON: totals, worst hitches, samples
```

Those are `GET $MANAGER_URL/api/v1/perf/sessions?game=&days=&limit=` and `GET $MANAGER_URL/api/v1/perf/session?id=`, with the machine key in `X-Agent-Manager-Key`. If `perf` is an unknown command, the PC has an older `agentctl.js`: download it again as `$MANAGER_URL/instructions.md` describes.

## What is kept

A session and its totals are kept for a year after it last sent something. The samples behind its charts are kept for 30 days.

## Check that it works

Send a test session. It is checked but not stored:

```bash
curl -fsS -X POST "$MANAGER_URL/api/v1/perf/session" \
  -H "X-Agent-Manager-Key: $GAME_KEY" -H "Content-Type: application/json" \
  -d '{"sessionId":"setup-check-0001","game":"setup-check","machine":"'"$(hostname)"'","test":true}'
```

A working setup answers `{"ok":true,"test":true,...}`. A 401 means the key is missing, wrong or revoked. A 403 on these two calls doesn't happen with a game key; on any other call it means you are using a game key where a machine key is needed. Then run the game for a minute and tell the person where to see it: the `sessionUrl` from the session call.
