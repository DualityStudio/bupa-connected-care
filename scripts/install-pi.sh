#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
KIOSK_USER="${SUDO_USER:-$(id -un)}"
KIOSK_GROUP="$(id -gn "${KIOSK_USER}")"
KIOSK_HOME="$(getent passwd "${KIOSK_USER}" | cut -d: -f6)"
SERVICE_NAME="bupa-screen.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
AUTOSTART_PATH="${KIOSK_HOME}/.config/labwc/autostart"
AUTOSTART_START="# BUPA_SCREEN_KIOSK_START"
AUTOSTART_END="# BUPA_SCREEN_KIOSK_END"

if [[ -z "${KIOSK_HOME}" || ! -d "${KIOSK_HOME}" ]]; then
  echo "Could not find the home directory for ${KIOSK_USER}." >&2
  exit 1
fi

if [[ "$(uname -m)" != "aarch64" && "$(uname -m)" != arm* ]]; then
  echo "Warning: this installer is intended for Raspberry Pi OS." >&2
fi

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

echo "Installing Raspberry Pi packages…"
"${SUDO[@]}" apt update
"${SUDO[@]}" apt install -y python3-flask python3-gpiozero python3-waitress chromium curl

if getent group gpio >/dev/null; then
  "${SUDO[@]}" usermod -a -G gpio "${KIOSK_USER}"
fi

chmod +x "${APP_DIR}/scripts/start-kiosk.sh" "${APP_DIR}/scripts/install-pi.sh"
"${SUDO[@]}" install -d -o "${KIOSK_USER}" -g "${KIOSK_GROUP}" "${APP_DIR}/data/stats"

SERVICE_TEMP="$(mktemp)"
AUTOSTART_TEMP="$(mktemp)"
cleanup() {
  rm -f "${SERVICE_TEMP}" "${AUTOSTART_TEMP}"
}
trap cleanup EXIT

cat >"${SERVICE_TEMP}" <<EOF
[Unit]
Description=Bupa pressure-mat screen
After=local-fs.target

[Service]
Type=simple
User=${KIOSK_USER}
Group=${KIOSK_GROUP}
SupplementaryGroups=gpio
WorkingDirectory=${APP_DIR}
Environment=BUPA_GPIO_MODE=real
Environment=BUPA_STATE_PATH=/run/bupa-screen/station
Environment=PYTHONUNBUFFERED=1
RuntimeDirectory=bupa-screen
RuntimeDirectoryMode=0755
RuntimeDirectoryPreserve=restart
ExecStart=/usr/bin/waitress-serve --listen=0.0.0.0:5000 --threads=4 app:app
Restart=always
RestartSec=2
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF

"${SUDO[@]}" install -m 0644 "${SERVICE_TEMP}" "${SERVICE_PATH}"

"${SUDO[@]}" install -d -o "${KIOSK_USER}" -g "${KIOSK_GROUP}" "$(dirname "${AUTOSTART_PATH}")"
if [[ -f "${AUTOSTART_PATH}" ]]; then
  awk -v start="${AUTOSTART_START}" -v end="${AUTOSTART_END}" '
    $0 == start { skipping = 1; next }
    $0 == end { skipping = 0; next }
    !skipping { print }
  ' "${AUTOSTART_PATH}" >"${AUTOSTART_TEMP}"
fi

cat >>"${AUTOSTART_TEMP}" <<EOF

${AUTOSTART_START}
"${APP_DIR}/scripts/start-kiosk.sh" &
${AUTOSTART_END}
EOF

"${SUDO[@]}" install -o "${KIOSK_USER}" -g "${KIOSK_GROUP}" -m 0644 "${AUTOSTART_TEMP}" "${AUTOSTART_PATH}"

if command -v raspi-config >/dev/null; then
  echo "Enabling desktop auto-login…"
  "${SUDO[@]}" raspi-config nonint do_boot_behaviour B4
else
  echo "Warning: raspi-config was not found. Enable desktop auto-login manually." >&2
fi

"${SUDO[@]}" systemctl daemon-reload
"${SUDO[@]}" systemctl enable "${SERVICE_NAME}"
"${SUDO[@]}" systemctl restart "${SERVICE_NAME}"

echo
echo "Installation complete."
echo "Reboot the Raspberry Pi to test the full kiosk startup."
echo "Before exhibition use, set the display to portrait and disable screen blanking."
