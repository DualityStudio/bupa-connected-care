# DMX lighting setup

The kiosk can drive one Joylit DMX512 RGBW decoder through the DSD TECH USB-to-DMX cable. Lighting is deliberately independent of video playback:

- Before a persona is selected, the output is off.
- With a persona selected and the pressure mat released, the output uses that persona's `accent` colour from `content.json`.
- While the mat is pressed, red, green and blue are all set to full brightness to produce white.
- Releasing the mat immediately restores the persona colour. The visitor reset countdown continues separately.

The current RGB values are:

| Persona | Colour | DMX RGB |
| --- | --- | --- |
| Maya | `#2fce7c` | `47, 206, 124` |
| Mo | `#f7ab2f` | `247, 171, 47` |
| Mary | `#a06bff` | `160, 107, 255` |

## Connections

DMX signal:

```text
Raspberry Pi USB
  → DSD TECH USB-to-DMX cable
  → custom male 3-pin XLR-to-RJ45 adaptor
  → Joylit RJ45 DMX input
```

The RJ45 connection carries raw DMX and must never be connected to an Ethernet router, switch or Raspberry Pi network port. The custom adaptor must match the RJ45 pin assignment confirmed by the Joylit supplier.

Power and LED output:

```text
24V power supply +  → Joylit power input V+
24V power supply −  → Joylit power input V−

Joylit output V+     → LED common positive / +24V
Joylit output R      → LED red
Joylit output G      → LED green
Joylit output B      → LED blue
Joylit output W      → leave disconnected for a three-channel RGB light
```

Switch off and unplug the 24V supply while wiring. The USB-to-DMX cable carries control data only and does not power the Joylit or LEDs.

Set the Joylit DMX start address to `001`. The software sends:

- Address 1: green
- Address 2: red
- Address 3: blue
- Address 4: white, held at zero for the three-channel installation

The application continues to define persona colours as ordinary RGB values. Only the physical DMX output is reordered to GRBW to match the live-event controller channel layout.

## Apply this update to an installed Raspberry Pi

This is a one-time manual update on every device because it installs `python3-serial`, grants access to USB serial devices and refreshes the system service. The kiosk's normal **Check for Update** action only pulls application files and cannot perform these privileged installation steps.

Minimise or exit the kiosk, open a terminal, and run:

```bash
cd /path/to/bupa-screen-project
git pull --ff-only origin main
./scripts/install-pi.sh
sudo reboot
```

Replace `/path/to/bupa-screen-project` with the directory used when the kiosk was originally installed. The installer is safe to run again: it updates the existing service and desktop startup configuration rather than creating a second kiosk.

The installer:

- Installs the Raspberry Pi OS `python3-serial` package.
- Adds the `kiosk` user to the `dialout` group used by USB serial devices.
- Enables automatic DMX detection in `bupa-screen.service`.
- Restarts the service and preserves the existing kiosk, GPIO and update setup.

After this one-time installer run, ordinary code-only changes can continue to use the existing automatic or in-app update process.

## Bench test

1. Complete the kiosk pressure-mat test and choose a persona.
2. Connect the powered Joylit and LED strip, then connect the USB-to-DMX cable to the Pi.
3. With the mat released, confirm the LEDs show the chosen persona colour.
4. Press the mat, or use `/mat-controller`, and confirm the LEDs turn white.
5. Release the mat and confirm the persona colour returns immediately.
6. Repeat after changing persona through the hidden controls.

The kiosk continues operating if the DMX cable is missing or unplugged. The lighting process checks again every two seconds, so reconnecting the cable should not require a reboot.

## Check the connection

Open a terminal on the Pi and run:

```bash
curl -s http://localhost:5000/health | python3 -m json.tool
```

A working connection reports:

```json
{
  "dmx": {
    "connected": true,
    "device": "/dev/serial/by-id/...",
    "enabled": true,
    "frames_sent": 1234,
    "start_address": 1
  },
  "ok": true
}
```

Refresh the command after a few seconds. `frames_sent` should continue increasing while the USB-DMX cable is connected.

For recent lighting and server messages, run:

```bash
journalctl -u bupa-screen.service -n 100 --no-pager
```

If `enabled` is `false`, confirm `python3-serial` was installed by rerunning `./scripts/install-pi.sh`. If `enabled` is `true` but `connected` is `false`, check that the USB cable is attached and inspect the available device names:

```bash
ls -l /dev/serial/by-id/
ls -l /dev/ttyUSB*
```

## Configuration

The installed service uses automatic device detection and start address 1. These optional environment values are available for troubleshooting:

- `BUPA_DMX_MODE=auto` enables output and reconnects automatically.
- `BUPA_DMX_MODE=off` disables all DMX access for local testing.
- `BUPA_DMX_DEVICE=/dev/serial/by-id/...` selects a specific cable when more than one USB serial device is connected.
- `BUPA_DMX_START_ADDRESS=1` selects the first of the four consecutive RGBW addresses.

Local development without lighting hardware can use:

```bash
BUPA_GPIO_MODE=mock BUPA_DMX_MODE=off python3 app.py
```
