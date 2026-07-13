# Harmonizer Backend Lab

This lab keeps each tested audio engine in a separate executable so their
library implementations cannot interfere with one another. The browser GUI
switches between them on one URL and only one executable runs at a time.

## Included backends

| Backend | Engine | Formants | Purpose |
|---|---|---|---|
| `current` | Rubber Band LiveShifter | Preserved | Production build on port 8794 |
| `live_reference` | Frozen copy of the current engine | Preserved | Detect accidental drift from the control |
| `live128` | Isolated LiveShifter fork with a 128-sample API block | Preserved | Test whether the fixed 512-sample quantum is necessary |
| `rubberband_r2` | Rubber Band Stretcher R2, short window | Preserved | Lowest-latency Rubber Band comparison |
| `signalsmith` | Signalsmith Stretch, 1024/128 configuration | Compensated | Independent spectral-shifter comparison |

Build all comparison binaries:

```bash
./scripts/build_backend_lab.sh
```

Start the normal development server, then use the **Pitch shifter** menu at
`http://127.0.0.1:8794/`:

```bash
./scripts/run_harmonizer_web.sh
```

The standalone commands are still useful for isolated debugging:

```bash
./scripts/run_backend_lab.sh live        # http://127.0.0.1:8795/
./scripts/run_backend_lab.sh live128     # http://127.0.0.1:8798/
./scripts/run_backend_lab.sh r2          # http://127.0.0.1:8796/
./scripts/run_backend_lab.sh signalsmith # http://127.0.0.1:8797/
```

Stop a standalone backend with Ctrl-C. It is not needed for ordinary GUI
comparison.

Run the repeatable five-interval benchmark:

```bash
./scripts/benchmark_backends.sh
```

Each run writes `summary.csv`, diagnostic pitch CSVs, and listenable render WAVs
under `backend_lab/results/<timestamp>/`. Reported latency is the native DSP
path estimate; a physical cable loopback is still required for complete
mic-to-headphone latency.

Render an existing diagnostic capture through each non-duplicate engine:

```bash
./scripts/render_capture_backends.sh captures/cap_20260703_141330
```

The resulting wet-only WAVs land under
`backend_lab/capture_results/<capture>_<timestamp>/`.

## Candidates not integrated

- **Bungee Basic 2.4.24:** a local streaming probe measured about 4,864 samples
  (110 ms) in its lower-latency grain mode, so it did not meet this lab's goal.
- **SoundTouch:** its official documentation permits approximately 100 ms of
  stream latency and it does not provide the vocal formant handling sought here.
- **maxrmorrison/psola:** useful GPL TD-PSOLA reference, but its public package is
  an offline Python/Praat workflow rather than a real-time C++ streaming engine.

Signalsmith Stretch is pinned to commit
`57b93f4e9206a089a45387eaa39bdc9f310d3308`; Signalsmith Linear is pinned to
`0.3.1`. Both archives are checksum-verified by `fetch_signalsmith.sh`.

The `live128` target copies the pinned Rubber Band 4.0.0 source inside the CMake
build directory and changes only `R3LiveShifter::getBlockSize()` from 512 to
128. It never patches the production dependency tree.
