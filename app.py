#!/usr/bin/env python3
"""Local Flask server for the Raspberry Pi pressure-mat video kiosk."""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
from datetime import datetime
from pathlib import Path
from threading import Lock, Timer
from typing import Any

from flask import Flask, jsonify, render_template, request


BASE_DIR = Path(__file__).resolve().parent
CONTENT_PATH = BASE_DIR / "content.json"
GPIO_PIN = 17
UPDATE_REMOTE = "origin"
UPDATE_BRANCH = "main"
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
        for media_key in ("idleVideo", "welcomeVideo"):
            if not isinstance(station.get(media_key), dict):
                raise ValueError(f"Station {station_id} must define {media_key}")

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
controller_pressure_input = (
    pressure_input if isinstance(pressure_input, MockPressureInput) else MockPressureInput()
)
runtime_lock = Lock()
stats_lock = Lock()
update_lock = Lock()
selected_station = load_selected_station(content_config["stations"])
station_ids = tuple(content_config["stations"])


def video_stat_key(station: str, video_id: str) -> str:
    if video_id == "idle":
        return f"{station}.idle"
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
    [f"{station_id}.idle" for station_id in station_ids]
    + [f"{station_id}.welcome" for station_id in station_ids]
    + [
        f"{station_id}.{video['id']}"
        for station_id, station in content_config["stations"].items()
        for video in station["videos"]
    ]
)
video_stat_labels = {}
for station_id, station in content_config["stations"].items():
    video_stat_labels[f"{station_id}.idle"] = station["idleVideo"]["label"]
    video_stat_labels[f"{station_id}.welcome"] = station["welcomeVideo"]["label"]
    for video in station["videos"]:
        video_stat_labels[f"{station_id}.{video['id']}"] = video["label"]


def safe_count(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def format_uk_date(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return value


def format_uk_timestamp(value: Any) -> str | None:
    if not value:
        return None

    timestamp = str(value)
    try:
        return datetime.fromisoformat(timestamp).strftime("%d/%m/%Y, %H:%M")
    except ValueError:
        return timestamp


def load_stats_history() -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    errors: list[str] = []

    if not STATS_DIR.exists():
        return records, errors

    for stats_path in sorted(STATS_DIR.glob("*.json"), reverse=True):
        try:
            raw_stats = json.loads(stats_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            errors.append(stats_path.name)
            continue

        if not isinstance(raw_stats, dict):
            errors.append(stats_path.name)
            continue

        pressure_stats = raw_stats.get("pressure_mat_triggers", {})
        pressure_stats = pressure_stats if isinstance(pressure_stats, dict) else {}
        pressure_by_station = pressure_stats.get("by_station", {})
        pressure_by_station = pressure_by_station if isinstance(pressure_by_station, dict) else {}

        completion_stats = raw_stats.get("sequences_completed", {})
        completion_stats = completion_stats if isinstance(completion_stats, dict) else {}
        completion_by_station = completion_stats.get("by_station", {})
        completion_by_station = completion_by_station if isinstance(completion_by_station, dict) else {}

        raw_video_plays = raw_stats.get("video_plays", {})
        raw_video_plays = raw_video_plays if isinstance(raw_video_plays, dict) else {}
        video_keys = list(video_stat_keys)
        video_keys.extend(sorted(set(raw_video_plays) - set(video_keys)))

        date_value = raw_stats.get("date")
        date_value = date_value if isinstance(date_value, str) else stats_path.stem

        records.append(
            {
                "date": date_value,
                "date_display": format_uk_date(date_value),
                "updated_at": format_uk_timestamp(raw_stats.get("updated_at")),
                "pressure_total": safe_count(pressure_stats.get("total")),
                "completion_total": safe_count(completion_stats.get("total")),
                "stations": [
                    {
                        "name": station["name"],
                        "pressure": safe_count(pressure_by_station.get(station_id)),
                        "completions": safe_count(completion_by_station.get(station_id)),
                    }
                    for station_id, station in content_config["stations"].items()
                ],
                "videos": [
                    {
                        "name": video_stat_labels.get(video_key, video_key),
                        "key": video_key,
                        "plays": safe_count(raw_video_plays.get(video_key)),
                    }
                    for video_key in video_keys
                ],
            }
        )

    return records, errors


def pressure_is_pressed() -> bool:
    if controller_pressure_input.is_pressed:
        return True
    return pressure_input.is_pressed


def git_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment["GIT_TERMINAL_PROMPT"] = "0"
    environment.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
    return environment


def run_git(arguments: list[str], timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *arguments],
        cwd=BASE_DIR,
        env=git_environment(),
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )


def update_remote_is_available() -> bool:
    if not (BASE_DIR / ".git").exists():
        return False

    try:
        result = run_git(
            ["ls-remote", "--exit-code", UPDATE_REMOTE, f"refs/heads/{UPDATE_BRANCH}"],
            15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def restart_after_update() -> None:
    os.kill(os.getpid(), signal.SIGTERM)


@app.get("/")
def index():
    return render_template("index.html", content=content_config)


@app.get("/mat-controller")
def mat_controller():
    return render_template("mock.html")


@app.get("/mat-test")
def mat_test():
    return render_template("mat-test.html")


@app.get("/stats")
def stats_dashboard():
    records, errors = load_stats_history()
    requested_date = request.args.get("date", "")
    selected_record = next(
        (record for record in records if record["date"] == requested_date),
        records[0] if records else None,
    )
    response = render_template(
        "stats.html",
        records=records,
        selected_record=selected_record,
        errors=errors,
    )
    return response, 200, {"Cache-Control": "no-store"}


@app.get("/health")
def health():
    return jsonify({"ok": True, "mode": pressure_input.mode})


@app.get("/api/update-status")
def update_status():
    available = update_remote_is_available()
    response = jsonify({"available": available})
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/update")
def update_application():
    if not update_lock.acquire(blocking=False):
        return jsonify({"error": "An update is already running"}), 409

    try:
        if not update_remote_is_available():
            return jsonify({"error": "The update server is not reachable"}), 503

        try:
            before = run_git(["rev-parse", "HEAD"], 10)
            pull = run_git(
                ["pull", "--ff-only", UPDATE_REMOTE, UPDATE_BRANCH],
                300,
            )
            after = run_git(["rev-parse", "HEAD"], 10)
        except (OSError, subprocess.TimeoutExpired) as error:
            app.logger.error("Manual update could not run: %s", error)
            return jsonify({"error": "The update could not be completed"}), 500

        if before.returncode != 0 or pull.returncode != 0 or after.returncode != 0:
            app.logger.error("Manual update failed: %s", pull.stderr.strip())
            return jsonify({"error": "The update could not be applied safely"}), 500

        updated = before.stdout.strip() != after.stdout.strip()
        restart_scheduled = updated and bool(os.environ.get("INVOCATION_ID"))
        if restart_scheduled:
            restart_timer = Timer(1.0, restart_after_update)
            restart_timer.daemon = True
            restart_timer.start()

        return jsonify(
            {
                "updated": updated,
                "restart_scheduled": restart_scheduled,
            }
        )
    finally:
        update_lock.release()


@app.get("/api/status")
def pressure_status():
    try:
        pressed = pressure_is_pressed()
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
            "controller_pressed": controller_pressure_input.is_pressed,
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


@app.post("/api/controller-pressure")
def set_controller_pressure():
    data = request.get_json(silent=True) or {}
    pressed = data.get("pressed")
    if not isinstance(pressed, bool):
        return jsonify({"error": "pressed must be a boolean"}), 400

    controller_pressure_input.set_pressed(pressed)
    return jsonify(
        {
            "pressed": pressure_is_pressed(),
            "controller_pressed": controller_pressure_input.is_pressed,
            "mode": pressure_input.mode,
        }
    )


if __name__ == "__main__":
    host = os.environ.get("BUPA_HOST", "0.0.0.0")
    port = int(os.environ.get("BUPA_PORT", "5000"))
    app.run(host=host, port=port, threaded=True, use_reloader=False)
