# Raspberry Pi pressure-mat video kiosk

A local Flask application for a Raspberry Pi 4, portrait touchscreen, and pressure mat. It includes:

- Boot-time mat testing and MAYA/MO/MARY station selection.
- A shared idle loop, station welcome video, three watched/replayable stories, and final text.
- Five-second step-away reset and a hidden 10-tap system menu.
- A separate mat controller that can be loaded on a phone or second computer in either GPIO mode.
- Timed animated placeholders, so the complete interaction works before the videos arrive.

## Try it without a Raspberry Pi

Create a virtual environment and install Flask:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

Start the server in mock mode:

```bash
BUPA_GPIO_MODE=mock python3 app.py
```

Open these two pages:

- Visitor screen: [http://localhost:5000](http://localhost:5000)
- Pressure controller: [http://localhost:5000/mat-controller](http://localhost:5000/mat-controller)

The controller has separate **Stand on mat** and **Step off mat** buttons. Its state stays latched, just like remaining on or leaving a physical pressure mat. On a Pi in real GPIO mode, controller pressure works alongside the physical mat; releasing the controller does not override a physically pressed mat.

The repeated press test remains available directly at `/mat-test`. This page counts each released-to-pressed transition, shows the live mat state, and provides a reset button. Its temporary count is not included in the daily visitor statistics.

To control the experience from another device on the same network, replace `localhost` with the server computer's IP address or hostname. For example: `http://raspberrypi.local:5000/mat-controller`.

## Visitor flow

1. Use the mat once to pass the setup test.
2. Select MAYA, MO, or MARY.
3. If the mat is still pressed when the persona is selected, its welcome video starts immediately and the story buttons light up. Otherwise, the shared idle video loops with the buttons dimmed and a prompt asks the visitor to step on the spot.
4. A fresh press plays the selected station's welcome video. The buttons remain available, and when the welcome finishes the idle video starts again with the **Tap the buttons** prompt visible. The prompt stays hidden while the welcome or a selected story is playing.
5. Watch the three stories in any order. Buttons remain visible during playback, another story can be selected at any time, and watched stories remain available for replay.
6. Each completed story returns to the idle loop and removes its progress bar. After all three distinct stories finish, the buttons fade away and the station's Connected Care Outcome appears for 16 seconds with a persona-coloured progress bar before returning to the start automatically. Tapping the outcome dismisses it early and returns to the idle loop with the active buttons and watched markers preserved; stepping off then starts the normal five-second timeout.
7. Returning from the outcome enters a lights-out start state. If the previous visitor is still on the mat, stepping off quietly re-arms it without showing the five-second countdown; the next fresh press starts the introduction.
8. Leaving the mat during an active welcome or story starts the five-second countdown while the current video continues playing. The transparent overlaid buttons dim and **Step on the spot for the introduction** appears. Returning during the countdown cancels the pending reset without interrupting playback; expiry clears watched progress and starts the idle video.

Tap any non-interactive area 10 times within four seconds to open the hidden system controls on the kiosk, mat controller, repeated press test, or statistics page. Taps on buttons, links, and form fields do not count. Every page can reset the experience, open statistics, check for an application update, or exit the kiosk; persona selection appears only on the visitor kiosk. The initial setup screen also provides a link to the pressure-mat counter. Resetting does not change the selected persona.

## Edit the content

All labels, placeholder timings, media paths, accent colours, and final text live in [`content.json`](content.json). It contains:

- A unique looping `idleVideo` for MAYA, MO, and MARY.
- A unique `welcomeVideo` for MAYA, MO, and MARY.
- Three unique `videos` per station.
- One `finalText` per station.

Leave a video's `src` empty to use its timed placeholder:

```json
{
  "label": "Staying well",
  "icon": "wellness",
  "src": "",
  "placeholderDuration": 7
}
```

The application is configured to load five files for each persona from `static/media/<persona>`: `idle.mp4`, `welcome.mp4`, and `story-1.mp4` through `story-3.mp4`. The complete filename-to-story mapping is in [`static/media/README.md`](static/media/README.md). For example:

```json
{
  "label": "Staying well",
  "icon": "wellness",
  "src": "/static/media/maya/story-1.mp4",
  "placeholderDuration": 7
}
```

The optimised 1080 × 1920 MP4 files are tracked by Git, so application updates install them on each Pi. The separate 4K source backup remains ignored. Restart the server after editing `content.json` or replacing media. Recommended delivery format for the Pi 4 is portrait 1080 × 1920, H.264 video, AAC audio, in an MP4 container.

## Pressure-mat wiring

The application uses the same pin as the original prototype:

- BCM GPIO 17 — physical header pin 11.
- Ground — for example, physical header pin 9.

Connect the normally-open pressure mat between GPIO 17 and ground. The internal pull-up is enabled in software, so do not connect the mat to 3.3 V or 5 V.

## Install on a Raspberry Pi 4

Use the current 64-bit Raspberry Pi OS with Desktop. From this project directory, run:

```bash
chmod +x scripts/install-pi.sh scripts/start-kiosk.sh
./scripts/install-pi.sh
sudo reboot
```

The installer:

- Installs Flask, Waitress, GPIO Zero, Chromium, curl, and Git from Raspberry Pi OS packages. Montserrat is bundled with the application so the kiosk typography works without internet access.
- Grants the kiosk user GPIO access.
- Serves the Flask application through Waitress as `bupa-screen.service` and restarts it after failures.
- Enables desktop auto-login.
- Adds a managed kiosk entry to `~/.config/labwc/autostart`.
- Checks `origin/main` once per boot and runs a fast-forward-only pull when that branch is reachable. A failed or unavailable update never prevents startup.
- Waits for the local server, then opens Chromium fullscreen with audible autoplay enabled. Chromium uses its local basic password store so automatic login does not prompt to unlock the desktop keyring.
- Restarts Chromium after an unexpected failure, while allowing a deliberate `Alt` + `F4` close to remain closed for maintenance.

The station selection is saved under `/run/bupa-screen`. Page refreshes and automatic service restarts retain it, while stopping the service or rebooting the Pi clears it and returns to mat testing and station selection.

### Automatic updates

The update check runs before the server starts. It contacts the repository's `origin/main` branch, which verifies both internet connectivity and Git access more accurately than testing an unrelated website. If the check succeeds, the Pi runs `git pull --ff-only origin main`; otherwise it immediately continues with the installed version. Naming the branch explicitly means the updater does not depend on a configured upstream or remote default branch. The remote check has a 15-second limit and the pull has a five-minute limit.

The pull is non-interactive. Private repositories therefore need an SSH key or other credentials that already work without entering a password. Local changes or a branch that cannot be fast-forwarded are left untouched and cause the update to be skipped safely. Details are written to the service journal.

The hidden system controls also provide **Check for Update**. It remains disabled unless the Pi can reach and authenticate with the configured Git remote. A successful update restarts the system service automatically; when running the development server directly, restart it manually to load the new Python code.

To enable automatic updates on an already-installed Pi, pull this version and run the installer once more:

```bash
git pull --ff-only origin main
./scripts/install-pi.sh
sudo reboot
```

Future reboots will update automatically. Ordinary service crash restarts do not repeatedly contact Git. If a future update changes system packages or the system service itself, rerun `./scripts/install-pi.sh` manually after that update.

## Pressure-mat test counter

The counter at `/mat-test` is persisted separately in `data/mat-test-counter.json`. It survives page reloads, Chromium restarts, application restarts, and Pi reboots. It is not included in the daily statistics files and never appears on the `/stats` screen.

The file is ignored by Git and has this format:

```json
{
  "count": 123,
  "updated_at": "2026-09-25T10:30:00+01:00"
}
```

To restore the number already shown on a Pi after installing this version, replace `123` with that number and run this from the Pi:

```bash
curl -X POST http://localhost:5000/api/mat-test-counter \
  -H 'Content-Type: application/json' \
  -d '{"action":"set","count":123}'
```

The response shows the saved count. Opening `/mat-test` then loads that value. The page's **Reset counter** button writes zero to this same file.

## Daily statistics

The kiosk writes one file per day under `data/stats`, for example `data/stats/2026-09-16.json`. These generated files are ignored by Git and remain on the Pi across service restarts and reboots.

Open `/stats` on the Pi, or choose **View statistics** in the hidden system controls, to view every available daily file. Dates use UK day/month/year formatting, and a dropdown at the top selects any earlier saved day. The page is read-only and includes a refresh button.

Each file records:

- Pressure-mat visitor triggers, as a total and by station. Setup testing and returning during the reset countdown are not counted.
- Every idle, welcome, and story video start. Replays count as additional plays.
- Completed sequences, as a total and by station, when a visitor reaches the final text.

Dates and midnight rollover use the Pi's configured local timezone. Old days are retained and the next event after midnight creates a new file with fresh counters. The filenames and video keys come from `content.json`, so it is best to copy the files off the Pi before renaming video IDs.

To list the available files on the Pi:

```bash
ls -lh data/stats
```

From another computer, copy them into a device-specific folder with `scp`, replacing the username, hostname, and project path as needed:

```bash
scp 'pi@raspberrypi.local:/path/to/bupa-screen-project/data/stats/*.json' ./maya-screen-stats/
```

Before a live event, move any test-day JSON files elsewhere or delete those individual files. The kiosk recreates the current day's file on the next recorded event.

### Display and sound setup

Before exhibition use, open **Raspberry Pi menu → Preferences → Control Centre**:

1. Under **Screens**, set the display to 1080 × 1920 portrait orientation at 60 Hz.
2. Under **Display**, turn **Screen Blanking** off.
3. Use the sound menu to select the intended HDMI or USB audio output and set its volume.

The idle loop is deliberately audible. Chromium is started with `--autoplay-policy=no-user-gesture-required`; an ordinary browser without this flag displays a tap-to-start prompt if it blocks sound.

## Operation and troubleshooting

### Leave kiosk mode and perform maintenance

Choose **Exit Kiosk** in the hidden system controls to close Chromium and leave the desktop visible. The kiosk launcher treats this as a deliberate exit and does not reopen the browser. The Flask server remains running in the background. With a keyboard connected, `Alt` + `F4` provides the same result. Open a terminal with `Ctrl` + `Alt` + `T`.

To launch the kiosk again without rebooting, run this from the project directory:

```bash
./scripts/start-kiosk.sh &
```

If a Pi is still running an older version of the launcher that immediately reopens Chromium, press `Ctrl` + `Alt` + `F2` to reach a text login. Log in with the Pi username and password; Chromium can continue running on the desktop without blocking this console. From there you can update and reboot:

```bash
cd /path/to/bupa-screen-project
git pull --ff-only origin main
sudo reboot
```

Use `Ctrl` + `Alt` + `F7` to return to the graphical desktop if you decide not to reboot. On an installation that assigns the desktop to a different console, try `Ctrl` + `Alt` + `F1` instead.

For routine remote maintenance, enable SSH in **Raspberry Pi Configuration → Interfaces → SSH**. You can then connect from another computer:

```bash
ssh your-username@raspberrypi.local
```

From that connection, use `git pull --ff-only origin main` followed by `sudo reboot` to deploy an update, or shut down safely with:

```bash
sudo poweroff
```

Check the service:

```bash
systemctl status bupa-screen.service
```

View recent server logs:

```bash
journalctl -u bupa-screen.service -n 100 --no-pager
```

Restart after changing content:

```bash
sudo systemctl restart bupa-screen.service
```

The selected station survives this restart. To deliberately return to installation setup, stop and start the service instead:

```bash
sudo systemctl stop bupa-screen.service
sudo systemctl start bupa-screen.service
```

Temporarily test the Pi without GPIO by stopping the installed service and starting mock mode manually:

```bash
sudo systemctl stop bupa-screen.service
BUPA_GPIO_MODE=mock python3 app.py
```

The `/mat-controller` page remains available in real GPIO mode and works alongside the physical pressure mat. If the physical GPIO cannot initialise during server startup, the server still exits with a clear error rather than silently replacing the configured hardware input.

## Remove the boot setup

Disable and remove the server service:

```bash
sudo systemctl disable --now bupa-screen.service
sudo rm /etc/systemd/system/bupa-screen.service
sudo systemctl daemon-reload
```

Then remove the block between `# BUPA_SCREEN_KIOSK_START` and `# BUPA_SCREEN_KIOSK_END` from `~/.config/labwc/autostart`.
