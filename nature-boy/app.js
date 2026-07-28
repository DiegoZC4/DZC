(() => {
  "use strict";

  const SCORE_URL = "./assets/nature-boy.musicxml";
  const PREFS_KEY = "nature-boy-player:v1";
  const PART_COLORS = ["#9d3d2b", "#c7752e", "#a48320", "#2f7770", "#3f557d"];
  const PART_NAMES = ["Soprano 1", "Soprano 2", "Alto", "Tenor", "Bass"];

  const scoreElement = document.getElementById("score");
  const scoreScroll = document.getElementById("scoreScroll");
  const scoreLoading = document.getElementById("scoreLoading");
  const playerShell = document.getElementById("player");
  const playerStatus = document.getElementById("playerStatus");
  const playerStatusText = document.getElementById("playerStatusText");
  const playPause = document.getElementById("playPause");
  const playPauseLabel = document.getElementById("playPauseLabel");
  const stopPlayback = document.getElementById("stopPlayback");
  const loopPlayback = document.getElementById("loopPlayback");
  const currentTime = document.getElementById("currentTime");
  const totalTime = document.getElementById("totalTime");
  const seek = document.getElementById("seek");
  const tempo = document.getElementById("tempo");
  const tempoValue = document.getElementById("tempoValue");
  const scoreSize = document.getElementById("scoreSize");
  const scoreSizeValue = document.getElementById("scoreSizeValue");
  const fitScore = document.getElementById("fitScore");
  const fullscreenScore = document.getElementById("fullscreenScore");
  const reflowStatus = document.getElementById("reflowStatus");
  const mixer = document.getElementById("mixer");
  const resetMix = document.getElementById("resetMix");

  let api = null;
  let isReady = false;
  let isSeeking = false;
  let endTime = 0;
  let mixerBuilt = false;
  let scoreTracks = [];
  let renderTimer = 0;
  const mutedTracks = new Set();
  const soloedTracks = new Set();

  function readPreferences() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return {
        tempo: clamp(Number(parsed.tempo) || 100, 50, 150),
        scoreSize: clamp(Number(parsed.scoreSize) || defaultScoreSize(), 65, 155),
      };
    } catch {
      return { tempo: 100, scoreSize: defaultScoreSize() };
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          tempo: Number(tempo.value),
          scoreSize: Number(scoreSize.value),
        }),
      );
    } catch {
      // Device-local preferences are optional.
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function defaultScoreSize() {
    if (window.innerWidth < 520) return 75;
    if (window.innerWidth < 820) return 85;
    return 100;
  }

  function formatTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function setStatus(message, state = "loading") {
    playerStatus.dataset.state = state;
    playerStatusText.textContent = message;
  }

  function failGracefully(message) {
    setStatus(message, "error");
    scoreLoading.querySelector("p").textContent = message;
    playPause.disabled = true;
    stopPlayback.disabled = true;
    loopPlayback.disabled = true;
    seek.disabled = true;
  }

  function scheduleScoreRender() {
    if (!api) return;
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      api.settings.display.scale = Number(scoreSize.value) / 100;
      api.updateSettings();
      api.render();
    }, 90);
  }

  function updateScoreSize(value, persist = true) {
    scoreSize.value = String(value);
    scoreSizeValue.value = `${value}%`;
    scoreSizeValue.textContent = `${value}%`;
    if (persist) savePreferences();
    scheduleScoreRender();
  }

  function updateTempo(value) {
    const next = clamp(Number(value), 50, 150);
    tempo.value = String(next);
    tempoValue.value = `${next}%`;
    tempoValue.textContent = `${next}%`;
    if (api) api.playbackSpeed = next / 100;
    savePreferences();
  }

  function updateLoop(next) {
    loopPlayback.setAttribute("aria-pressed", String(next));
    if (api) api.isLooping = next;
  }

  function updateMixerAppearance() {
    const hasSolo = soloedTracks.size > 0;
    mixer.querySelectorAll(".part-row").forEach((row) => {
      const index = Number(row.dataset.trackIndex);
      row.classList.toggle("is-soloed", soloedTracks.has(index));
      row.classList.toggle(
        "is-suppressed",
        mutedTracks.has(index) || (hasSolo && !soloedTracks.has(index)),
      );
    });
  }

  function setMute(index, next) {
    const track = scoreTracks[index];
    if (!track || !api) return;

    if (next && soloedTracks.has(index)) {
      soloedTracks.delete(index);
      api.changeTrackSolo([track], false);
      const soloButton = mixer.querySelector(`[data-solo-index="${index}"]`);
      soloButton?.setAttribute("aria-pressed", "false");
    }

    if (next) mutedTracks.add(index);
    else mutedTracks.delete(index);
    api.changeTrackMute([track], next);

    const muteButton = mixer.querySelector(`[data-mute-index="${index}"]`);
    muteButton?.setAttribute("aria-pressed", String(next));
    updateMixerAppearance();
  }

  function setSolo(index, next) {
    const track = scoreTracks[index];
    if (!track || !api) return;

    if (next && mutedTracks.has(index)) {
      mutedTracks.delete(index);
      api.changeTrackMute([track], false);
      const muteButton = mixer.querySelector(`[data-mute-index="${index}"]`);
      muteButton?.setAttribute("aria-pressed", "false");
    }

    if (next) soloedTracks.add(index);
    else soloedTracks.delete(index);
    api.changeTrackSolo([track], next);

    const soloButton = mixer.querySelector(`[data-solo-index="${index}"]`);
    soloButton?.setAttribute("aria-pressed", String(next));
    updateMixerAppearance();
  }

  function resetMixer() {
    scoreTracks.forEach((track, index) => {
      if (mutedTracks.has(index)) api.changeTrackMute([track], false);
      if (soloedTracks.has(index)) api.changeTrackSolo([track], false);
    });
    mutedTracks.clear();
    soloedTracks.clear();
    mixer.querySelectorAll(".mix-button").forEach((button) => {
      button.setAttribute("aria-pressed", "false");
    });
    updateMixerAppearance();
  }

  function buildMixer(tracks) {
    if (mixerBuilt) return;
    mixerBuilt = true;
    scoreTracks = Array.from(tracks);
    mixer.replaceChildren();
    mixer.setAttribute("aria-busy", "false");

    scoreTracks.forEach((track, index) => {
      const row = document.createElement("div");
      row.className = "part-row";
      row.dataset.trackIndex = String(index);
      row.style.setProperty("--part-color", PART_COLORS[index % PART_COLORS.length]);

      const name = document.createElement("div");
      name.className = "part-name";
      const swatch = document.createElement("span");
      swatch.className = "part-swatch";
      swatch.setAttribute("aria-hidden", "true");
      const nameText = document.createElement("span");
      nameText.textContent =
        PART_NAMES[index] || track.name || track.shortName || `Part ${index + 1}`;
      name.append(swatch, nameText);

      const muteButton = document.createElement("button");
      muteButton.className = "mix-button";
      muteButton.type = "button";
      muteButton.textContent = "M";
      muteButton.dataset.muteIndex = String(index);
      muteButton.setAttribute("aria-pressed", "false");
      muteButton.setAttribute("aria-label", `Mute ${nameText.textContent}`);
      muteButton.title = `Mute ${nameText.textContent}`;
      muteButton.addEventListener("click", () => {
        setMute(index, muteButton.getAttribute("aria-pressed") !== "true");
      });

      const soloButton = document.createElement("button");
      soloButton.className = "mix-button";
      soloButton.type = "button";
      soloButton.textContent = "S";
      soloButton.dataset.soloIndex = String(index);
      soloButton.setAttribute("aria-pressed", "false");
      soloButton.setAttribute("aria-label", `Solo ${nameText.textContent}`);
      soloButton.title = `Solo ${nameText.textContent}`;
      soloButton.addEventListener("click", () => {
        setSolo(index, soloButton.getAttribute("aria-pressed") !== "true");
      });

      row.append(name, muteButton, soloButton);
      mixer.append(row);
    });

    resetMix.disabled = false;
  }

  function updateReflowLabel() {
    const width = Math.max(0, Math.round(scoreScroll.clientWidth));
    reflowStatus.textContent = `Automatic wrapping · ${width}px score width`;
  }

  const preferences = readPreferences();
  tempo.value = String(preferences.tempo);
  scoreSize.value = String(preferences.scoreSize);
  tempoValue.value = `${preferences.tempo}%`;
  tempoValue.textContent = `${preferences.tempo}%`;
  scoreSizeValue.value = `${preferences.scoreSize}%`;
  scoreSizeValue.textContent = `${preferences.scoreSize}%`;

  if (!window.alphaTab) {
    failGracefully("The score player could not start. Please reload the page.");
    return;
  }

  try {
    api = new window.alphaTab.AlphaTabApi(scoreElement, {
      file: SCORE_URL,
      core: {
        fontDirectory: "./vendor/alphatab/font/",
        tracks: "all",
        enableLazyLoading: true,
      },
      display: {
        layoutMode: window.alphaTab.LayoutMode.Page,
        scale: preferences.scoreSize / 100,
        barsPerRow: -1,
        stretchForce: 0.85,
      },
      importer: {
        mergePartGroupsInMusicXml: false,
      },
      player: {
        enablePlayer: true,
        soundFont: "./vendor/alphatab/soundfont/sonivox.sf2",
        scrollElement: scoreScroll,
        enableCursor: true,
        enableElementHighlighting: true,
        enableAnimatedBeatCursor: true,
      },
    });
  } catch (error) {
    console.error(error);
    failGracefully("The score player could not be initialized.");
    return;
  }

  api.scoreLoaded.on((score) => {
    buildMixer(score.tracks);
    updateTempo(preferences.tempo);
    setStatus("Preparing instrument sounds…");
  });

  api.renderFinished.on(() => {
    scoreLoading.classList.add("is-hidden");
    updateReflowLabel();
  });

  api.soundFontLoad.on((event) => {
    if (!event.total) return;
    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
    setStatus(`Loading instrument sounds · ${percent}%`);
  });

  api.playerReady.on(() => {
    isReady = true;
    playPause.disabled = false;
    stopPlayback.disabled = false;
    loopPlayback.disabled = false;
    seek.disabled = false;
    setStatus("Ready to rehearse", "ready");
  });

  api.playerStateChanged.on((event) => {
    const playing = event.state === window.alphaTab.synth.PlayerState.Playing;
    playPause.classList.toggle("is-playing", playing);
    playPauseLabel.textContent = playing ? "Pause" : "Play";
    playPause.setAttribute("aria-label", playing ? "Pause playback" : "Play score");
  });

  api.playerPositionChanged.on((event) => {
    endTime = event.endTime || endTime;
    if (!isSeeking) seek.value = String(Math.round(event.currentTime));
    seek.max = String(Math.max(1, Math.round(endTime)));
    currentTime.textContent = formatTime(event.currentTime);
    totalTime.textContent = formatTime(endTime);
    seek.setAttribute(
      "aria-valuetext",
      `${formatTime(event.currentTime)} of ${formatTime(endTime)}`,
    );
  });

  api.playerFinished.on(() => {
    if (!api.isLooping) {
      playPause.classList.remove("is-playing");
      playPauseLabel.textContent = "Play";
    }
  });

  api.error.on((error) => {
    console.error(error);
    failGracefully("The score could not be loaded. Please try reloading.");
  });

  playPause.addEventListener("click", () => {
    if (isReady) api.playPause();
  });

  stopPlayback.addEventListener("click", () => {
    if (isReady) api.stop();
  });

  loopPlayback.addEventListener("click", () => {
    updateLoop(loopPlayback.getAttribute("aria-pressed") !== "true");
  });

  tempo.addEventListener("input", () => updateTempo(tempo.value));
  scoreSize.addEventListener("input", () => updateScoreSize(Number(scoreSize.value)));
  fitScore.addEventListener("click", () => updateScoreSize(defaultScoreSize()));
  resetMix.addEventListener("click", resetMixer);

  seek.addEventListener("pointerdown", () => {
    isSeeking = true;
  });
  seek.addEventListener("input", () => {
    if (isSeeking) currentTime.textContent = formatTime(Number(seek.value));
  });
  const finishSeek = () => {
    if (!api || !isReady) return;
    api.timePosition = Number(seek.value);
    isSeeking = false;
  };
  seek.addEventListener("change", finishSeek);
  seek.addEventListener("pointerup", finishSeek);

  fullscreenScore.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await playerShell.requestFullscreen();
    } catch {
      setStatus("Full screen is unavailable in this browser", "error");
    }
  });

  document.addEventListener("fullscreenchange", () => {
    const active = document.fullscreenElement === playerShell;
    fullscreenScore.textContent = active ? "Exit full screen" : "Full screen";
    window.setTimeout(updateReflowLabel, 100);
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;
    if (isTyping || !isReady) return;

    if (event.code === "Space") {
      event.preventDefault();
      api.playPause();
    } else if (event.key.toLowerCase() === "r") {
      api.stop();
    } else if (event.key.toLowerCase() === "l") {
      updateLoop(!api.isLooping);
    }
  });

  const resizeObserver = new ResizeObserver(updateReflowLabel);
  resizeObserver.observe(scoreScroll);
  updateReflowLabel();
})();
