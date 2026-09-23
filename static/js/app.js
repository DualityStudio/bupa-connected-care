(() => {
  "use strict";

  const content = JSON.parse(document.getElementById("content-config").textContent);
  const ACTIVE_SESSION_STATES = new Set(["welcome", "ready", "playing", "complete"]);
  const RESET_DELAY_MS = 5000;
  const STATUS_POLL_INTERVAL_MS = 500;
  const SECRET_TAP_COUNT = 10;
  const SECRET_TAP_WINDOW_MS = 4000;

  const elements = {
    app: document.getElementById("app"),
    connectionBanner: document.getElementById("connection-banner"),
    setupScreen: document.getElementById("setup-screen"),
    setupTitle: document.getElementById("setup-title"),
    setupCopy: document.getElementById("setup-copy"),
    matIndicator: document.getElementById("mat-indicator"),
    matIndicatorText: document.getElementById("mat-indicator-text"),
    matTestLink: document.getElementById("mat-test-link"),
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
    completionOverlay: document.getElementById("completion-overlay"),
    completeStation: document.getElementById("complete-station"),
    finalText: document.getElementById("final-text"),
    countdown: document.getElementById("countdown"),
    countdownNumber: document.getElementById("countdown-number"),
    secretMenu: document.getElementById("secret-menu"),
    secretMenuClose: document.getElementById("secret-menu-close"),
    secretReset: document.getElementById("secret-reset"),
    secretChoosePersona: document.getElementById("secret-choose-persona"),
    secretPersonaPicker: document.getElementById("secret-persona-picker"),
    secretPersonaButtons: [...document.querySelectorAll("[data-secret-station]")],
    secretMenuError: document.getElementById("secret-menu-error"),
  };

  let state = "booting";
  let selectedStationId = null;
  let pressureIsPressed = null;
  let watchedVideoIds = new Set();
  let activeVideoId = null;
  let sequenceCompleted = false;
  let resumeState = "ready";
  let pollInFlight = false;
  let playbackGeneration = 0;
  let placeholderTimer = null;
  let countdownInterval = null;
  let countdownDeadline = null;
  let secretTapTimes = [];

  function selectedStation() {
    return selectedStationId ? content.stations[selectedStationId] : null;
  }

  function setAccent(colour) {
    elements.app.style.setProperty("--station-accent", colour || "#8ce2d0");
  }

  function setConnected(connected) {
    elements.connectionBanner.hidden = connected;
  }

  function recordStatEvent(type, details = {}) {
    if (!selectedStationId) {
      return;
    }

    fetch("/api/stats/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        station: selectedStationId,
        ...details,
      }),
      keepalive: true,
    }).catch((error) => {
      console.warn("Could not save statistics event", error);
    });
  }

  function showOnly(screen) {
    elements.setupScreen.hidden = screen !== "setup";
    elements.experienceScreen.hidden = screen !== "experience";
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
    sequenceCompleted = false;
    resumeState = "ready";
    showOnly("setup");
    setAccent("#8ce2d0");
    elements.setupTitle.textContent = "Test the Pressure Mat";
    elements.setupCopy.textContent = "Stand on the mat to confirm it is connected and responding.";
    setMatIndicator(false, "Waiting for pressure");
    elements.matTestLink.hidden = false;
    elements.stationPicker.hidden = true;
  }

  function showStationSetup() {
    state = "setup-station";
    showOnly("setup");
    elements.setupTitle.textContent = "Pressure Mat Connected";
    elements.setupCopy.textContent = "The mat responded correctly. Now choose which story this screen will show.";
    setMatIndicator(true, "Pressure detected — test complete");
    elements.matTestLink.hidden = false;
    elements.stationPicker.hidden = false;
  }

  function showWaitForRelease() {
    cancelResetCountdown();
    state = "wait-release";
    watchedVideoIds.clear();
    activeVideoId = null;
    sequenceCompleted = false;
    resumeState = "ready";
    playIdle();
    showExperience();
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

  function showExperience() {
    showOnly("experience");
    setStationDisplay();
    renderVideoChoices();
  }

  function hideCompletion() {
    elements.completionOverlay.hidden = true;
  }

  function playIdle() {
    activeVideoId = null;
    playMedia(content.idleVideo, { loop: true, analyticsId: "idle" });
  }

  function startFreshIdle({ restartVideo = true } = {}) {
    cancelResetCountdown();
    watchedVideoIds.clear();
    activeVideoId = null;
    sequenceCompleted = false;
    resumeState = "ready";
    state = "idle";
    hideCompletion();
    if (restartVideo) {
      playIdle();
    }
    showExperience();
  }

  function startWelcome({ recordTrigger = true } = {}) {
    const station = selectedStation();
    if (!station) {
      showMatSetup();
      return;
    }

    if (recordTrigger) {
      recordStatEvent("pressure_trigger");
    }
    state = "welcome";
    activeVideoId = null;
    hideCompletion();
    showExperience();
    playMedia(station.welcomeVideo, {
      analyticsId: "welcome",
      onEnded: finishWelcome,
    });
  }

  function finishWelcome() {
    state = "ready";
    activeVideoId = null;
    playIdle();
    showExperience();
  }

  function canChooseVideo() {
    return Boolean(
      pressureIsPressed
      && ["welcome", "ready", "playing", "complete"].includes(state),
    );
  }

  function renderVideoChoices() {
    const station = selectedStation();
    if (!station) {
      return;
    }

    elements.videoChoices.replaceChildren();
    const enabled = canChooseVideo();
    elements.choicePanel.classList.toggle("is-lit", enabled);

    station.videos.forEach((video) => {
      const watched = watchedVideoIds.has(video.id);
      const playing = activeVideoId === video.id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = [
        "video-choice",
        watched ? "is-watched" : "",
        playing ? "is-playing" : "",
      ].filter(Boolean).join(" ");
      button.dataset.videoId = video.id;
      button.disabled = !enabled || playing;

      if (playing || watched) {
        const marker = document.createElement("span");
        marker.className = "video-choice__check";
        marker.textContent = playing ? "Playing" : "✓ Watched · replay";
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
    if (!canChooseVideo() || activeVideoId === video.id) {
      return;
    }

    state = "playing";
    activeVideoId = video.id;
    hideCompletion();
    showExperience();
    playMedia(video, {
      analyticsId: video.id,
      onEnded: () => finishSelectedVideo(video.id),
    });
  }

  function finishSelectedVideo(videoId) {
    watchedVideoIds.add(videoId);
    activeVideoId = null;

    const station = selectedStation();
    if (station && watchedVideoIds.size >= station.videos.length) {
      if (!sequenceCompleted) {
        sequenceCompleted = true;
        recordStatEvent("sequence_complete");
      }
      showCompletion();
      return;
    }

    state = "ready";
    playIdle();
    showExperience();
  }

  function showCompletion() {
    state = "complete";
    playIdle();
    showExperience();
    elements.completionOverlay.hidden = false;
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
    hideCompletion();
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

    if (options.analyticsId) {
      recordStatEvent("video_play", { video_id: options.analyticsId });
    }

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
    if (countdownInterval !== null) {
      return;
    }

    countdownDeadline = Date.now() + RESET_DELAY_MS;
    elements.countdown.hidden = false;

    const updateCountdown = () => {
      const remaining = Math.max(0, countdownDeadline - Date.now());
      elements.countdownNumber.textContent = String(Math.max(1, Math.ceil(remaining / 1000)));
      if (remaining <= 0) {
        expireVisitorSession();
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
    sequenceCompleted = false;
    resumeState = "ready";

    if (!selectedStationId) {
      showMatSetup();
    } else if (pressureIsPressed) {
      showWaitForRelease();
    } else {
      startFreshIdle();
    }
  }

  function openSecretMenu() {
    secretTapTimes = [];
    elements.secretPersonaPicker.hidden = true;
    elements.secretMenuError.textContent = "";
    elements.secretMenuError.hidden = true;
    elements.secretMenu.hidden = false;
    elements.secretMenuClose.focus();
  }

  function closeSecretMenu() {
    elements.secretMenu.hidden = true;
    elements.secretPersonaPicker.hidden = true;
    elements.secretMenuError.textContent = "";
    elements.secretMenuError.hidden = true;
    secretTapTimes = [];
  }

  function registerSecretTap(event) {
    if (!elements.secretMenu.hidden || event.target.closest("button, a")) {
      return;
    }

    const now = Date.now();
    secretTapTimes = secretTapTimes.filter((tapTime) => now - tapTime <= SECRET_TAP_WINDOW_MS);
    secretTapTimes.push(now);

    if (secretTapTimes.length >= SECRET_TAP_COUNT) {
      openSecretMenu();
    }
  }

  function expireVisitorSession() {
    cancelResetCountdown();
    watchedVideoIds.clear();
    activeVideoId = null;
    sequenceCompleted = false;
    resumeState = "ready";
    state = "idle";
    hideCompletion();
    showExperience();
  }

  function beginStepAway(previousState) {
    resumeState = previousState === "welcome"
      ? "welcome"
      : (sequenceCompleted ? "complete" : "ready");
    state = "away";
    activeVideoId = null;
    hideCompletion();

    if (["welcome", "playing"].includes(previousState)) {
      playIdle();
    }

    showExperience();
    startResetCountdown();
  }

  function resumeVisitorSession() {
    cancelResetCountdown();
    if (resumeState === "welcome") {
      startWelcome({ recordTrigger: false });
      return;
    }

    state = sequenceCompleted ? "complete" : "ready";
    showExperience();
    if (sequenceCompleted) {
      elements.completionOverlay.hidden = false;
    }
  }

  function processPressure(previousPressure, currentPressure) {
    if (state === "setup-mat" && currentPressure) {
      showStationSetup();
      return;
    }

    if (state === "wait-release" && !currentPressure) {
      state = "idle";
      showExperience();
      return;
    }

    if (ACTIVE_SESSION_STATES.has(state) && previousPressure && !currentPressure) {
      beginStepAway(state);
      return;
    }

    if (state === "away" && currentPressure && previousPressure === false) {
      resumeVisitorSession();
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
      startWelcome({ recordTrigger: false });
    } else {
      startFreshIdle();
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
        sequenceCompleted = false;
        resumeState = "ready";

        if (!selectedStationId) {
          showMatSetup();
        } else if (pressureIsPressed) {
          setStationDisplay();
          startWelcome({ recordTrigger: false });
        } else {
          setStationDisplay();
          startFreshIdle();
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

  async function selectStation(
    stationId,
    { recordTrigger = true, closeMenuOnSuccess = false } = {},
  ) {
    const stationSelectionButtons = [
      ...elements.stationButtons,
      ...elements.secretPersonaButtons,
    ];

    stationSelectionButtons.forEach((button) => {
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
      stopMedia();
      cancelResetCountdown();
      selectedStationId = result.selected_station;
      watchedVideoIds.clear();
      activeVideoId = null;
      sequenceCompleted = false;
      resumeState = "ready";
      setStationDisplay();
      if (pressureIsPressed) {
        startWelcome({ recordTrigger });
      } else {
        startFreshIdle();
      }
      if (closeMenuOnSuccess) {
        closeSecretMenu();
      }
    } catch (_error) {
      elements.setupCopy.textContent = "The station could not be saved. Check the server connection and try again.";
      elements.secretMenuError.textContent = "The persona could not be saved. Check the server connection and try again.";
      elements.secretMenuError.hidden = false;
      setConnected(false);
    } finally {
      stationSelectionButtons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  elements.stationButtons.forEach((button) => {
    button.addEventListener("click", () => selectStation(button.dataset.station));
  });
  elements.secretPersonaButtons.forEach((button) => {
    button.addEventListener("click", () => selectStation(
      button.dataset.secretStation,
      { recordTrigger: false, closeMenuOnSuccess: true },
    ));
  });
  elements.mediaFrame.addEventListener("pointerup", registerSecretTap);
  elements.secretMenuClose.addEventListener("click", closeSecretMenu);
  elements.secretReset.addEventListener("click", () => {
    closeSecretMenu();
    resetVisitorSession();
  });
  elements.secretChoosePersona.addEventListener("click", () => {
    elements.secretPersonaPicker.hidden = !elements.secretPersonaPicker.hidden;
    elements.secretMenuError.hidden = true;
  });
  elements.autoplayPrompt.addEventListener("click", retryPlaybackAfterTap);

  pollStatus();
  window.setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
})();
