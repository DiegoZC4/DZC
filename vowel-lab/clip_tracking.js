// Listen to the saved WAV and track it directly, including when mic access is
// unavailable. Seeking only moves the playhead across the clip's own analysis.
function createClipTrackingReview(audio, view) {
  let source = '', engine, abort, frames = [], version = 0, complete = false, failed = false;
  let animation, last = -1, playing = false;

  function discard() {
    ++version;
    abort?.abort(); engine?.terminate(); engine = null;
    frames = []; source = ''; last = -1; failed = complete = false;
  }
  function pause() {
    cancelAnimationFrame(animation);
    if (!playing) return;
    playing = false; last = -1; view.clear(); view.resume();
  }
  function failure(error) {
    failed = true;
    engine?.terminate(); engine = null;
    if (playing) view.status('Could not track this recording. ' + error, 'error');
  }
  async function prepare(url) {
    discard(); source = url;
    const current = version;
    abort = new AbortController();
    try {
      const response = await fetch(url, {signal:abort.signal});
      if (!response.ok) throw Error('WAV returned HTTP ' + response.status);
      const bytes = await response.arrayBuffer();
      if (version !== current) return;
      // Clip storage writes mono WAV with the source rate in its fmt header.
      const rate = new DataView(bytes).getUint32(24, true);
      const decoder = new OfflineAudioContext(1, 1, rate);
      const decoded = await decoder.decodeAudioData(bytes);
      if (version !== current) return;
      const samples = decoded.getChannelData(0).slice();
      engine = view.worker();
      engine.onerror = event => { if (current === version) failure(event.message); };
      engine.onmessage = ({data}) => {
        if (version !== current) return;
        if (data.type === 'failure') { failure(data.error); return; }
        if (data.type === 'ready') {
          engine.postMessage({type:'replay', rate:decoded.sampleRate, samples}, [samples.buffer]);
        } else if (data.type === 'replay') {
          frames.push(...data.frames);
          complete = data.done;
          if (complete) { engine.terminate(); engine = null; }
        }
      };
    } catch (error) { if (version === current) failure(error.message); }
  }
  function render() {
    if (!playing || failed) return;
    const time = 1000 * audio.currentTime;
    let lo = 0, hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid].timeMs <= time) lo = mid + 1; else hi = mid;
    }
    const index = lo - 1;
    if (!frames.length || (!complete && index === frames.length-1 && time-frames[index].timeMs>80)) {
      view.status('Analyzing recording · LPC and MFCC');
    } else if (index >= 0 && index !== last) {
      view.display(frames[index], performance.now(), true);
      last = index;
    }
    animation = requestAnimationFrame(render);
  }
  audio.addEventListener('play', () => {
    if (audio.paused) return;
    playing = true; view.clear();
    const url = audio.currentSrc || audio.src;
    if (source !== url || failed) void prepare(url);
    cancelAnimationFrame(animation); render();
  });
  audio.addEventListener('clipselected', () => {
    if (source !== audio.src) void prepare(audio.src);
  });
  audio.addEventListener('seeking', () => { if (playing) { last=-1; view.clear(); } });
  audio.addEventListener('pause', pause);
  audio.addEventListener('ended', pause);
  audio.addEventListener('emptied', () => {
    pause();
    if (!audio.hasAttribute('src') || audio.src !== source) discard();
  });
  window.addEventListener('pagehide', () => { pause(); discard(); });
  return {active:() => playing};
}
