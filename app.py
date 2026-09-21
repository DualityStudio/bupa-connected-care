#!/usr/bin/env python3
"""Local Flask server for the Raspberry Pi pressure-mat video kiosk."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any

from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent
CONTENT_PATH = BASE_DIR / "content.json"
GPIO_PIN = 17
STATE_PATH_VALUE = os.environ.get("BUPA_STATE_PATH", "").strip()
STATE_PATH = Path(STATE_PATH_VALUE) if STATE_PATH_VALUE else None
STATS_DIR_VALUE = os.environ.get("BUPA_STATS_DIR", "").strip()
STATS_DIR = Path(STATS_DIR_VALUE) if STATS_DIR_VALUE else BASE_DIR / "data" / "stats"


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


def current_local_time() -> datetime:
    """Return timezone-aware local time using the Pi's configured timezone."""
    return datetime.now().astimezone()


def new_daily_stats(date_key: str) -> dict[str, Any]:
    return {
        "date": date_key,
        "pressure_mat_triggers": {
            "total": 0,
            "by_station": {station_id: 0 for station_id in station_ids},
        },
        "video_plays": {video_key: 0 for video_key in video_stat_keys},
        "sequences_completed": {
            "total": 0,
            "by_station": {station_id: 0 for station_id in station_ids},
        },
        "updated_at": None,
    }


def load_daily_stats(date_key: str) -> dict[str, Any]:
    stats_path = STATS_DIR / f"{date_key}.json"
    if not stats_path.exists():
        return new_daily_stats(date_key)

    try:
        stats = json.loads(stats_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Statistics file is not valid JSON: {stats_path}") from error

    if stats.get("date") != date_key:
        raise RuntimeError(f"Statistics file contains the wrong date: {stats_path}")

    pressure_stats = stats.setdefault("pressure_mat_triggers", {})
    pressure_stats.setdefault("total", 0)
    pressure_by_station = pressure_stats.setdefault("by_station", {})

    completion_stats = stats.setdefault("sequences_completed", {})
    completion_stats.setdefault("total", 0)
    completion_by_station = completion_stats.setdefault("by_station", {})

    for station_id in station_ids:
        pressure_by_station.setdefault(station_id, 0)
        completion_by_station.setdefault(station_id, 0)

    video_plays = stats.setdefault("video_plays", {})
    for video_key in video_stat_keys:
        video_plays.setdefault(video_key, 0)

    stats.setdefault("updated_at", None)
    return stats


def save_daily_stats(stats: dict[str, Any]) -> None:
    STATS_DIR.mkdir(parents=True, exist_ok=True)
    stats_path = STATS_DIR / f"{stats['date']}.json"
    temporary_path = stats_path.with_name(f".{stats_path.name}.tmp")
    temporary_path.write_text(
        f"{json.dumps(stats, indent=2, sort_keys=True)}\n",
        encoding="utf-8",
    )
    temporary_path.replace(stats_path)


def record_stat_event(event_type: str, station: str, video_id: str | None = None) -> None:
    now = current_local_time()
    date_key = now.date().isoformat()

    with stats_lock:
        stats = load_daily_stats(date_key)

        if event_type == "pressure_trigger":
            stats["pressure_mat_triggers"]["total"] += 1
            stats["pressure_mat_triggers"]["by_station"][station] += 1
        elif event_type == "video_play" and video_id is not None:
            stats_key = video_stat_key(station, video_id)
            stats["video_plays"][stats_key] += 1
        elif event_type == "sequence_complete":
            stats["sequences_completed"]["total"] += 1
            stats["sequences_completed"]["by_station"][station] += 1

        stats["updated_at"] = now.isoformat(timespec="seconds")
        save_daily_stats(stats)


app = Flask(__name__)
logging.getLogger("werkzeug").setLevel(logging.ERROR)
content_config = load_content()
pressure_input = create_pressure_input()
runtime_lock = Lock()
stats_lock = Lock()
selected_station = load_selected_station(content_config["stations"])
station_ids = tuple(content_config["stations"])


def video_stat_key(station: str, video_id: str) -> str:
    if video_id == "idle":
        return "idle"
    if video_id == "welcome":
        return f"{station}.welcome"
    return f"{station}.{video_id}"


valid_video_ids_by_station = {
    station_id: {
        "idle",
        "welcome",
        *(video["id"] for video in station["videos"]),
    }
    for station_id, station in content_config["stations"].items()
}
video_stat_keys = tuple(
    ["idle"]
    + [f"{station_id}.welcome" for station_id in station_ids]
    + [
        f"{station_id}.{video['id']}"
        for station_id, station in content_config["stations"].items()
        for video in station["videos"]
    ]
)


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


@app.post("/api/stats/event")
def log_stat_event():
    data = request.get_json(silent=True) or {}
    event_type = data.get("type")
    station = data.get("station")
    video_id = data.get("video_id")

    if event_type not in {"pressure_trigger", "video_play", "sequence_complete"}:
        return jsonify({"error": "Unknown statistics event type"}), 400
    if station not in content_config["stations"]:
        return jsonify({"error": "Station must be maya, mo or mary"}), 400
    if event_type == "video_play" and video_id not in valid_video_ids_by_station[station]:
        return jsonify({"error": "Unknown video for this station"}), 400

    try:
        record_stat_event(event_type, station, video_id)
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        app.logger.error("Could not record statistics event: %s", error)
        return jsonify({"error": "The statistics event could not be saved"}), 500

    return jsonify({"recorded": True})


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
