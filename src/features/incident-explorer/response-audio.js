/**
 * Procedural Web Audio synthesizer for Damkarmat response simulation.
 *
 * Rules enforced:
 * - Default muted (`isMuted() === true`)
 * - Never autoplays; AudioContext is initialized/resumed only after user gesture
 * - Graceful no-op fallback if Web Audio API is unavailable
 * - Releases all oscillators, noise buffers, timers, and AudioContext on stop/destroy
 */

export function createResponseAudioController() {
  let muted = true;
  let paused = false;
  let currentPhase = "idle";
  let currentIntensity = 1;
  let ctx = null;
  let masterGain = null;
  let noiseBuffer = null;
  let activeStoppers = [];
  let sirenInterval = null;
  let chimePlayedForCompletion = false;
  let destroyed = false;

  function getAudioCtxCtor() {
    if (typeof window === "undefined") return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }

  function isSupported() {
    return Boolean(getAudioCtxCtor());
  }

  function ensureContext() {
    if (destroyed) return null;
    const Ctor = getAudioCtxCtor();
    if (!Ctor) return null;
    if (!ctx) {
      ctx = new Ctor();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.25;
      masterGain.connect(ctx.destination);

      const sampleRate = ctx.sampleRate || 44100;
      const len = sampleRate * 2;
      noiseBuffer = ctx.createBuffer(1, len, sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function clearActiveNodes() {
    if (sirenInterval !== null) {
      clearInterval(sirenInterval);
      sirenInterval = null;
    }
    while (activeStoppers.length) {
      const stopFn = activeStoppers.pop();
      try {
        stopFn();
      } catch {
        // Ignore already-stopped nodes during teardown
      }
    }
  }

  function startEnRouteSound(audioCtx) {
    if (!audioCtx || !masterGain) return;

    // 1. Engine low rumble
    const engineOsc = audioCtx.createOscillator();
    const engineGain = audioCtx.createGain();
    const engineFilter = audioCtx.createBiquadFilter();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 56;
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 180;
    engineGain.gain.value = 0.22;
    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(masterGain);
    engineOsc.start();

    // 2. Two-tone emergency siren
    const sirenOsc = audioCtx.createOscillator();
    const sirenGain = audioCtx.createGain();
    const sirenFilter = audioCtx.createBiquadFilter();
    sirenOsc.type = "triangle";
    sirenOsc.frequency.value = 660;
    sirenFilter.type = "bandpass";
    sirenFilter.frequency.value = 820;
    sirenFilter.Q.value = 1.6;
    sirenGain.gain.value = 0.14;
    sirenOsc.connect(sirenFilter);
    sirenFilter.connect(sirenGain);
    sirenGain.connect(masterGain);
    sirenOsc.start();

    let highTone = false;
    sirenInterval = setInterval(() => {
      if (!audioCtx || destroyed || muted || paused) return;
      highTone = !highTone;
      const nextFreq = highTone ? 880 : 660;
      sirenOsc.frequency.setTargetAtTime(nextFreq, audioCtx.currentTime, 0.05);
    }, 360);

    activeStoppers.push(() => {
      engineOsc.stop();
      engineOsc.disconnect();
      engineFilter.disconnect();
      engineGain.disconnect();
      sirenOsc.stop();
      sirenOsc.disconnect();
      sirenFilter.disconnect();
      sirenGain.disconnect();
    });
  }

  function startExtinguishSound(audioCtx) {
    if (!audioCtx || !masterGain || !noiseBuffer) return;

    // 1. Fire crackle noise (low-mid rumble scaled with fire intensity)
    const fireSrc = audioCtx.createBufferSource();
    fireSrc.buffer = noiseBuffer;
    fireSrc.loop = true;
    const fireFilter = audioCtx.createBiquadFilter();
    fireFilter.type = "bandpass";
    fireFilter.frequency.value = 420;
    fireFilter.Q.value = 1.1;
    const fireGain = audioCtx.createGain();
    fireGain.gain.value = 0.28 * Math.max(0.05, currentIntensity);
    fireSrc.connect(fireFilter);
    fireFilter.connect(fireGain);
    fireGain.connect(masterGain);
    fireSrc.start();

    // 2. Pressurized water spray noise
    const waterSrc = audioCtx.createBufferSource();
    waterSrc.buffer = noiseBuffer;
    waterSrc.loop = true;
    const waterFilter = audioCtx.createBiquadFilter();
    waterFilter.type = "highpass";
    waterFilter.frequency.value = 1650;
    const waterGain = audioCtx.createGain();
    waterGain.gain.value = 0.18;
    waterSrc.connect(waterFilter);
    waterFilter.connect(waterGain);
    waterGain.connect(masterGain);
    waterSrc.start();

    activeStoppers.push(() => {
      fireSrc.stop();
      fireSrc.disconnect();
      fireFilter.disconnect();
      fireGain.disconnect();
      waterSrc.stop();
      waterSrc.disconnect();
      waterFilter.disconnect();
      waterGain.disconnect();
    });
  }

  function playCompletionChime(audioCtx) {
    if (!audioCtx || !masterGain || chimePlayedForCompletion) return;
    chimePlayedForCompletion = true;

    const now = audioCtx.currentTime;
    const notes = [523.25, 659.25];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + idx * 0.16;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.34);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  }

  function syncAudioGraph() {
    clearActiveNodes();
    if (destroyed || muted || paused) {
      if (masterGain && ctx) {
        masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      }
      return;
    }

    const audioCtx = ensureContext();
    if (!audioCtx || !masterGain) return;
    masterGain.gain.setTargetAtTime(0.25, audioCtx.currentTime, 0.03);

    if (currentPhase === "en_route") {
      chimePlayedForCompletion = false;
      startEnRouteSound(audioCtx);
    } else if (currentPhase === "extinguishing") {
      chimePlayedForCompletion = false;
      startExtinguishSound(audioCtx);
    } else if (currentPhase === "completed") {
      playCompletionChime(audioCtx);
    }
  }

  function setMuted(nextMuted) {
    muted = Boolean(nextMuted);
    if (!muted) {
      ensureContext();
    }
    syncAudioGraph();
    return muted;
  }

  function setPhase(phase, intensity = 1) {
    const prevPhase = currentPhase;
    currentPhase = phase || "idle";
    currentIntensity = Math.max(0, Math.min(1, Number(intensity)));
    if (currentPhase !== "completed") {
      chimePlayedForCompletion = false;
    }
    if (prevPhase !== currentPhase) {
      syncAudioGraph();
    }
  }

  function pause() {
    paused = true;
    syncAudioGraph();
  }

  function resume() {
    paused = false;
    syncAudioGraph();
  }

  function stop() {
    currentPhase = "idle";
    paused = false;
    chimePlayedForCompletion = false;
    clearActiveNodes();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearActiveNodes();
    if (masterGain) {
      try {
        masterGain.disconnect();
      } catch {
        // ignore
      }
      masterGain = null;
    }
    if (ctx) {
      try {
        ctx.close().catch(() => {});
      } catch {
        // ignore
      }
      ctx = null;
    }
    noiseBuffer = null;
  }

  return {
    isSupported,
    isMuted: () => muted,
    setMuted,
    setPhase,
    pause,
    resume,
    stop,
    destroy
  };
}
