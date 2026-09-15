#!/usr/bin/env python3
"""Local Flask server for the Raspberry Pi pressure-mat video kiosk."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from threading import Lock
from typing import Any

from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent
CONTENT_PATH = BASE_DIR / "content.json"
GPIO_PIN = 17
STATE_PATH_VALUE = os.environ.get("BUPA_STATE_PATH", "").strip()
STATE_PATH = Path(STATE_PATH_VALUE) if STATE_PATH_VALUE else None


def load_content() -> dict[str, Any]:
    with CONTENT_PATH.open(encoding="utf-8") as content_file:
        content = json.load(content_file)

    expected_stations = {"maya", "mo", "mary"}
    stations = content.get("stations", {})
    if set(stations) != expected_stations:
        raise ValueError("content.json must define exactly MAYA, MO and MARY")

    for station_id, station in stations.items():
        videos = station.get("videos", [])
        if len(videos) != 3:
            raise ValueError(f"Station {station_id} must define exactly three videos")

        video_ids = [video.get("id") for video in videos]
        if len(set(video_ids)) != 3 or any(not video_id for video_id in video_ids):
            raise ValueError(f"Station {station_id} must use three unique video IDs")

    return content


class MockPressureInput:
    mode = "mock"

    def __init__(self) -> None:
        self._pressed = False
        self._lock = Lock()

    @property
    def is_pressed(self) -> bool:
        with self._lock:
            return self._pressed

    def set_pressed(self, pressed: bool) -> None:
        with self._lock:
            self._pressed = pressed


class GPIOPressureInput:
    mode = "real"

    def __init__(self) -> None:
        try:
            from gpiozero import Button
        except ImportError as error:
            raise RuntimeError(
                "gpiozero is required in real mode. Install python3-gpiozero or "
                "run with BUPA_GPIO_MODE=mock."
            ) from error

        try:
            self._button = Button(GPIO_PIN, pull_up=True, bounce_time=0.05)
        except Exception as error:
            raise RuntimeError(
                f"Could not initialise the pressure mat on BCM GPIO {GPIO_PIN}. "
                "Check GPIO access and wiring."
            ) from error

    @property
    def is_pressed(self) -> bool:
        return bool(self._button.is_pressed)


def create_pressure_input() -> MockPressureInput | GPIOPressureInput:
    mode = os.environ.get("BUPA_GPIO_MODE", "real").strip().lower()
    if mode == "mock":
        return MockPressureInput()
    if mode == "real":
        return GPIOPressureInput()
    raise RuntimeError("BUPA_GPIO_MODE must be either 'real' or 'mock'")


def load_selected_station(stations: dict[str, Any]) -> str | None:
    if STATE_PATH is None or not STATE_PATH.exists():
        return None

    try:
        station = STATE_PATH.read_text(encoding="utf-8").strip()
    except OSError as error:
        logging.warning("Could not read saved station state: %s", error)
        return None

    if station not in stations:
        logging.warning("Ignoring invalid saved station state: %s", station)
        return None
    return station


def save_selected_station(station: str) -> None:
    if STATE_PATH is None:
        return

    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = STATE_PATH.with_name(f".{STATE_PATH.name}.tmp")
    temporary_path.write_text(f"{station}\n", encoding="utf-8")
    temporary_path.replace(STATE_PATH)


app = Flask(__name__)
logging.getLogger("werkzeug").setLevel(logging.ERROR)
content_config = load_content()
pressure_input = create_pressure_input()
runtime_lock = Lock()
selected_station = load_selected_station(content_config["stations"])


@app.get("/")
def index():
    return render_template("index.html", content=content_config)


@app.get("/mock")
def mock_controller():
    return render_template("mock.html")


@app.get("/health")
def health():
    return jsonify({"ok": True, "mode": pressure_input.mode})


@app.get("/api/status")
def pressure_status():
    try:
        pressed = pressure_input.is_pressed
    except Exception as error:
        return (
            jsonify(
                {
                    "error": "Unable to read the pressure mat",
                    "detail": str(error),
                    "mode": pressure_input.mode,
                }
            ),
            503,
        )

    with runtime_lock:
        station = selected_station

    response = jsonify(
        {
            "pressed": pressed,
            "mode": pressure_input.mode,
            "selected_station": station,
        }
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/station")
def choose_station():
    data = request.get_json(silent=True) or {}
    station = data.get("station")
    if station not in content_config["stations"]:
        return jsonify({"error": "Station must be maya, mo or mary"}), 400

    global selected_station
    with runtime_lock:
        try:
            save_selected_station(station)
        except OSError as error:
            app.logger.error("Could not save station state: %s", error)
            return jsonify({"error": "The station selection could not be saved"}), 500
        selected_station = station

    return jsonify({"selected_station": station})


@app.post("/api/mock-pressure")
def set_mock_pressure():
    if not isinstance(pressure_input, MockPressureInput):
        return jsonify({"error": "Mock pressure controls are disabled in real GPIO mode"}), 403

    data = request.get_json(silent=True) or {}
    pressed = data.get("pressed")
    if not isinstance(pressed, bool):
        return jsonify({"error": "pressed must be a boolean"}), 400

    pressure_input.set_pressed(pressed)
    return jsonify({"pressed": pressure_input.is_pressed, "mode": pressure_input.mode})


if __name__ == "__main__":
    host = os.environ.get("BUPA_HOST", "0.0.0.0")
    port = int(os.environ.get("BUPA_PORT", "5000"))
    app.run(host=host, port=port, threaded=True, use_reloader=False)
