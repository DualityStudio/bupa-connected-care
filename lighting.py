"""Small Open DMX output used by the Raspberry Pi kiosk."""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any


LOGGER = logging.getLogger(__name__)
DMX_FRAME_SIZE = 513


def colour_to_rgb(colour: str) -> tuple[int, int, int]:
    """Convert a configured #RRGGBB colour into DMX channel values."""
    value = colour.strip().removeprefix("#")
    if len(value) != 6:
        raise ValueError(f"Invalid lighting colour: {colour}")

    try:
        return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))
    except ValueError as error:
        raise ValueError(f"Invalid lighting colour: {colour}") from error


class OpenDmxOutput:
    """Continuously transmit one DMX universe through an FTDI/Open DMX cable."""

    def __init__(self) -> None:
        self.mode = os.environ.get("BUPA_DMX_MODE", "auto").strip().lower()
        if self.mode not in {"auto", "off"}:
            raise RuntimeError("BUPA_DMX_MODE must be either 'auto' or 'off'")

        self.configured_device = os.environ.get("BUPA_DMX_DEVICE", "").strip()
        try:
            self.start_address = int(os.environ.get("BUPA_DMX_START_ADDRESS", "1"))
        except ValueError as error:
            raise RuntimeError("BUPA_DMX_START_ADDRESS must be a number") from error
        if not 1 <= self.start_address <= 509:
            raise RuntimeError("BUPA_DMX_START_ADDRESS must be between 1 and 509")

        self._lock = Lock()
        self._stop = Event()
        self._frame = bytearray(DMX_FRAME_SIZE)
        self._colour = (0, 0, 0, 0)
        self._connected = False
        self._active_device: str | None = None
        self._last_error: str | None = None
        self._serial_module: Any | None = None
        self._thread: Thread | None = None

        if self.mode == "off":
            LOGGER.info("DMX lighting is disabled by BUPA_DMX_MODE=off")
            return

        try:
            import serial
        except ImportError:
            self._last_error = "python3-serial is not installed"
            LOGGER.warning("DMX lighting disabled: %s", self._last_error)
            return

        self._serial_module = serial
        self._thread = Thread(target=self._run, name="dmx-output", daemon=True)
        self._thread.start()

    def set_rgbw(self, red: int, green: int, blue: int, white: int = 0) -> None:
        values = tuple(max(0, min(255, int(value))) for value in (red, green, blue, white))
        with self._lock:
            self._colour = values
            for offset, value in enumerate(values):
                self._frame[self.start_address + offset] = value

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "mode": self.mode,
                "enabled": self._serial_module is not None,
                "connected": self._connected,
                "device": self._active_device,
                "start_address": self.start_address,
                "rgbw": list(self._colour),
                "error": self._last_error,
            }

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1)

    def _find_device(self) -> str | None:
        if self.configured_device:
            device = Path(self.configured_device)
            return str(device) if device.exists() else None

        by_id = Path("/dev/serial/by-id")
        if by_id.exists():
            candidates = sorted(by_id.iterdir())
            preferred = [
                path
                for path in candidates
                if "ftdi" in path.name.lower() or "dmx" in path.name.lower()
            ]
            if preferred:
                return str(preferred[0])

        usb_devices = sorted(Path("/dev").glob("ttyUSB*"))
        return str(usb_devices[0]) if usb_devices else None

    def _set_connection_status(
        self,
        connected: bool,
        device: str | None,
        error: str | None,
    ) -> None:
        with self._lock:
            self._connected = connected
            self._active_device = device
            self._last_error = error

    def _run(self) -> None:
        assert self._serial_module is not None
        last_reported_error: str | None = None

        while not self._stop.is_set():
            device = self._find_device()
            if device is None:
                error = "No USB DMX device found"
                self._set_connection_status(False, None, error)
                if error != last_reported_error:
                    LOGGER.warning("DMX lighting waiting: %s", error)
                    last_reported_error = error
                self._stop.wait(2)
                continue

            port = None
            try:
                port = self._serial_module.Serial(
                    port=device,
                    baudrate=250000,
                    bytesize=self._serial_module.EIGHTBITS,
                    parity=self._serial_module.PARITY_NONE,
                    stopbits=self._serial_module.STOPBITS_TWO,
                    timeout=0,
                    write_timeout=1,
                )
                self._set_connection_status(True, device, None)
                LOGGER.info("DMX lighting connected on %s", device)
                last_reported_error = None

                while not self._stop.is_set():
                    with self._lock:
                        frame = bytes(self._frame)

                    # DMX512 requires an 88us minimum break and an 8us mark.
                    port.break_condition = True
                    time.sleep(0.00012)
                    port.break_condition = False
                    time.sleep(0.000012)
                    port.write(frame)
                    port.flush()
            except (OSError, self._serial_module.SerialException) as error:
                message = str(error)
                self._set_connection_status(False, device, message)
                if message != last_reported_error:
                    LOGGER.warning("DMX lighting disconnected from %s: %s", device, message)
                    last_reported_error = message
                self._stop.wait(2)
            finally:
                if port is not None:
                    try:
                        port.close()
                    except OSError:
                        pass
