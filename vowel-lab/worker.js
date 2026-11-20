importScripts('analysis.js?v=4', 'live_tracker.js?v=4', 'voicesu_tracker.js?v=4');
let factory, stream, origin, expected, epoch;
let delivery = Promise.resolve();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

self.onmessage = async ({data}) => {
  try {
    if (data.type === 'init') {
      const base = data.station ? new URL('./voicesu/', self.location.href).href : VoiceSuLab.cdn;
      factory = await VoiceSuLab.load(base);
      self.postMessage({type:'ready', algorithm:VoiceSuLab.algorithm, settings:VoiceSuLab.settings});
      return;
    }
    if (data.type === 'replay') {
      const tracker = factory(data.rate);
      // Return the first half second immediately and let playback start while
      // the rest of a longer clip is being analyzed.
      const batch = Math.max(1, Math.round(data.rate / 2));
      for (let pos = 0; pos < data.samples.length; pos += batch) {
        const frames = [];
        tracker.push(data.samples.subarray(pos, pos + batch), frame => frames.push(frame));
        self.postMessage({type:'replay', frames, done:pos + batch >= data.samples.length});
      }
      return;
    }
    if (data.type !== 'samples') return;
    if (!stream || data.epoch !== epoch || data.first !== expected) {
      stream = factory(data.rate);
      origin = data.first;
      epoch = data.epoch;
    }
    expected = data.first + data.samples.length;
    const started = performance.now();
    stream.push(data.samples, (frame, meterWindow) => {
      const end = origin + frame.endSample;
      const clockEnd = origin + stream.frames.count;
      const message = {...frame, type:'reading', epoch:data.epoch, timeMs:data.stamp + (end - expected)*1000/data.rate,
        clip:data.clip && {...data.clip, endFrame:clockEnd}, analysisMs:performance.now() - started};
      let ready = message;
      if (data.clip) {
        // This digest matches the native-rate WAV window used by the SNR meter.
        const bytes = new Uint8Array(Float32Array.from(meterWindow).buffer);
        message.windowTail = hex(bytes.subarray(-32));
        ready = crypto.subtle.digest('SHA-256', bytes).then(hash => ({...message, windowSha256:hex(new Uint8Array(hash))}));
      }
      // Hashes may finish out of order. Keep both the chart and saved trace on the audio clock.
      delivery = delivery.then(() => ready).then(result => self.postMessage(result))
        .catch(error => self.postMessage({type:'failure', error:error.message}));
    });
  } catch (error) {
    self.postMessage({type:'failure', error:error.message});
  }
};
