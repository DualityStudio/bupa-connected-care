(() => {
  "use strict";

  const content = JSON.parse(document.getElementById("content-config").textContent);
  const ACTIVE_SESSION_STATES = new Set(["welcome", "choosing", "playing", "complete"]);
  const RESET_DELAY_MS = 5000;
  const STATUS_POLL_INTERVAL_MS = 500;

  const elements = {
    app: document.getElementById("app"),
    connectionBanner: document.getElementById("connection-banner"),
    adminReset: document.getElementById("admin-reset"),
    setupScreen: document.getElementById("setup-screen"),
    setupTitle: document.getElementById("setup-title"),
    setupCopy: document.getElementById("setup-copy"),
    matIndicator: document.getElementById("mat-indicator"),
    matIndicatorText: document.getElementById("mat-indicator-text"),
    stationPicker: document.getElementById("station-picker"),
    stationButtons: [...document.querySelectorAll("[data-station]")],
    modeLabel: document.getElementById("mode-label"),
    experienceScreen: document.getElementById("experience-screen"),
    mediaFrame: document.getElementById("media-frame"),
    videoPlayer: document.getElementById("video-player"),
    placeholderPlayer: document.getElementById("placeholder-player"),
    placeholderLabel: document.getElementById("placeholder-label"),
    mediaError: document.getElementById("media-error"),
    autoplayPrompt: document.getElementById("autoplay-prompt"),
    choicePanel: document.getElementById("choice-panel"),
    videoChoices: document.getElementById("video-choices"),
    completeScreen: document.getElementById("complete-screen"),
    completeStation: document.getElementById("complete-station"),
    finalText: document.getElementById("final-text"),
    countdown: document.getElementById("countdown"),
    countdownNumber: document.getElementById("countdown-number"),
  };

  let state = "booting";
  let selectedStationId = null;
  let pressureIsPressed = null;
  let watchedVideoIds = new Set();
  let activeVideoId = null;
  let pollInFlight = false;
  let playbackGeneration = 0;
  let placeholderTimer = null;
  let countdownInterval = null;
  let countdownDeadline = null;

  function selectedStation() {
    return selectedStationId ? content.stations[selectedStationId] : null;
  }

  function setAccent(colour) {
    elements.app.style.setProperty("--station-accent", colour || "#8ce2d0");
  }

  function setConnected(connected) {
    elements.connectionBanner.hidden = connected;
  }

  function showOnly(screen) {
    elements.setupScreen.hidden = screen !== "setup";
    elements.experienceScreen.hidden = screen !== "experience";
    elements.completeScreen.hidden = screen !== "complete";
  }

  function setMatIndicator(complete, label) {
    elements.matIndicator.classList.toggle("is-complete", complete);
    elements.matIndicatorText.textContent = label;
  }

  function showMatSetup() {
    stopMedia();
    cancelResetCountdown();
    state = "setup-mat";
    selectedStationId = null;
    watchedVideoIds.clear();
    activeVideoId = null;
    showOnly("setup");
    setAccent("#8ce2d0");
    elements.adminReset.hidden = true;
    elements.setupTitle.textContent = "Test the pressure mat";
    elements.setupCopy.textContent = "Stand on the mat to confirm it is connected and responding.";
    setMatIndicator(false, "Waiting for pressure");
    elements.stationPicker.hidden = true;
  }

  function showStationSetup() {
    state = "setup-station";
    showOnly("setup");
    elements.adminReset.hidden = true;
    elements.setupTitle.textContent = "Pressure mat connected";
    elements.setupCopy.textContent = "The mat responded correctly. Now choose which story this screen will show.";
    setMatIndicator(true, "Pressure detected — test complete");
    elements.stationPicker.hidden = false;
  }

  function showWaitForRelease() {
    stopMedia();
    cancelResetCountdown();
    state = "wait-release";
    showOnly("setup");
    elements.adminReset.hidden = false;
    elements.setupTitle.textContent = "Setup complete";
    elements.setupCopy.textContent = "Step off the pressure mat to arm the experience for the first visitor.";
    setMatIndicator(true, "Waiting for the mat to be released");
    elements.stationPicker.hidden = true;
  }

  function setStationDisplay() {
    const station = selectedStation();
    if (!station) {
      return;
    }

    setAccent(station.accent);
    elements.completeStation.textContent = station.name;
    elements.finalText.textContent = station.finalText;
  }

  function showExperience(showChoices) {
    showOnly("experience");
    elements.adminReset.hidden = false;
    elements.choicePanel.hidden = !showChoices;
    setStationDisplay();
  }

  function startIdle() {
    cancelResetCountdown();
    watchedVideoIds.clear();
    activeVideoId = null;
    state = "idle";
    showExperience(false);
    playMedia(content.idleVideo, { loop: true });
  }

  function startWelcome() {
    const station = selectedStation();
    if (!station) {
      showMatSetup();
      return;
    }

    state = "welcome";
    showExperience(false);
    playMedia(station.welcomeVideo, {
      onEnded: showVideoChoices,
    });
  }

  function showVideoChoices() {
    state = "choosing";
    activeVideoId = null;
    showExperience(true);
    renderVideoChoices();
  }

  function renderVideoChoices() {
    const station = selectedStation();
    if (!station) {
      return;
    }

    elements.videoChoices.replaceChildren();

    station.videos.forEach((video) => {
      const watched = watchedVideoIds.has(video.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `video-choice${watched ? " is-watched" : ""}`;
      button.dataset.videoId = video.id;

      if (watched) {
        const marker = document.createElement("span");
        marker.className = "video-choice__check";
        marker.textContent = "✓ Watched · replay";
        button.append(marker);
      }

      const label = document.createElement("span");
      label.textContent = video.label;
      button.append(label);
      button.addEventListener("click", () => startSelectedVideo(video));
      elements.videoChoices.append(button);
    });
  }

  function startSelectedVideo(video) {
    state = "playing";
    activeVideoId = video.id;
    showExperience(false);
    playMedia(video, {
      onEnded: () => finishSelectedVideo(video.id),
    });
  }

  function finishSelectedVideo(videoId) {
    watchedVideoIds.add(videoId);
    activeVideoId = null;

    const station = selectedStation();
    if (station && watchedVideoIds.size >= station.videos.length) {
      showCompletion();
      return;
    }

    showVideoChoices();
  }

  function showCompletion() {
    stopMedia();
    state = "complete";
    setStationDisplay();
    showOnly("complete");
    elements.adminReset.hidden = false;
  }

  function animateMediaEntrance() {
    elements.mediaFrame.classList.remove("media-enter");
    void elements.mediaFrame.offsetWidth;
    elements.mediaFrame.classList.add("media-enter");
  }

  function resetVideoElement() {
    const video = elements.videoPlayer;
    video.onended = null;
    video.onerror = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = true;
  }

  function stopMedia() {
    playbackGeneration += 1;
    if (placeholderTimer !== null) {
      window.clearTimeout(placeholderTimer);
      placeholderTimer = null;
    }

    resetVideoElement();
    elements.placeholderPlayer.hidden = true;
    elements.placeholderPlayer.classList.remove("is-timed", "is-looping");
    elements.mediaError.hidden = true;
    elements.autoplayPrompt.hidden = true;
  }

  function startPlaceholder(media, options, generation, errorMessage = "") {
    if (generation !== playbackGeneration) {
      return;
    }

    resetVideoElement();
    if (placeholderTimer !== null) {
      window.clearTimeout(placeholderTimer);
    }

    const durationSeconds = Math.max(1, Number(media.placeholderDuration) || 6);
    const placeholder = elements.placeholderPlayer;
    elements.placeholderLabel.textContent = media.label || "Video placeholder";
    placeholder.style.setProperty("--placeholder-duration", `${durationSeconds}s`);
    placeholder.classList.remove("is-timed", "is-looping");
    placeholder.hidden = false;
    void placeholder.offsetWidth;
    placeholder.classList.add(options.loop ? "is-looping" : "is-timed");

    if (errorMessage) {
      elements.mediaError.textContent = errorMessage;
      elements.mediaError.hidden = false;
    }

    if (!options.loop && typeof options.onEnded === "function") {
      placeholderTimer = window.setTimeout(() => {
        if (generation === playbackGeneration) {
          placeholderTimer = null;
          options.onEnded();
        }
      }, durationSeconds * 1000);
    }
  }

  function playMedia(media, options = {}) {
    stopMedia();
    const generation = playbackGeneration;
    animateMediaEntrance();

    if (!media.src) {
      startPlaceholder(media, options, generation);
      return;
    }

    const video = elements.videoPlayer;
    video.hidden = false;
    video.loop = Boolean(options.loop);
    video.muted = false;
    video.volume = 1;
    video.src = media.src;
    video.currentTime = 0;

    video.onended = () => {
      if (generation === playbackGeneration && typeof options.onEnded === "function") {
        options.onEnded();
      }
    };

    video.onerror = () => {
      startPlaceholder(
        media,
        options,
        generation,
        `Could not load “${media.label}”. Running its testing placeholder instead.`,
      );
    };

    const playback = video.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(() => {
        if (generation === playbackGeneration && !video.error) {
          elements.autoplayPrompt.hidden = false;
        }
      });
    }
  }

  async function retryPlaybackAfterTap() {
    try {
      await elements.videoPlayer.play();
      elements.autoplayPrompt.hidden = true;
    } catch (_error) {
      elements.autoplayPrompt.textContent = "Could not start playback — tap to retry";
    }
  }

  function startResetCountdown() {
    if (countdownInterval !== null || !ACTIVE_SESSION_STATES.has(state)) {
      return;
    }

    countdownDeadline = Date.now() + RESET_DELAY_MS;
    elements.countdown.hidden = false;

    const updateCountdown = () => {
      const remaining = Math.max(0, countdownDeadline - Date.now());
      elements.countdownNumber.textContent = String(Math.max(1, Math.ceil(remaining / 1000)));
      if (remaining <= 0) {
        resetVisitorSession();
      }
    };

    updateCountdown();
    countdownInterval = window.setInterval(updateCountdown, 100);
  }

  function cancelResetCountdown() {
    if (countdownInterval !== null) {
      window.clearInterval(countdownInterval);
      countdownInterval = null;
    }
    countdownDeadline = null;
    elements.countdown.hidden = true;
    elements.countdownNumber.textContent = "5";
  }

  function resetVisitorSession() {
    cancelResetCountdown();
    watchedVideoIds.clear();
    activeVideoId = null;

    if (!selectedStationId) {
      showMatSetup();
    } else if (pressureIsPressed) {
      showWaitForRelease();
    } else {
      startIdle();
    }
  }

  function processPressure(previousPressure, currentPressure) {
    if (state === "setup-mat" && currentPressure) {
      showStationSetup();
      return;
    }

    if (state === "wait-release" && !currentPressure) {
      startIdle();
      return;
    }

    if (ACTIVE_SESSION_STATES.has(state)) {
      if (currentPressure) {
        cancelResetCountdown();
      } else {
        startResetCountdown();
      }
      return;
    }

    if (state === "idle" && currentPressure && previousPressure === false) {
      startWelcome();
    }
  }

  function initialiseFromStatus(status) {
    selectedStationId = status.selected_station;
    pressureIsPressed = Boolean(status.pressed);
    elements.modeLabel.textContent = status.mode === "mock"
      ? "Mock input mode · use /mock to control the mat"
      : "Physical input · BCM GPIO 17";

    if (!selectedStationId) {
      showMatSetup();
      if (pressureIsPressed) {
        showStationSetup();
      }
      return;
    }

    setStationDisplay();
    if (pressureIsPressed) {
      showWaitForRelease();
    } else {
      startIdle();
    }
  }

  async function pollStatus() {
    if (pollInFlight) {
      return;
    }
    pollInFlight = true;

    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }

      const status = await response.json();
      setConnected(true);
      elements.modeLabel.textContent = status.mode === "mock"
        ? "Mock input mode · use /mock to control the mat"
        : "Physical input · BCM GPIO 17";

      if (state === "booting") {
        initialiseFromStatus(status);
        return;
      }

      if (status.selected_station !== selectedStationId) {
        stopMedia();
        cancelResetCountdown();
        selectedStationId = status.selected_station;
        pressureIsPressed = Boolean(status.pressed);
        watchedVideoIds.clear();
        activeVideoId = null;

        if (!selectedStationId) {
          showMatSetup();
        } else if (pressureIsPressed) {
          setStationDisplay();
          showWaitForRelease();
        } else {
          setStationDisplay();
          startIdle();
        }
        return;
      }

      const previousPressure = pressureIsPressed;
      pressureIsPressed = Boolean(status.pressed);
      processPressure(previousPressure, pressureIsPressed);
    } catch (_error) {
      setConnected(false);
    } finally {
      pollInFlight = false;
    }
  }

  async function selectStation(stationId) {
    elements.stationButtons.forEach((button) => {
      button.disabled = true;
    });

    try {
      const response = await fetch("/api/station", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ station: stationId }),
      });
      if (!response.ok) {
        throw new Error(`Station request failed with ${response.status}`);
      }

      const result = await response.json();
      selectedStationId = result.selected_station;
      setStationDisplay();
      if (pressureIsPressed) {
        showWaitForRelease();
      } else {
        startIdle();
      }
    } catch (_error) {
      elements.setupCopy.textContent = "The station could not be saved. Check the server connection and try again.";
      setConnected(false);
    } finally {
      elements.stationButtons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  elements.stationButtons.forEach((button) => {
    button.addEventListener("click", () => selectStation(button.dataset.station));
  });
  elements.adminReset.addEventListener("click", resetVisitorSession);
  elements.autoplayPrompt.addEventListener("click", retryPlaybackAfterTap);

  pollStatus();
  window.setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
})();
