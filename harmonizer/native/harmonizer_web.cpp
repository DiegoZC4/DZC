/*
 * harmonizer_web.cpp — Native Rubber Band Harmonizer with Browser GUI
 *
 * The browser serves controls and visualization only. PortAudio, aubio pitch
 * tracking, MIDI voice allocation, and formant-preserving Rubber Band pitch
 * shifting all run in this native process.
 *
 * brew install portaudio aubio rubberband
 *
 * Build:
 *   clang++ -O3 -std=c++17 harmonizer_web.cpp \
 *     -I/opt/homebrew/include -L/opt/homebrew/lib \
 *     -lportaudio -laubio -lrubberband -lpthread \
 *     -framework CoreAudio -framework CoreFoundation \
 *     -o harmonizer_web
 *
 * Browser GUI:
 *   http://127.0.0.1:8794/
 *   SSE stream for pitch/MIDI state, HTTP endpoints for sliders.
 */

#include <algorithm>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <portaudio.h>
#include <aubio/aubio.h>

#if defined(_WIN32)
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

#if defined(__APPLE__)
#include <pa_mac_core.h>
#endif

// ═══════════════════════════════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════════════════════════════

static constexpr int   kSampleRate      = 44100;
static constexpr int   kFramesPerBuffer = 64;
static constexpr int   kMaxVoices       = 16;
static constexpr float kPi              = 3.14159265358979323846f;

// Pitch detection
static constexpr int   kPitchWinSize    = 2048;
static constexpr int   kPitchHopSize    = 512;

// Voice
static constexpr float kAttackSec       = 0.005f;
static constexpr float kReleaseSec      = 0.080f;

// Voicing gate for the wet harmony as a whole. Two Rubber Band blocks bridge
// brief detector dropouts before the wet path fades.
static constexpr int   kVoicingGraceHops  = 2;
static constexpr float kVoicingAttackSec  = 0.015f;
static constexpr float kVoicingReleaseSec = 0.120f;

static constexpr float kBendRange       = 2.0f;

// Constant-amplitude wet/dry crossfade.
static constexpr float kDefaultWetDryBalance = 0.56f; // 0 = dry, 1 = wet
static constexpr float kDefaultMonitorGainDb = 18.0f;
static constexpr float kDefaultVoicedGateRms = 0.0100f;
static constexpr float kDefaultStableSemitoneWindow = 1.0f;

static constexpr int   kDefaultWebPort  = 8794;
static constexpr const char* kWebIndexPath = "web/index.html";
static constexpr const char* kAudioInputPreferencePath = ".harmonizer_input_device";
static constexpr const char* kAudioOutputPreferencePath = ".harmonizer_output_device";

#if defined(_WIN32)
using SocketHandle = SOCKET;
static constexpr SocketHandle kInvalidSocket = INVALID_SOCKET;

static bool initializeSockets() {
    WSADATA data{};
    return WSAStartup(MAKEWORD(2, 2), &data) == 0;
}

static void shutdownSockets() { WSACleanup(); }
static void closeSocket(SocketHandle socket) { closesocket(socket); }
static void shutdownSocket(SocketHandle socket) { ::shutdown(socket, SD_BOTH); }
static std::string socketErrorText() { return std::to_string(WSAGetLastError()); }
#else
using SocketHandle = int;
static constexpr SocketHandle kInvalidSocket = -1;

static bool initializeSockets() { return true; }
static void shutdownSockets() {}
static void closeSocket(SocketHandle socket) { ::close(socket); }
static void shutdownSocket(SocketHandle socket) { ::shutdown(socket, SHUT_RDWR); }
static std::string socketErrorText() { return std::strerror(errno); }
#endif

static std::atomic<bool> gRunning{true};
static std::atomic<bool> gAudioReady{false};
static std::atomic<bool> gMidiReady{false};
static std::mutex gAudioMutex;
static bool gPortAudioInitialized = false;
static PaStream* gAudioInputStream = nullptr;
static PaStream* gAudioOutputStream = nullptr;
static PaDeviceIndex gAudioInputDevice = paNoDevice;
static PaDeviceIndex gAudioOutputDevice = paNoDevice;

struct AudioDevice {
    PaDeviceIndex index = paNoDevice;
    std::string name;
};

static std::vector<AudioDevice> gAudioInputDevices;
static std::vector<AudioDevice> gAudioOutputDevices;
static std::string gAudioError;
static std::string gAudioInputName = "unknown";
static std::string gAudioOutputName = "unknown";
static std::string gMidiError;

static std::string portAudioDeviceName(PaDeviceIndex device) {
    if (device == paNoDevice) return "none";
    const PaDeviceInfo* info = Pa_GetDeviceInfo(device);
    return (info && info->name) ? info->name : "unknown";
}

// ── Utilities ──────────────────────────────────────────────────────────────

static inline float noteToFreq(float n) {
    return 440.0f * std::pow(2.0f, (n - 69.0f) / 12.0f);
}
static inline float freqToMidi(float f) {
    return (f > 0.0f) ? 69.0f + 12.0f * std::log2(f / 440.0f) : -1.0f;
}
static inline float clampf(float x, float lo, float hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}
static inline void wetDryFromBalance(float balance, float& wet, float& dry) {
    balance = clampf(balance, 0.0f, 1.0f);
    wet = balance;
    dry = 1.0f - balance;
}
static inline float foldHighPitchCandidate(float hz, float anchorMidi) {
    if (hz <= 0.0f) return -1.0f;

    // Without an anchor, trust the detector: folding toward a guessed
    // register octave-locks voices singing above it. The median filter
    // establishes a real anchor within a few frames.
    if (anchorMidi < 0.0f) return hz;

    float targetMidi = anchorMidi;
    float bestHz = hz;
    float bestDistance = std::fabs(freqToMidi(hz) - targetMidi);
    for (float candidate = hz * 0.5f; candidate >= noteToFreq(36); candidate *= 0.5f) {
        float distance = std::fabs(freqToMidi(candidate) - targetMidi);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestHz = candidate;
        }
    }
    return bestHz;
}
// ── Pitch Detector (aubio) ─────────────────────────────────────────────────

struct PitchDetector {
    aubio_pitch_t* au  = nullptr;
    fvec_t*        in  = nullptr;
    fvec_t*        out = nullptr;

    PitchDetector() {
        au = new_aubio_pitch("yinfft", kPitchWinSize, kPitchHopSize, kSampleRate);
        aubio_pitch_set_unit(au, "Hz");
        aubio_pitch_set_silence(au, -50.0f);
        // 0.40 measured best on the vocadito fixtures (make test-pitch):
        // looser values let yinfft return persistent sub-octave readings.
        aubio_pitch_set_tolerance(au, 0.40f);
        in  = new_fvec(kPitchHopSize);
        out = new_fvec(1);
    }
    ~PitchDetector() {
        if (au) del_aubio_pitch(au);
        if (in) del_fvec(in);
        if (out) del_fvec(out);
    }
    float detect(const float* samples, float gateRms) {
        float rms = 0.0f;
        for (int i = 0; i < kPitchHopSize; i++) { in->data[i] = samples[i]; rms += samples[i]*samples[i]; }
        // Always feed the detector so its internal analysis window stays
        // contiguous across gated frames; gate only the result. Skipping the
        // call leaves stale audio spliced into the window, so the first frames
        // after the gate reopens read garbage.
        aubio_pitch_do(au, in, out);
        if (std::sqrt(rms / kPitchHopSize) < gateRms) return -1.0f;
        float f = fvec_get_sample(out, 0);
        // No upper range check here: octave-up errors are folded back into
        // range by the caller (foldHighPitchCandidate), which needs to see them.
        if (f <= 0.0f || f < noteToFreq(36)) return -1.0f;
        return f;
    }
};

// ── Shared Display State (lock-free, audio/MIDI → browser) ─────────────────

struct SharedDisplay {
    std::atomic<float>    detectedMidi{-1.0f};
    std::atomic<float>    rawMidi{-1.0f};
    std::atomic<float>    correctionMidi{-1.0f};
    std::atomic<float>    pitchRms{0.0f};
    std::atomic<bool>     pitchStable{false};
    std::atomic<bool>     pitchVoiced{false};
    std::atomic<float>    wetDryBalance{kDefaultWetDryBalance};
    std::atomic<float>    monitorGainDb{kDefaultMonitorGainDb};
    std::atomic<float>    voicedGateRms{kDefaultVoicedGateRms};
    std::atomic<float>    stableSemitoneWindow{kDefaultStableSemitoneWindow};
    std::atomic<float>    inputPeak{0.0f};
    std::atomic<float>    outputPeak{0.0f};
    std::atomic<uint64_t> callbackFrames{0};
    std::atomic<uint64_t> inputOverflows{0};
    std::atomic<uint64_t> outputUnderflows{0};
    std::atomic<uint64_t> noteBitsLo{0};   // notes 0–63
    std::atomic<uint64_t> noteBitsHi{0};   // notes 64–127

    void noteOn(int n) {
        if (n < 64) noteBitsLo.fetch_or(1ULL << n,      std::memory_order_relaxed);
        else        noteBitsHi.fetch_or(1ULL << (n-64), std::memory_order_relaxed);
    }
    void noteOff(int n) {
        if (n < 64) noteBitsLo.fetch_and(~(1ULL << n),      std::memory_order_relaxed);
        else        noteBitsHi.fetch_and(~(1ULL << (n-64)), std::memory_order_relaxed);
    }
    bool isNoteOn(int n) const {
        if (n < 64) return (noteBitsLo.load(std::memory_order_relaxed) >> n) & 1;
        return (noteBitsHi.load(std::memory_order_relaxed) >> (n-64)) & 1;
    }
};

// ── Diagnostic Capture ─────────────────────────────────────────────────────
// Records the raw mic, the processed output, per-frame pitch state, and
// timestamped MIDI events into captures/cap_<stamp>/ so a bad-sounding take
// can be replayed and diagnosed offline (pitch_analyzer reads mic.wav
// directly). Toggled from the GUI via /api/capture.

struct Capture {
    static constexpr int kMaxSeconds = 120;

    std::atomic<bool>   active{false};
    std::mutex          controlMutex;   // serializes start/stop (HTTP threads)
    uint64_t            startClock = 0;

    std::vector<float>  mic;    // mono input
    std::vector<float>  outL;   // processed output
    std::vector<float>  outR;
    std::atomic<size_t> audioLen{0};

    struct FrameRow {
        uint64_t sample;
        float rms, rawHz, foldedHz, medianHz, smoothedMidi, correctionMidi;
        uint8_t stable, voiced;
    };
    std::vector<FrameRow> frames;
    std::atomic<size_t>   frameLen{0};

    struct MidiRow { uint64_t sample; uint8_t on; uint8_t note; };
    std::vector<MidiRow> midi;
    std::atomic<size_t>  midiLen{0};

    // Audio thread only. The release store on the length publishes the
    // buffer writes to the HTTP thread that serializes after stop.
    void appendAudio(float in, float l, float r) {
        size_t n = audioLen.load(std::memory_order_relaxed);
        if (n >= mic.size()) return;
        mic[n] = in; outL[n] = l; outR[n] = r;
        audioLen.store(n + 1, std::memory_order_release);
    }
    void appendFrame(const FrameRow& row) {
        size_t n = frameLen.load(std::memory_order_relaxed);
        if (n >= frames.size()) return;
        frames[n] = row;
        frameLen.store(n + 1, std::memory_order_release);
    }
    // MIDI handler threads, serialized by AudioEngine::midiMutex.
    void appendMidi(uint64_t sample, bool on, int note) {
        size_t n = midiLen.load(std::memory_order_relaxed);
        if (n >= midi.size()) return;
        midi[n] = { sample, (uint8_t)(on ? 1 : 0), (uint8_t)note };
        midiLen.store(n + 1, std::memory_order_release);
    }
};

// The server and capture plumbing stay in this translation unit; the native
// DSP backend is isolated here so the browser remains only a GUI.
#include "harmonizer_rubberband_engine.hpp"

// ── Per-sample engine step (shared by live callback and --render) ──────────

static inline void processSample(AudioEngine* eng, float s, float& outL, float& outR) {
    {
        // Feed pitch detector
        eng->pitchBuf[eng->pitchPos++] = s;
        if (eng->pitchPos >= kPitchHopSize) {
            float sumSq = 0.0f;
            for (int j = 0; j < kPitchHopSize; j++) sumSq += eng->pitchBuf[j] * eng->pitchBuf[j];
            eng->recentPitchRms = std::sqrt(sumSq / kPitchHopSize);

            float gateRms = eng->display.voicedGateRms.load(std::memory_order_relaxed);
            float detectorGateRms = eng->pitchVoiced ? gateRms * AudioEngine::kPitchGateReleaseRatio : gateRms;
            float rawFreq = eng->detector.detect(eng->pitchBuf, detectorGateRms);
            float freq = foldHighPitchCandidate(rawFreq, eng->smoothedMidi);
            if (freq > 0.0f && (freq < noteToFreq(36) || freq > noteToFreq(84))) freq = -1.0f;
            float midi = freq > 0.0f ? freqToMidi(freq) : -1.0f;
            eng->display.rawMidi.store(midi, std::memory_order_relaxed);

            // Median filter suppresses speckles before the slower contour smoother.
            eng->pitchHist[eng->pitchHistIdx] = freq;
            eng->pitchHistIdx = (eng->pitchHistIdx + 1) % AudioEngine::kPitchHistLen;

            // Copy history, sort, take median (ignore -1 invalids)
            float sorted[AudioEngine::kPitchHistLen];
            int   validN = 0;
            for (int k = 0; k < AudioEngine::kPitchHistLen; k++)
                if (eng->pitchHist[k] > 0.0f) sorted[validN++] = eng->pitchHist[k];

            float medianFreq = -1.0f;
            if (validN > 0) {
                // insertion sort on the small array
                for (int a = 1; a < validN; a++) {
                    float v = sorted[a]; int b = a - 1;
                    while (b >= 0 && sorted[b] > v) { sorted[b+1] = sorted[b]; b--; }
                    sorted[b+1] = v;
                }
                medianFreq = sorted[validN / 2];
            }
            float medianMidi = freqToMidi(medianFreq);
            float stableWindow = eng->display.stableSemitoneWindow.load(std::memory_order_relaxed);

            // The long history above is intentionally calm enough to draw and
            // gate. Rubber Band needs a much faster estimate so its inverse
            // ratio cancels vibrato instead of following it late. Three frames
            // reject a one-frame octave glitch with only 11.6 ms median delay.
            eng->correctionHist[eng->correctionHistIdx] = freq;
            eng->correctionHistIdx =
                (eng->correctionHistIdx + 1) % AudioEngine::kCorrectionHistLen;
            if (freq > 0.0f &&
                eng->recentPitchRms >= gateRms * AudioEngine::kPitchGateReleaseRatio) {
                float correctionSorted[AudioEngine::kCorrectionHistLen];
                int correctionN = 0;
                for (int k = 0; k < AudioEngine::kCorrectionHistLen; k++) {
                    if (eng->correctionHist[k] > 0.0f)
                        correctionSorted[correctionN++] = eng->correctionHist[k];
                }
                for (int a = 1; a < correctionN; a++) {
                    float v = correctionSorted[a];
                    int b = a - 1;
                    while (b >= 0 && correctionSorted[b] > v) {
                        correctionSorted[b + 1] = correctionSorted[b];
                        b--;
                    }
                    correctionSorted[b + 1] = v;
                }
                eng->fastCorrectionMidi =
                    freqToMidi(correctionSorted[correctionN / 2]);
                eng->correctionHoldFrames = AudioEngine::kPitchReleaseFrames;
            } else if (eng->correctionHoldFrames > 0) {
                eng->correctionHoldFrames--;
            } else {
                eng->fastCorrectionMidi = -1.0f;
            }

            eng->correctionControlHistory[eng->correctionControlHistoryIdx] =
                eng->fastCorrectionMidi;
            eng->correctionControlHistoryIdx =
                (eng->correctionControlHistoryIdx + 1) %
                AudioEngine::kCorrectionControlHistoryLen;
            constexpr int kControlLag =
                AudioEngine::kCorrectionLagHops < AudioEngine::kCorrectionControlHistoryLen
                ? AudioEngine::kCorrectionLagHops
                : AudioEngine::kCorrectionControlHistoryLen - 1;
            int delayedIndex =
                (eng->correctionControlHistoryIdx - 1 - kControlLag +
                 AudioEngine::kCorrectionControlHistoryLen) %
                AudioEngine::kCorrectionControlHistoryLen;
            float delayedCorrection = eng->correctionControlHistory[delayedIndex];
            eng->correctionMidi = delayedCorrection > 0.0f
                ? delayedCorrection
                : eng->fastCorrectionMidi;
            eng->display.correctionMidi.store(eng->correctionMidi, std::memory_order_relaxed);

            // Stable = a majority of recent valid readings agree with the
            // median. Judging the history against itself (instead of requiring
            // the current frame to be valid and near the median) lets single
            // dropped or glitched frames pass without breaking the contour.
            int agreeN = 0;
            if (medianMidi > 0.0f) {
                for (int k = 0; k < validN; k++)
                    if (std::fabs(freqToMidi(sorted[k]) - medianMidi) < stableWindow) agreeN++;
            }
            // The RMS check keeps stale history from holding "stable" into
            // silence after a phrase ends.
            bool stable = (validN >= AudioEngine::kMinPitchValidFrames &&
                           medianMidi > 0.0f &&
                           2 * agreeN > validN &&
                           eng->recentPitchRms >= gateRms * AudioEngine::kPitchGateReleaseRatio);
            bool holdVoiced = eng->pitchVoiced &&
                              eng->smoothedMidi > 0.0f &&
                              eng->pitchHoldFrames > 0 &&
                              eng->recentPitchRms >= gateRms * AudioEngine::kPitchGateReleaseRatio;

            if (stable) {
                if (eng->smoothedMidi < 0.0f ||
                    std::fabs(medianMidi - eng->smoothedMidi) > AudioEngine::kPitchSnapSemitones) {
                    // Note change (or fresh latch): the median already agrees
                    // on the new pitch, so snap rather than glide through the gap.
                    eng->smoothedMidi = medianMidi;
                } else {
                    float delta = clampf(medianMidi - eng->smoothedMidi,
                                         -AudioEngine::kPitchMaxStepSemitones,
                                         AudioEngine::kPitchMaxStepSemitones);
                    float targetMidi = eng->smoothedMidi + delta;
                    eng->smoothedMidi += (targetMidi - eng->smoothedMidi) *
                                         AudioEngine::kPitchSmoothingAlpha;
                }
                eng->detectedMidi = eng->smoothedMidi;
                eng->detectedF0   = noteToFreq(eng->smoothedMidi);
                eng->pitchStable  = true;
                eng->pitchVoiced  = true;
                eng->pitchHoldFrames = AudioEngine::kPitchReleaseFrames;
            } else if (holdVoiced) {
                eng->detectedMidi = eng->smoothedMidi;
                eng->detectedF0   = noteToFreq(eng->smoothedMidi);
                eng->pitchStable  = false;
                eng->pitchVoiced  = true;
                eng->pitchHoldFrames--;
            } else {
                eng->detectedMidi = -1.0f;
                eng->detectedF0  = -1.0f;
                eng->pitchStable = false;
                eng->pitchVoiced = false;
                eng->pitchHoldFrames = 0;
                eng->smoothedMidi = -1.0f;
            }
            eng->prevMidi = eng->detectedMidi;
            eng->display.detectedMidi.store(eng->detectedMidi, std::memory_order_relaxed);
            eng->display.pitchRms.store(eng->recentPitchRms, std::memory_order_relaxed);
            eng->display.pitchStable.store(eng->pitchStable, std::memory_order_relaxed);
            eng->display.pitchVoiced.store(eng->pitchVoiced, std::memory_order_relaxed);

            if (eng->capture.active.load(std::memory_order_acquire)) {
                Capture::FrameRow row;
                row.sample       = eng->sampleClock.load(std::memory_order_relaxed);
                row.rms          = eng->recentPitchRms;
                row.rawHz        = rawFreq;
                row.foldedHz     = freq;
                row.medianHz     = medianFreq;
                row.smoothedMidi = eng->detectedMidi;
                row.correctionMidi = eng->correctionMidi;
                row.stable       = eng->pitchStable ? 1 : 0;
                row.voiced       = eng->pitchVoiced ? 1 : 0;
                eng->capture.appendFrame(row);
            }
            eng->pitchPos = 0;
        }

        // Accumulate the next native Rubber Band block while returning the
        // preceding processed block to PortAudio.
        if (eng->bufPos == 0) {
            float gainDb = eng->display.monitorGainDb.load(std::memory_order_relaxed);
            eng->monitorGainLinear = std::pow(10.0f, gainDb / 20.0f);
        }
        eng->inputBuf[eng->bufPos] = clampf(s * eng->monitorGainLinear, -1.0f, 1.0f);
        outL = eng->outputL[eng->bufPos];
        outR = eng->outputR[eng->bufPos];

        uint64_t clock = eng->sampleClock.load(std::memory_order_relaxed);
        uint64_t toneStart = eng->testToneStartClock.load(std::memory_order_relaxed);
        uint64_t toneEnd = eng->testToneEndClock.load(std::memory_order_relaxed);
        if (clock >= toneStart && clock < toneEnd) {
            constexpr float kTonePeak = 0.10f;
            constexpr uint64_t kToneFadeSamples = kSampleRate / 100;
            uint64_t elapsed = clock - toneStart;
            uint64_t remaining = toneEnd - clock;
            float fade = std::min(1.0f,
                std::min((float)elapsed / kToneFadeSamples,
                         (float)remaining / kToneFadeSamples));
            float tone = std::sin(eng->testTonePhase) * kTonePeak * fade;
            outL = clampf(outL + tone, -1.0f, 1.0f);
            outR = clampf(outR + tone, -1.0f, 1.0f);
            eng->testTonePhase += 2.0f * kPi * 440.0f / kSampleRate;
            if (eng->testTonePhase >= 2.0f * kPi)
                eng->testTonePhase -= 2.0f * kPi;
        }

        eng->sampleClock.fetch_add(1, std::memory_order_relaxed);
        if (eng->capture.active.load(std::memory_order_acquire))
            eng->capture.appendAudio(s, outL, outR);

        if (++eng->bufPos >= eng->blockSize) {
            eng->processBlock();
            eng->bufPos = 0;
        }
    }
}

// ── PortAudio Callbacks ────────────────────────────────────────────────────
// Input and output use separate native streams so a USB mic and the Mac's
// headphone device do not have to coexist inside one fragile AUHAL unit.

static int audioInputCallback(const void* input, void*, unsigned long frames,
                              const PaStreamCallbackTimeInfo*,
                              PaStreamCallbackFlags statusFlags, void* ud)
{
    auto* eng = static_cast<AudioEngine*>(ud);
    const float* mic = static_cast<const float*>(input);
    if (statusFlags & paInputOverflow)
        eng->display.inputOverflows.fetch_add(1, std::memory_order_relaxed);
    if (!mic) return paContinue;

    uint64_t write = eng->outputBridgeWrite.load(std::memory_order_relaxed);
    uint64_t read = eng->outputBridgeRead.load(std::memory_order_acquire);
    bool bridgeOverflow = false;
    float inputPeak = 0.0f;
    for (unsigned long i = 0; i < frames; i++) {
        float outL = 0.0f;
        float outR = 0.0f;
        processSample(eng, mic[i], outL, outR);
        inputPeak = std::max(inputPeak, std::fabs(mic[i]));
        if (write - read < AudioEngine::kOutputBridgeFrames) {
            size_t slot = (size_t)write & AudioEngine::kOutputBridgeMask;
            eng->outputBridgeL[slot] = outL;
            eng->outputBridgeR[slot] = outR;
            write++;
        } else {
            bridgeOverflow = true;
        }
    }
    eng->outputBridgeWrite.store(write, std::memory_order_release);
    if (bridgeOverflow)
        eng->display.inputOverflows.fetch_add(1, std::memory_order_relaxed);

    float previousInput = eng->display.inputPeak.load(std::memory_order_relaxed);
    eng->display.inputPeak.store(std::max(inputPeak, previousInput * 0.995f),
                                 std::memory_order_relaxed);
    return paContinue;
}

static int audioOutputCallback(const void*, void* output, unsigned long frames,
                               const PaStreamCallbackTimeInfo*,
                               PaStreamCallbackFlags statusFlags, void* ud)
{
    auto* eng = static_cast<AudioEngine*>(ud);
    float* stereo = static_cast<float*>(output);
    bool streamUnderflow = (statusFlags & paOutputUnderflow) != 0;
    uint64_t read = eng->outputBridgeRead.load(std::memory_order_relaxed);
    uint64_t write = eng->outputBridgeWrite.load(std::memory_order_acquire);
    bool primed = eng->outputBridgePrimed.load(std::memory_order_relaxed);
    if (!primed && write - read >= AudioEngine::kOutputBridgePrimeFrames) primed = true;

    float outputPeak = 0.0f;
    for (unsigned long i = 0; i < frames; i++) {
        float outL = 0.0f;
        float outR = 0.0f;
        if (primed && read < write) {
            size_t slot = (size_t)read & AudioEngine::kOutputBridgeMask;
            outL = eng->outputBridgeL[slot];
            outR = eng->outputBridgeR[slot];
            read++;
        } else if (primed) {
            primed = false;
            streamUnderflow = true;
        }
        stereo[2*i] = outL;
        stereo[2*i + 1] = outR;
        outputPeak = std::max(outputPeak, std::max(std::fabs(outL), std::fabs(outR)));
    }
    eng->outputBridgeRead.store(read, std::memory_order_release);
    eng->outputBridgePrimed.store(primed, std::memory_order_relaxed);
    if (streamUnderflow)
        eng->display.outputUnderflows.fetch_add(1, std::memory_order_relaxed);

    // A short peak hold keeps the 1.45 ms callback blocks visible to the
    // 20 Hz browser state stream without adding locks to either audio thread.
    float previousOutput = eng->display.outputPeak.load(std::memory_order_relaxed);
    eng->display.outputPeak.store(std::max(outputPeak, previousOutput * 0.995f),
                                  std::memory_order_relaxed);
    eng->display.callbackFrames.fetch_add(frames, std::memory_order_relaxed);
    return paContinue;
}

static void closeAudioStreamLocked() {
    gAudioReady.store(false, std::memory_order_relaxed);
    if (gAudioInputStream && Pa_IsStreamActive(gAudioInputStream) == 1)
        Pa_StopStream(gAudioInputStream);
    if (gAudioOutputStream && Pa_IsStreamActive(gAudioOutputStream) == 1)
        Pa_StopStream(gAudioOutputStream);
    if (gAudioInputStream) Pa_CloseStream(gAudioInputStream);
    if (gAudioOutputStream) Pa_CloseStream(gAudioOutputStream);
    gAudioInputStream = nullptr;
    gAudioOutputStream = nullptr;
}

static void enumerateAudioOutputsLocked() {
    gAudioOutputDevices.clear();
    int count = Pa_GetDeviceCount();
    if (count < 0) return;
    for (PaDeviceIndex index = 0; index < count; index++) {
        const PaDeviceInfo* info = Pa_GetDeviceInfo(index);
        if (!info || info->maxOutputChannels < 2) continue;
        gAudioOutputDevices.push_back({index, info->name ? info->name : "unknown"});
    }
}

static void enumerateAudioInputsLocked() {
    gAudioInputDevices.clear();
    int count = Pa_GetDeviceCount();
    if (count < 0) return;
    for (PaDeviceIndex index = 0; index < count; index++) {
        const PaDeviceInfo* info = Pa_GetDeviceInfo(index);
        if (!info || info->maxInputChannels < 1) continue;
        gAudioInputDevices.push_back({index, info->name ? info->name : "unknown"});
    }
}

static PaDeviceIndex preferredAudioInputLocked(PaDeviceIndex fallback) {
    std::ifstream input(kAudioInputPreferencePath);
    std::string preferredName;
    std::getline(input, preferredName);
    if (!preferredName.empty() && preferredName.back() == '\r') preferredName.pop_back();
    for (const auto& device : gAudioInputDevices) {
        if (device.name == preferredName) return device.index;
    }
    return fallback;
}

static PaDeviceIndex preferredAudioOutputLocked(PaDeviceIndex fallback) {
    std::ifstream input(kAudioOutputPreferencePath);
    std::string preferredName;
    std::getline(input, preferredName);
    if (!preferredName.empty() && preferredName.back() == '\r') preferredName.pop_back();
    for (const auto& device : gAudioOutputDevices) {
        if (device.name == preferredName) return device.index;
    }
    return fallback;
}

static void persistAudioOutputLocked(PaDeviceIndex outputDevice) {
    for (const auto& device : gAudioOutputDevices) {
        if (device.index != outputDevice) continue;
        std::ofstream output(kAudioOutputPreferencePath, std::ios::trunc);
        if (output) output << device.name << '\n';
        return;
    }
}

static void persistAudioInputLocked(PaDeviceIndex inputDevice) {
    for (const auto& device : gAudioInputDevices) {
        if (device.index != inputDevice) continue;
        std::ofstream output(kAudioInputPreferencePath, std::ios::trunc);
        if (output) output << device.name << '\n';
        return;
    }
}

static bool openAudioRoute(AudioEngine* engine, PaDeviceIndex inputDevice,
                           PaDeviceIndex outputDevice) {
    std::lock_guard<std::mutex> lock(gAudioMutex);
    if (!gPortAudioInitialized) return false;

    bool validInput = false;
    for (const auto& candidate : gAudioInputDevices) {
        if (candidate.index == inputDevice) {
            validInput = true;
            break;
        }
    }
    bool validOutput = false;
    for (const auto& candidate : gAudioOutputDevices) {
        if (candidate.index == outputDevice) {
            validOutput = true;
            break;
        }
    }
    if (!validInput || !validOutput) {
        gAudioError = "selected audio device is unavailable";
        return false;
    }
    if (gAudioInputStream && gAudioOutputStream &&
        gAudioInputDevice == inputDevice &&
        gAudioOutputDevice == outputDevice &&
        Pa_IsStreamActive(gAudioInputStream) == 1 &&
        Pa_IsStreamActive(gAudioOutputStream) == 1) {
        persistAudioInputLocked(inputDevice);
        persistAudioOutputLocked(outputDevice);
        return true;
    }

    closeAudioStreamLocked();
    gAudioInputDevice = inputDevice;
    const PaDeviceInfo* inputInfo = Pa_GetDeviceInfo(gAudioInputDevice);
    const PaDeviceInfo* outputInfo = Pa_GetDeviceInfo(outputDevice);
    if (!inputInfo || inputInfo->maxInputChannels < 1 || !outputInfo) {
        gAudioError = "audio input or output device is unavailable";
        return false;
    }

    PaStreamParameters inP{}, outP{};
    inP.device = gAudioInputDevice;
    inP.channelCount = 1;
    inP.sampleFormat = paFloat32;
    inP.suggestedLatency = inputInfo->defaultLowInputLatency;
    outP.device = outputDevice;
    outP.channelCount = 2;
    outP.sampleFormat = paFloat32;
    outP.suggestedLatency = outputInfo->defaultLowOutputLatency;

#if defined(__APPLE__)
    PaMacCoreStreamInfo inputMacInfo{}, outputMacInfo{};
    PaMacCore_SetupStreamInfo(&inputMacInfo, paMacCorePlayNice);
    PaMacCore_SetupStreamInfo(&outputMacInfo, paMacCorePlayNice);
    inP.hostApiSpecificStreamInfo = &inputMacInfo;
    outP.hostApiSpecificStreamInfo = &outputMacInfo;
#endif

    engine->outputBridgeRead.store(0, std::memory_order_relaxed);
    engine->outputBridgeWrite.store(0, std::memory_order_relaxed);
    engine->outputBridgePrimed.store(false, std::memory_order_relaxed);

    PaError error = Pa_OpenStream(&gAudioInputStream, &inP, nullptr, kSampleRate,
                                  kFramesPerBuffer, paClipOff | paDitherOff,
                                  audioInputCallback, engine);
    if (error == paNoError) {
        error = Pa_OpenStream(&gAudioOutputStream, nullptr, &outP, kSampleRate,
                              kFramesPerBuffer, paClipOff | paDitherOff,
                              audioOutputCallback, engine);
    }
    if (error == paNoError) error = Pa_StartStream(gAudioInputStream);
    if (error == paNoError) {
        Pa_Sleep(8);
        error = Pa_StartStream(gAudioOutputStream);
    }
    if (error != paNoError) {
        gAudioError = std::string("PortAudio stream failed: ") + Pa_GetErrorText(error);
        std::cerr << gAudioError << "\n";
        closeAudioStreamLocked();
        return false;
    }

    gAudioOutputDevice = outputDevice;
    gAudioInputName = portAudioDeviceName(gAudioInputDevice);
    gAudioOutputName = portAudioDeviceName(gAudioOutputDevice);
    persistAudioInputLocked(gAudioInputDevice);
    persistAudioOutputLocked(gAudioOutputDevice);
    gAudioError.clear();
    engine->display.inputPeak.store(0.0f, std::memory_order_relaxed);
    engine->display.outputPeak.store(0.0f, std::memory_order_relaxed);
    engine->display.inputOverflows.store(0, std::memory_order_relaxed);
    engine->display.outputUnderflows.store(0, std::memory_order_relaxed);
    gAudioReady.store(true, std::memory_order_relaxed);
    std::cerr << "PortAudio: " << gAudioInputName << " -> " << gAudioOutputName << "\n";
    return true;
}

static bool initializeAudio(AudioEngine* engine) {
    PaError error = Pa_Initialize();
    if (error != paNoError) {
        std::lock_guard<std::mutex> lock(gAudioMutex);
        gAudioError = std::string("PortAudio init failed: ") + Pa_GetErrorText(error);
        std::cerr << gAudioError << "\n";
        return false;
    }
    PaDeviceIndex inputDevice = Pa_GetDefaultInputDevice();
    PaDeviceIndex outputDevice = Pa_GetDefaultOutputDevice();
    {
        std::lock_guard<std::mutex> lock(gAudioMutex);
        gPortAudioInitialized = true;
        enumerateAudioInputsLocked();
        enumerateAudioOutputsLocked();
        inputDevice = preferredAudioInputLocked(inputDevice);
        outputDevice = preferredAudioOutputLocked(outputDevice);
    }
    for (int attempt = 0; attempt < 13; attempt++) {
        if (openAudioRoute(engine, inputDevice, outputDevice)) return true;
        if (attempt < 12) Pa_Sleep(500);
    }
    return false;
}

static void shutdownAudio() {
    std::lock_guard<std::mutex> lock(gAudioMutex);
    closeAudioStreamLocked();
    if (gPortAudioInitialized) {
        Pa_Terminate();
        gPortAudioInitialized = false;
    }
}

// ── MIDI ───────────────────────────────────────────────────────────────────

static void handleNoteOn(AudioEngine* eng, int note) {
    std::lock_guard<std::mutex> lock(eng->midiMutex);
    uint64_t stamp = ++eng->noteCounter;

    int chosen = -1;
    for (int v = 0; v < kMaxVoices; v++)
        if (!eng->voices[v].isAudible()) { chosen = v; break; }

    if (chosen < 0) {  // steal releasing voice
        float lo = 999.0f;
        for (int v = 0; v < kMaxVoices; v++)
            if (!eng->voices[v].gateOn.load(std::memory_order_relaxed) &&
                eng->voices[v].envelope < lo) { lo = eng->voices[v].envelope; chosen = v; }
    }
    if (chosen < 0) {  // steal oldest
        uint64_t oldest = UINT64_MAX;
        for (int v = 0; v < kMaxVoices; v++) {
            uint64_t st = eng->voices[v].stamp.load(std::memory_order_relaxed);
            if (st < oldest) { oldest = st; chosen = v; }
        }
    }
    if (chosen >= 0) {
        eng->voices[chosen].midiNote.store(note, std::memory_order_relaxed);
        eng->voices[chosen].gateOn.store(true,   std::memory_order_relaxed);
        eng->voices[chosen].stamp.store(stamp,   std::memory_order_relaxed);
        eng->voices[chosen].sustained = false;
        eng->display.noteOn(note);
    }
    if (eng->capture.active.load(std::memory_order_acquire))
        eng->capture.appendMidi(eng->sampleClock.load(std::memory_order_relaxed), true, note);
}

static void handleNoteOff(AudioEngine* eng, int note) {
    std::lock_guard<std::mutex> lock(eng->midiMutex);
    if (eng->capture.active.load(std::memory_order_acquire))
        eng->capture.appendMidi(eng->sampleClock.load(std::memory_order_relaxed), false, note);
    for (int v = 0; v < kMaxVoices; v++) {
        if (eng->voices[v].midiNote.load(std::memory_order_relaxed) == note &&
            eng->voices[v].gateOn.load(std::memory_order_relaxed)) {
            if (eng->sustainOn) {
                eng->voices[v].sustained = true;
            } else {
                eng->voices[v].gateOn.store(false, std::memory_order_relaxed);
                eng->display.noteOff(note);
            }
        }
    }
}

static void handleSustainOff(AudioEngine* eng) {
    for (int v = 0; v < kMaxVoices; v++) {
        if (eng->voices[v].sustained) {
            eng->voices[v].gateOn.store(false, std::memory_order_relaxed);
            eng->voices[v].sustained = false;
            int n = eng->voices[v].midiNote.load(std::memory_order_relaxed);
            if (n >= 0) eng->display.noteOff(n);
        }
    }
}

// ── Browser Server ─────────────────────────────────────────────────────────

static std::string readTextFile(const char* path) {
    std::ifstream in(path);
    if (!in) return "";
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

static bool sendAll(SocketHandle fd, const std::string& text) {
    const char* data = text.data();
    size_t left = text.size();
    while (left > 0) {
        const int chunk = static_cast<int>(std::min<size_t>(left, 0x7fffffff));
        const int n = ::send(fd, data, chunk, 0);
        if (n <= 0) return false;
        data += n;
        left -= (size_t)n;
    }
    return true;
}

static std::string response(const std::string& status,
                            const std::string& type,
                            const std::string& body)
{
    std::ostringstream out;
    out << "HTTP/1.1 " << status << "\r\n"
        << "Content-Type: " << type << "\r\n"
        << "Content-Length: " << body.size() << "\r\n"
        << "Cache-Control: no-store\r\n"
        << "Connection: close\r\n\r\n"
        << body;
    return out.str();
}

static bool queryFloat(const std::string& query, const std::string& key, float& value) {
    size_t pos = 0;
    while (pos <= query.size()) {
        size_t end = query.find('&', pos);
        std::string part = query.substr(pos, end == std::string::npos ? std::string::npos : end - pos);
        size_t eq = part.find('=');
        if (eq != std::string::npos && part.substr(0, eq) == key) {
            char* tail = nullptr;
            float parsed = std::strtof(part.c_str() + eq + 1, &tail);
            if (tail && *tail == '\0') {
                value = parsed;
                return true;
            }
        }
        if (end == std::string::npos) break;
        pos = end + 1;
    }
    return false;
}

static std::string queryString(const std::string& query, const std::string& key) {
    size_t pos = 0;
    while (pos <= query.size()) {
        size_t end = query.find('&', pos);
        std::string part = query.substr(pos, end == std::string::npos ? std::string::npos : end - pos);
        size_t eq = part.find('=');
        if (eq != std::string::npos && part.substr(0, eq) == key) {
            return part.substr(eq + 1);
        }
        if (end == std::string::npos) break;
        pos = end + 1;
    }
    return "";
}

static std::string controlsJson(AudioEngine* eng) {
    float mix = eng->display.wetDryBalance.load(std::memory_order_relaxed);
    float wet = 0.0f;
    float dry = 0.0f;
    wetDryFromBalance(mix, wet, dry);

    std::ostringstream out;
    out << "\"mix\":" << mix
        << ",\"wet\":" << wet
        << ",\"dry\":" << dry
        << ",\"gainDb\":" << eng->display.monitorGainDb.load(std::memory_order_relaxed)
        << ",\"gate\":" << eng->display.voicedGateRms.load(std::memory_order_relaxed)
        << ",\"stableWindow\":" << eng->display.stableSemitoneWindow.load(std::memory_order_relaxed);
    return out.str();
}

static std::string jsonString(const std::string& text) {
    std::ostringstream out;
    out << "\"";
    for (char c : text) {
        switch (c) {
        case '\\': out << "\\\\"; break;
        case '"': out << "\\\""; break;
        case '\n': out << "\\n"; break;
        case '\r': out << "\\r"; break;
        case '\t': out << "\\t"; break;
        default:
            if ((unsigned char)c < 0x20) out << "\\u00" << std::hex << (int)(unsigned char)c << std::dec;
            else out << c;
            break;
        }
    }
    out << "\"";
    return out.str();
}

static std::string audioOutputsJson() {
    std::lock_guard<std::mutex> lock(gAudioMutex);
    std::ostringstream out;
    out << "{\"selected\":" << gAudioOutputDevice << ",\"outputs\":[";
    bool first = true;
    for (const auto& device : gAudioOutputDevices) {
        if (!first) out << ",";
        first = false;
        out << "{\"id\":" << device.index << ",\"name\":" << jsonString(device.name) << "}";
    }
    out << "]}";
    return out.str();
}

static std::string audioInputsJson() {
    std::lock_guard<std::mutex> lock(gAudioMutex);
    std::ostringstream out;
    out << "{\"selected\":" << gAudioInputDevice << ",\"inputs\":[";
    bool first = true;
    for (const auto& device : gAudioInputDevices) {
        if (!first) out << ",";
        first = false;
        out << "{\"id\":" << device.index << ",\"name\":" << jsonString(device.name) << "}";
    }
    out << "]}";
    return out.str();
}

static std::string stateJson(AudioEngine* eng) {
    std::string audioError;
    std::string audioInput;
    std::string audioOutput;
    PaDeviceIndex audioInputDevice = paNoDevice;
    PaDeviceIndex audioOutputDevice = paNoDevice;
    {
        std::lock_guard<std::mutex> lock(gAudioMutex);
        audioError = gAudioError;
        audioInput = gAudioInputName;
        audioOutput = gAudioOutputName;
        audioInputDevice = gAudioInputDevice;
        audioOutputDevice = gAudioOutputDevice;
    }

    uint64_t lo = eng->display.noteBitsLo.load(std::memory_order_relaxed);
    uint64_t hi = eng->display.noteBitsHi.load(std::memory_order_relaxed);
    std::ostringstream notes;
    notes << "[";
    bool first = true;
    for (int note = 0; note < 128; note++) {
        bool on = note < 64 ? ((lo >> note) & 1ULL) : ((hi >> (note - 64)) & 1ULL);
        if (!on) continue;
        if (!first) notes << ",";
        first = false;
        notes << note;
    }
    notes << "]";

    std::ostringstream out;
    out << "{"
        << "\"audioReady\":" << (gAudioReady.load(std::memory_order_relaxed) ? "true" : "false")
        << ",\"audioError\":" << jsonString(audioError)
        << ",\"audioInput\":" << jsonString(audioInput)
        << ",\"audioOutput\":" << jsonString(audioOutput)
        << ",\"audioInputDevice\":" << audioInputDevice
        << ",\"audioOutputDevice\":" << audioOutputDevice
        << ",\"inputPeak\":" << eng->display.inputPeak.load(std::memory_order_relaxed)
        << ",\"outputPeak\":" << eng->display.outputPeak.load(std::memory_order_relaxed)
        << ",\"callbackFrames\":" << eng->display.callbackFrames.load(std::memory_order_relaxed)
        << ",\"inputOverflows\":" << eng->display.inputOverflows.load(std::memory_order_relaxed)
        << ",\"outputUnderflows\":" << eng->display.outputUnderflows.load(std::memory_order_relaxed)
        << ",\"testTone\":"
        << (eng->sampleClock.load(std::memory_order_relaxed) <
            eng->testToneEndClock.load(std::memory_order_relaxed) ? "true" : "false")
        << ",\"dspBackend\":\"rubberband-formant-preserved\""
        << ",\"dspLatencyMs\":" << eng->dspLatencyMs()
        << ",\"midiReady\":" << (gMidiReady.load(std::memory_order_relaxed) ? "true" : "false")
        << ",\"midiError\":" << jsonString(gMidiError)
        << ",\"detectedMidi\":" << eng->display.detectedMidi.load(std::memory_order_relaxed)
        << ",\"rawMidi\":" << eng->display.rawMidi.load(std::memory_order_relaxed)
        << ",\"correctionMidi\":" << eng->display.correctionMidi.load(std::memory_order_relaxed)
        << ",\"pitchStable\":" << (eng->display.pitchStable.load(std::memory_order_relaxed) ? "true" : "false")
        << ",\"pitchVoiced\":" << (eng->display.pitchVoiced.load(std::memory_order_relaxed) ? "true" : "false")
        << ",\"pitchRms\":" << eng->display.pitchRms.load(std::memory_order_relaxed)
        << ",\"capturing\":" << (eng->capture.active.load(std::memory_order_relaxed) ? "true" : "false")
        << ",\"captureSeconds\":" << (double)eng->capture.audioLen.load(std::memory_order_relaxed) / kSampleRate
        << ",\"notes\":" << notes.str()
        << "," << controlsJson(eng)
        << "}";
    return out.str();
}

static void applyControls(AudioEngine* eng, const std::string& query) {
    float v = 0.0f;
    if (queryFloat(query, "mix", v) || queryFloat(query, "blend", v)) {
        eng->display.wetDryBalance.store(clampf(v, 0.0f, 1.0f), std::memory_order_relaxed);
    } else {
        float currentMix = eng->display.wetDryBalance.load(std::memory_order_relaxed);
        float wet = currentMix;
        float dry = 1.0f - currentMix;
        bool hasWet = queryFloat(query, "wet", wet);
        bool hasDry = queryFloat(query, "dry", dry);
        if (hasWet || hasDry) {
            wet = clampf(wet, 0.0f, 1.5f);
            dry = clampf(dry, 0.0f, 1.5f);
            float total = wet + dry;
            eng->display.wetDryBalance.store(total > 0.0001f ? wet / total : 0.0f,
                                             std::memory_order_relaxed);
        }
    }
    if (queryFloat(query, "gate", v))
        eng->display.voicedGateRms.store(clampf(v, 0.0001f, 0.0300f), std::memory_order_relaxed);
    if (queryFloat(query, "gain", v) || queryFloat(query, "gainDb", v))
        eng->display.monitorGainDb.store(clampf(v, 0.0f, 30.0f), std::memory_order_relaxed);
    if (queryFloat(query, "stable", v))
        eng->display.stableSemitoneWindow.store(clampf(v, 0.2f, 2.0f), std::memory_order_relaxed);
}

static void startTestTone(AudioEngine* eng) {
    uint64_t start = eng->sampleClock.load(std::memory_order_relaxed);
    eng->testToneStartClock.store(start, std::memory_order_relaxed);
    eng->testToneEndClock.store(start + kSampleRate, std::memory_order_relaxed);
}

static void applyBrowserMidi(AudioEngine* eng, const std::string& query) {
    std::string event = queryString(query, "event");
    float value = 0.0f;

    if (event == "on" && queryFloat(query, "note", value)) {
        handleNoteOn(eng, (int)value);
    } else if (event == "off" && queryFloat(query, "note", value)) {
        handleNoteOff(eng, (int)value);
    } else if (event == "cc") {
        float cc = 0.0f;
        if (queryFloat(query, "cc", cc) && queryFloat(query, "value", value) && (int)cc == 64) {
            eng->sustainOn = value >= 64.0f;
            if (!eng->sustainOn) handleSustainOff(eng);
        }
    } else if (event == "bend" && queryFloat(query, "semitones", value)) {
        eng->pitchBend.store(clampf(value, -kBendRange, kBendRange), std::memory_order_relaxed);
    }
}

static void applyBrowserMidiStatus(const std::string& query) {
    float ready = 0.0f;
    if (queryFloat(query, "ready", ready)) {
        gMidiReady.store(ready > 0.5f, std::memory_order_relaxed);
    }
    gMidiError = queryString(query, "error");
}

// ── Diagnostic capture control ─────────────────────────────────────────────

static bool writeWavFloat(const std::string& path, const float* left,
                          const float* right, size_t frames)
{
    std::ofstream out(path, std::ios::binary);
    if (!out) return false;
    const uint16_t channels   = right ? 2 : 1;
    const uint32_t dataBytes  = (uint32_t)(frames * channels * sizeof(float));
    const uint32_t byteRate   = kSampleRate * channels * (uint32_t)sizeof(float);
    const uint16_t blockAlign = channels * (uint16_t)sizeof(float);

    auto u16 = [&](uint16_t v) { out.write((const char*)&v, 2); };
    auto u32 = [&](uint32_t v) { out.write((const char*)&v, 4); };

    out.write("RIFF", 4); u32(36 + dataBytes); out.write("WAVE", 4);
    out.write("fmt ", 4); u32(16);
    u16(3);   // IEEE float
    u16(channels);
    u32(kSampleRate);
    u32(byteRate);
    u16(blockAlign);
    u16(32);
    out.write("data", 4); u32(dataBytes);
    for (size_t i = 0; i < frames; i++) {
        out.write((const char*)&left[i], sizeof(float));
        if (right) out.write((const char*)&right[i], sizeof(float));
    }
    return out.good();
}

static void captureStart(AudioEngine* eng) {
    Capture& c = eng->capture;
    std::lock_guard<std::mutex> lock(c.controlMutex);
    if (c.active.load(std::memory_order_relaxed)) return;

    const size_t maxSamples = (size_t)Capture::kMaxSeconds * kSampleRate;
    c.mic.assign(maxSamples, 0.0f);
    c.outL.assign(maxSamples, 0.0f);
    c.outR.assign(maxSamples, 0.0f);
    c.frames.assign(maxSamples / kPitchHopSize + 16, Capture::FrameRow{});
    c.midi.assign(4096, Capture::MidiRow{});
    c.audioLen.store(0, std::memory_order_relaxed);
    c.frameLen.store(0, std::memory_order_relaxed);
    c.midiLen.store(0, std::memory_order_relaxed);
    c.startClock = eng->sampleClock.load(std::memory_order_relaxed);
    c.active.store(true, std::memory_order_release);
}

// Returns the capture directory, or "" if nothing was captured.
static std::string captureStop(AudioEngine* eng) {
    Capture& c = eng->capture;
    std::lock_guard<std::mutex> lock(c.controlMutex);
    if (!c.active.load(std::memory_order_relaxed)) return "";
    c.active.store(false);
    // Let in-flight audio-callback appends finish before serializing.
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    char stamp[32];
    std::time_t now = std::time(nullptr);
    std::strftime(stamp, sizeof(stamp), "%Y%m%d_%H%M%S", std::localtime(&now));
    std::string dir = std::string("captures/cap_") + stamp;
    std::error_code directoryError;
    std::filesystem::create_directories(dir, directoryError);
    if (directoryError) return "";

    size_t nAudio  = c.audioLen.load(std::memory_order_acquire);
    size_t nFrames = c.frameLen.load(std::memory_order_acquire);
    size_t nMidi   = c.midiLen.load(std::memory_order_acquire);

    writeWavFloat(dir + "/mic.wav", c.mic.data(), nullptr, nAudio);
    writeWavFloat(dir + "/output.wav", c.outL.data(), c.outR.data(), nAudio);

    auto relTime = [&](uint64_t sample) {
        return sample >= c.startClock ? (double)(sample - c.startClock) / kSampleRate : 0.0;
    };
    {
        std::ofstream f(dir + "/frames.csv");
        f << std::fixed << std::setprecision(6)
          << "time,rms,raw_hz,folded_hz,median_hz,smoothed_midi,correction_midi,stable,voiced\n";
        for (size_t i = 0; i < nFrames; i++) {
            const Capture::FrameRow& r = c.frames[i];
            f << relTime(r.sample) << ',' << r.rms << ',' << r.rawHz << ','
              << r.foldedHz << ',' << r.medianHz << ',' << r.smoothedMidi << ','
              << r.correctionMidi << ',' << (int)r.stable << ',' << (int)r.voiced << '\n';
        }
    }
    {
        std::ofstream f(dir + "/midi.csv");
        f << std::fixed << std::setprecision(6) << "time,event,note\n";
        for (size_t i = 0; i < nMidi; i++) {
            const Capture::MidiRow& r = c.midi[i];
            f << relTime(r.sample) << ',' << (r.on ? "on" : "off") << ','
              << (int)r.note << '\n';
        }
    }
    {
        std::ofstream f(dir + "/meta.json");
        f << "{\"sampleRate\":" << kSampleRate
          << ",\"seconds\":" << std::fixed << std::setprecision(3)
          << (double)nAudio / kSampleRate
          << ",\"audioInput\":" << jsonString(gAudioInputName)
          << ",\"audioOutput\":" << jsonString(gAudioOutputName)
          << "," << controlsJson(eng) << "}\n";
    }

    // Release the ~60 MB of capture buffers.
    c.mic.clear();    c.mic.shrink_to_fit();
    c.outL.clear();   c.outL.shrink_to_fit();
    c.outR.clear();   c.outR.shrink_to_fit();
    c.frames.clear(); c.frames.shrink_to_fit();
    c.midi.clear();   c.midi.shrink_to_fit();
    return dir;
}

static std::string captureStatusJson(AudioEngine* eng, const std::string& dir = "") {
    std::ostringstream out;
    out << "{\"capturing\":" << (eng->capture.active.load(std::memory_order_relaxed) ? "true" : "false")
        << ",\"seconds\":" << std::fixed << std::setprecision(1)
        << (double)eng->capture.audioLen.load(std::memory_order_relaxed) / kSampleRate;
    if (!dir.empty()) out << ",\"dir\":" << jsonString(dir);
    out << "}\n";
    return out.str();
}

class HttpServer {
public:
    HttpServer(AudioEngine* engine, int port) : engine_(engine), port_(port) {}

    bool start() {
        if (!initializeSockets()) {
            std::cerr << "HTTP socket initialization failed: " << socketErrorText() << "\n";
            return false;
        }
        socketsInitialized_ = true;
        serverFd_ = ::socket(AF_INET, SOCK_STREAM, 0);
        if (serverFd_ == kInvalidSocket) {
            std::cerr << "HTTP socket failed: " << socketErrorText() << "\n";
            shutdownSockets();
            socketsInitialized_ = false;
            return false;
        }

        int yes = 1;
#if defined(_WIN32)
        setsockopt(serverFd_, SOL_SOCKET, SO_REUSEADDR,
                   reinterpret_cast<const char*>(&yes), sizeof(yes));
#else
        setsockopt(serverFd_, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
#endif

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons((uint16_t)port_);
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

        if (::bind(serverFd_, (sockaddr*)&addr, sizeof(addr)) < 0) {
            std::cerr << "HTTP bind failed: " << socketErrorText() << "\n";
            closeSocket(serverFd_);
            serverFd_ = kInvalidSocket;
            shutdownSockets();
            socketsInitialized_ = false;
            return false;
        }
        if (::listen(serverFd_, 16) < 0) {
            std::cerr << "HTTP listen failed: " << socketErrorText() << "\n";
            closeSocket(serverFd_);
            serverFd_ = kInvalidSocket;
            shutdownSockets();
            socketsInitialized_ = false;
            return false;
        }

        running_.store(true);
        thread_ = std::thread([this] { acceptLoop(); });
        return true;
    }

    void stop() {
        running_.store(false);
        if (serverFd_ != kInvalidSocket) {
            shutdownSocket(serverFd_);
            closeSocket(serverFd_);
            serverFd_ = kInvalidSocket;
        }
        if (thread_.joinable()) thread_.join();
        for (int attempt = 0; attempt < 100 && activeClients_.load() > 0; attempt++) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        if (socketsInitialized_) {
            shutdownSockets();
            socketsInitialized_ = false;
        }
    }

private:
    AudioEngine* engine_ = nullptr;
    int port_ = kDefaultWebPort;
    SocketHandle serverFd_ = kInvalidSocket;
    bool socketsInitialized_ = false;
    std::atomic<bool> running_{false};
    std::atomic<int> activeClients_{0};
    std::thread thread_;

    void acceptLoop() {
        while (running_.load()) {
            SocketHandle client = ::accept(serverFd_, nullptr, nullptr);
            if (client == kInvalidSocket) {
                if (running_.load()) std::this_thread::sleep_for(std::chrono::milliseconds(20));
                continue;
            }
            activeClients_.fetch_add(1);
            std::thread([this, client] {
                handleClient(client);
                activeClients_.fetch_sub(1);
            }).detach();
        }
    }

    void handleEvents(SocketHandle client) {
        std::string header =
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/event-stream\r\n"
            "Cache-Control: no-cache\r\n"
            "Connection: close\r\n\r\n";
        if (!sendAll(client, header)) return;

        while (gRunning.load() && running_.load()) {
            std::string event = "event: state\ndata: " + stateJson(engine_) + "\n\n";
            if (!sendAll(client, event)) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    }

    void handleClient(SocketHandle client) {
        char buffer[8192] = {};
        const int n = ::recv(client, buffer, static_cast<int>(sizeof(buffer) - 1), 0);
        if (n <= 0) { closeSocket(client); return; }

        std::istringstream req(std::string(buffer, (size_t)n));
        std::string method, target, version;
        req >> method >> target >> version;
        if (method != "GET") {
            sendAll(client, response("405 Method Not Allowed", "text/plain", "GET only\n"));
            closeSocket(client);
            return;
        }

        size_t q = target.find('?');
        std::string path = target.substr(0, q);
        std::string query = (q == std::string::npos) ? "" : target.substr(q + 1);

        if (path == "/events") {
            handleEvents(client);
            closeSocket(client);
            return;
        }

        if (path == "/" || path == "/index.html") {
            std::string html = readTextFile(kWebIndexPath);
            if (html.empty()) html = "<!doctype html><title>Harmonizer</title><p>Missing web/index.html</p>";
            sendAll(client, response("200 OK", "text/html; charset=utf-8", html));
        } else if (path == "/health") {
            std::string audioError;
            {
                std::lock_guard<std::mutex> lock(gAudioMutex);
                audioError = gAudioError;
            }
            sendAll(client, response("200 OK", "application/json",
                std::string("{\"ok\":true,\"audioReady\":") +
                (gAudioReady.load(std::memory_order_relaxed) ? "true" : "false") +
                ",\"audioError\":" + jsonString(audioError) +
                ",\"midiReady\":" + (gMidiReady.load(std::memory_order_relaxed) ? "true" : "false") +
                ",\"midiError\":" + jsonString(gMidiError) + "}\n"));
        } else if (path == "/api/state") {
            sendAll(client, response("200 OK", "application/json", stateJson(engine_) + "\n"));
        } else if (path == "/api/audio-inputs") {
            sendAll(client, response("200 OK", "application/json", audioInputsJson() + "\n"));
        } else if (path == "/api/audio-input") {
            float device = -1.0f;
            if (!queryFloat(query, "device", device)) {
                sendAll(client, response("400 Bad Request", "application/json",
                                         "{\"error\":\"missing-device\"}\n"));
            } else {
                PaDeviceIndex outputDevice = paNoDevice;
                {
                    std::lock_guard<std::mutex> lock(gAudioMutex);
                    outputDevice = gAudioOutputDevice;
                }
                openAudioRoute(engine_, (PaDeviceIndex)std::lround(device), outputDevice);
                sendAll(client, response("200 OK", "application/json", stateJson(engine_) + "\n"));
            }
        } else if (path == "/api/audio-outputs") {
            sendAll(client, response("200 OK", "application/json", audioOutputsJson() + "\n"));
        } else if (path == "/api/audio-output") {
            float device = -1.0f;
            if (!queryFloat(query, "device", device)) {
                sendAll(client, response("400 Bad Request", "application/json",
                                         "{\"error\":\"missing-device\"}\n"));
            } else {
                PaDeviceIndex inputDevice = paNoDevice;
                {
                    std::lock_guard<std::mutex> lock(gAudioMutex);
                    inputDevice = gAudioInputDevice;
                }
                openAudioRoute(engine_, inputDevice, (PaDeviceIndex)std::lround(device));
                sendAll(client, response("200 OK", "application/json", stateJson(engine_) + "\n"));
            }
        } else if (path == "/api/test-tone") {
            startTestTone(engine_);
            sendAll(client, response("200 OK", "application/json", stateJson(engine_) + "\n"));
        } else if (path == "/api/control") {
            applyControls(engine_, query);
            sendAll(client, response("200 OK", "application/json", stateJson(engine_) + "\n"));
        } else if (path == "/api/midi") {
            applyBrowserMidi(engine_, query);
            sendAll(client, response("200 OK", "application/json", stateJson(engine_) + "\n"));
        } else if (path == "/api/midi-status") {
            applyBrowserMidiStatus(query);
            sendAll(client, response("200 OK", "application/json", stateJson(engine_) + "\n"));
        } else if (path == "/api/capture") {
            std::string action = queryString(query, "action");
            if (action == "start") {
                captureStart(engine_);
                sendAll(client, response("200 OK", "application/json", captureStatusJson(engine_)));
            } else if (action == "stop") {
                std::string dir = captureStop(engine_);
                sendAll(client, response("200 OK", "application/json", captureStatusJson(engine_, dir)));
            } else {
                sendAll(client, response("200 OK", "application/json", captureStatusJson(engine_)));
            }
        } else {
            sendAll(client, response("404 Not Found", "text/plain", "not found\n"));
        }
        closeSocket(client);
    }
};

// ── Offline render (replay a capture through the exact engine) ─────────────

static bool readWavFloatMono(const std::string& path, std::vector<float>& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    std::ostringstream buf;
    buf << in.rdbuf();
    std::string bytes = buf.str();
    size_t pos = bytes.find("data");
    if (pos == std::string::npos || pos + 8 > bytes.size()) return false;
    // Capture WAVs are written by writeWavFloat: mono float32.
    const float* samples = (const float*)(bytes.data() + pos + 8);
    size_t n = (bytes.size() - pos - 8) / sizeof(float);
    out.assign(samples, samples + n);
    return true;
}

static int runRender(const std::string& capDir) {
    std::vector<float> mic;
    if (!readWavFloatMono(capDir + "/mic.wav", mic)) {
        std::cerr << "render: cannot read " << capDir << "/mic.wav\n";
        return 1;
    }

    struct Event { size_t sample; bool on; int note; };
    std::vector<Event> events;
    {
        std::ifstream f(capDir + "/midi.csv");
        std::string line;
        std::getline(f, line);   // header
        while (std::getline(f, line)) {
            std::istringstream row(line);
            std::string t, ev, note;
            if (!std::getline(row, t, ',') || !std::getline(row, ev, ',') ||
                !std::getline(row, note, ',')) continue;
            events.push_back({ (size_t)(std::strtod(t.c_str(), nullptr) * kSampleRate),
                               ev == "on", std::atoi(note.c_str()) });
        }
    }

    auto* eng = new AudioEngine();
    eng->init();

    // Restore the controls the capture was made with.
    {
        std::string meta = readTextFile((capDir + "/meta.json").c_str());
        auto metaFloat = [&](const char* key, float fallback) {
            size_t p = meta.find(std::string("\"") + key + "\":");
            return p == std::string::npos
                ? fallback
                : std::strtof(meta.c_str() + p + std::strlen(key) + 3, nullptr);
        };
        eng->display.wetDryBalance.store(metaFloat("mix", kDefaultWetDryBalance));
        eng->display.monitorGainDb.store(metaFloat("gainDb", kDefaultMonitorGainDb));
        eng->display.voicedGateRms.store(metaFloat("gate", kDefaultVoicedGateRms));
        eng->display.stableSemitoneWindow.store(metaFloat("stableWindow", kDefaultStableSemitoneWindow));
    }

    std::vector<float> outL(mic.size()), outR(mic.size());
    size_t ev = 0;
    for (size_t n = 0; n < mic.size(); n++) {
        while (ev < events.size() && events[ev].sample <= n) {
            if (events[ev].on) handleNoteOn(eng, events[ev].note);
            else               handleNoteOff(eng, events[ev].note);
            ev++;
        }
        processSample(eng, mic[n], outL[n], outR[n]);
    }

    std::string outPath = capDir + "/render.wav";
    bool ok = writeWavFloat(outPath, outL.data(), outR.data(), mic.size());
    std::cerr << "render: " << (ok ? "wrote " : "FAILED writing ") << outPath
              << " (" << (double)mic.size() / kSampleRate << " s, "
              << events.size() << " midi events)\n";
    delete eng;
    return ok ? 0 : 1;
}

// ── Signal ─────────────────────────────────────────────────────────────────

static void onSignal(int) { gRunning.store(false); }

// ── Main ───────────────────────────────────────────────────────────────────

int main(int argc, char** argv) {
    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);
#if !defined(_WIN32)
    std::signal(SIGPIPE, SIG_IGN);
#endif

    int webPort = kDefaultWebPort;
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--port" && i + 1 < argc) {
            webPort = std::atoi(argv[++i]);
        } else if (arg == "--render" && i + 1 < argc) {
            // Offline: replay captures/cap_<stamp>/ through the engine,
            // write render.wav next to it. No audio device, no server.
            return runRender(argv[++i]);
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "usage: " << argv[0] << " [--port 8794] [--render <capture-dir>]\n";
            return 0;
        }
    }

    auto* engine = new AudioEngine();
    engine->init();
    initializeAudio(engine);

    gMidiError = "browser-midi-pending";

    HttpServer server(engine, webPort);
    if (!server.start()) {
        std::cerr << "HTTP server failed on 127.0.0.1:" << webPort << "\n";
        shutdownAudio();
        delete engine;
        return 1;
    }

    std::cerr << "\n"
        "=============================================\n"
        "  Harmonizer Web (Rubber Band, formant preserved)\n"
        "  http://127.0.0.1:" << webPort << "/\n"
        "  Sing into mic + use Web MIDI in the browser\n"
        "  Browser controls: blend | gate | stability\n"
        "  Ctrl+C to quit\n"
        "=============================================\n\n";

    while (gRunning.load()) Pa_Sleep(50);

    server.stop();
    shutdownAudio();
    delete engine;
    return 0;
}
