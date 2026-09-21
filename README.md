# Raspberry Pi pressure-mat video kiosk

A local Flask application for a Raspberry Pi 4, portrait touchscreen, and pressure mat. It includes:

- Boot-time mat testing and MAYA/MO/MARY station selection.
- A shared idle loop, station welcome video, three watched/replayable stories, and final text.
- Five-second step-away reset and a hidden reset target in the top-right 96 pixels.
- A separate mock controller that can be loaded on a phone or second computer.
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
- Pressure controller: [http://localhost:5000/mock](http://localhost:5000/mock)

The controller has separate **Stand on mat** and **Step off mat** buttons. Its state stays latched, just like remaining on or leaving a physical pressure mat.

To control the experience from another device on the same network, replace `localhost` with the server computer's IP address or hostname. For example: `http://raspberrypi.local:5000/mock`.

## Visitor flow

1. Use the mat once to pass the setup test.
2. Select MAYA, MO, or MARY.
3. Release the mat so the experience can arm.
4. The shared idle video loops until a fresh press.
5. A press plays the selected station's welcome video.
6. Watch the three stories in any order. Watched stories remain available for replay.
7. The station's final text appears after all three distinct stories finish.
8. Leaving the mat for five continuous seconds clears progress and returns to idle. Returning during the countdown cancels it.

The invisible top-right 96 × 96 pixel area resets the visitor experience immediately. It does not change the selected station.

## Edit the content

All labels, placeholder timings, media paths, accent colours, and final text live in [`content.json`](content.json). It contains:

- One shared `idleVideo`.
- A unique `welcomeVideo` for MAYA, MO, and MARY.
- Three unique `videos` per station.
- One `finalText` per station.

Leave a video's `src` empty to use its timed placeholder:

```json
{
  "label": "Maya · Story 1",
  "src": "",
  "placeholderDuration": 7
}
```

To use a real file, copy it under `static/media` and set a browser path:

```json
{
  "label": "Maya · Story 1",
  "src": "/static/media/maya/story-1.mp4",
  "placeholderDuration": 7
}
```

Restart the server after editing `content.json`. Recommended delivery format for the Pi 4 is portrait 1080 × 1920, H.264 video, AAC audio, in an MP4 container.

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

- Installs Flask, Waitress, GPIO Zero, Chromium, and curl from Raspberry Pi OS packages.
- Grants the kiosk user GPIO access.
- Serves the Flask application through Waitress as `bupa-screen.service` and restarts it after failures.
- Enables desktop auto-login.
- Adds a managed kiosk entry to `~/.config/labwc/autostart`.
- Waits for the local server, then opens Chromium fullscreen with audible autoplay enabled. Chromium uses its local basic password store so automatic login does not prompt to unlock the desktop keyring.
- Restarts Chromium after an unexpected failure, while allowing a deliberate `Alt` + `F4` close to remain closed for maintenance.

The station selection is saved under `/run/bupa-screen`. Page refreshes and automatic service restarts retain it, while stopping the service or rebooting the Pi clears it and returns to mat testing and station selection.

## Daily statistics

The kiosk writes one file per day under `data/stats`, for example `data/stats/2026-09-16.json`. These generated files are ignored by Git and remain on the Pi across service restarts and reboots.

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

With a keyboard connected, press `Alt` + `F4` to close Chromium. A normal close now leaves the desktop visible instead of triggering the crash restart loop. Open a terminal with `Ctrl` + `Alt` + `T`.

To launch the kiosk again without rebooting, run this from the project directory:

```bash
./scripts/start-kiosk.sh &
```

If a Pi is still running an older version of the launcher that immediately reopens Chromium, press `Ctrl` + `Alt` + `F2` to reach a text login. Log in with the Pi username and password; Chromium can continue running on the desktop without blocking this console. From there you can update and reboot:

```bash
cd /path/to/bupa-screen-project
git pull --ff-only
sudo reboot
```

Use `Ctrl` + `Alt` + `F7` to return to the graphical desktop if you decide not to reboot. On an installation that assigns the desktop to a different console, try `Ctrl` + `Alt` + `F1` instead.

For routine remote maintenance, enable SSH in **Raspberry Pi Configuration → Interfaces → SSH**. You can then connect from another computer:

```bash
ssh your-username@raspberrypi.local
```

From that connection, use `git pull --ff-only` followed by `sudo reboot` to deploy an update, or shut down safely with:

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

The mock controller is intentionally unavailable in real GPIO mode. If the physical GPIO cannot initialise, the server exits with a clear error instead of silently simulating a working mat.

## Remove the boot setup

Disable and remove the server service:

```bash
sudo systemctl disable --now bupa-screen.service
sudo rm /etc/systemd/system/bupa-screen.service
sudo systemctl daemon-reload
```

Then remove the block between `# BUPA_SCREEN_KIOSK_START` and `# BUPA_SCREEN_KIOSK_END` from `~/.config/labwc/autostart`.
