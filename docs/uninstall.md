# Uninstall the Raspberry Pi kiosk

These steps remove the kiosk from automatic startup without immediately deleting the project files or collected statistics.

## 1. Preserve event data

Before removing anything, copy these files somewhere safe if they are needed:

- Daily statistics: `data/stats/*.json`
- Pressure-mat test count: `data/mat-test-counter.json`

The paths are relative to the `bupa-screen-project` directory. Copying the complete project directory also preserves both sets of data.

## 2. Remove the server service

Open a terminal and run:

```bash
sudo systemctl disable --now bupa-screen.service
sudo rm -f /etc/systemd/system/bupa-screen.service
sudo systemctl daemon-reload
```

This stops the Python server and prevents it from starting after a reboot.

## 3. Remove automatic Chromium startup

Open this file in a text editor:

```text
~/.config/labwc/autostart
```

Remove the complete block beginning and ending with these markers:

```text
# BUPA_SCREEN_KIOSK_START
# BUPA_SCREEN_KIOSK_END
```

Then open:

```text
~/.config/labwc/rc.xml
```

Remove the complete keyboard shortcut block beginning and ending with:

```text
<!-- BUPA_SCREEN_KIOSK_KEYS_START -->
<!-- BUPA_SCREEN_KIOSK_KEYS_END -->
```

Do not remove any content outside those marked blocks.

## 4. Reboot and verify

```bash
sudo reboot
```

After rebooting, Chromium should no longer open the kiosk automatically. This command should report that the service cannot be found:

```bash
systemctl status bupa-screen.service
```

## 5. Optional cleanup

Once the statistics have been preserved and the removal has been verified, the following items can be deleted manually:

- The `bupa-screen-project` directory.
- The kiosk log directory at `~/.local/state/bupa-screen`.

The installer also enables desktop auto-login. To change that, run `sudo raspi-config`, open the boot or auto-login settings, and select the preferred login behaviour.

The installer deliberately does not remove shared packages such as Chromium, Git, Python, Flask or `wvkbd`, because they may be used by other applications. It also leaves the user in the `gpio` and `dialout` groups for the same reason.

## Optional OLA test installation

OLA is not currently installed by this project. If OLA was installed manually only for DMX testing and is no longer wanted, stop it and remove it separately:

```bash
sudo service olad stop
sudo systemctl disable olad
sudo apt remove ola
```

Do not remove OLA from a device if another lighting application uses it.
