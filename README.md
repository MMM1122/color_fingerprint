# Color Fingerprint

A browser-only site that measures your sound-to-color associations, then visualizes music through your
personal mapping. Built from the Color Fingerprint AI Build Spec (Oct 29, 2026). No backend, no accounts,
no audio, video or answers leave the device.

**What's in it**

- **Phase 1:** landing, setup and safety, a 60-trial calibration (piano, pure tone, bowed strings and a sung
  "ah" × 5 notes × 3 repeats), results story, immersive visualizer with built-in tracks and file upload,
  local save and JSON export/import.
- **Phase 2:** microphone input, camera view, the voice "ah" timbre, retest flow with a comparison to last
  time, a share card PNG (palette and title only), a calendar reminder for the retest, and iOS audio
  unlock on first tap.
- **Visual styles:** *Fireworks* (default): each note bursts into sharp sparks at its height, in your color
  for that note. *Soft glow*: the slow, blurred "mind's eye" field. Reduced motion always uses soft glow.
- **Phase 3 (partly):** a short scripted conversational guide on the results page. **Not built:** anonymous
  data collection and "you vs. everyone", which the spec gates on ethics approval (REB/IRB) and consent
  text, and the YAMNet classifier (large dependency, not approved).

## Run it

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (Vitest): color math, scoring, patterns, mapping, audio, safety
npm run e2e        # end-to-end (Playwright): full flow incl. reload-and-resume and immersive mode
npm run build      # typecheck + static build in dist/ (deploy to any static host)
```

Add `?fps` to the URL to show a frame-rate readout in immersive mode.

## Where things live

```
src/config/stimuli.ts       every tunable: stimuli, repetitions, thresholds, timbre temperature, safety limits
src/audio/synth.ts          placeholder synthesis of the three timbres (pure JS, runs in Node for tests)
src/audio/loudness.ts       ITU-R BS.1770 K-weighted loudness normalization
src/audio/features.ts       Meyda + Pitchy per-frame features
src/audio/timbreMatch.ts    reference vectors, distances, softmax weights, smoothing
src/audio/pipeline.ts       stimulus rendering, references, LiveMapper (frame → color)
src/audio/engine.ts         Web Audio via Tone.js: sound gate, volume, playback, analyser
src/audio/tracks.ts         procedurally generated demo tracks (rendered in a Web Worker)
src/science/retest.ts       session comparison, retest timing, .ics reminder
src/science/color.ts        culori conversions, CIELUV (D65), ΔE, OKLab means, hue math
src/science/trials.ts       randomized order, no back-to-back repeats
src/science/scoring.ts      consistency, Eagleman-style score, Spearman, patterns, fingerprint
src/mapping/personalMap.ts  anchors → color for any pitch/timbre blend; smoothing
src/mapping/defaultMap.ts   "a generic mapping" for the comparison toggle
src/visuals/safety.ts       flash limiter + independent WCAG flash counter
src/visuals/particles.ts    CPU sim: fireworks sparks + soft glows, luminance model (testable headlessly)
src/visuals/scene.ts        Three.js instanced glows, spark streaks, camera layer, one bloom pass
src/visuals/shareCard.ts    share card PNG (palette + title)
src/screens/                Landing, Setup, Calibration, ColorPicker, Results, Guide, Immersive, Share, Info
src/storage/local.ts        localStorage wrapper (try/catch, in-memory fallback), schema migration, JSON export/import
```

## Decisions and departures to review

These are places where the build departs from, or fills a gap in, the spec. Each is isolated so it is easy to change.

1. **Consistency score scale (verified).** Rothen et al. (2013)'s CIELUV cutoff of 135 and Eagleman et al.
   (2007)'s RGB cutoff of 1.0 both *sum* the three pairwise distances per item, then average over items.
   The spec's score is the *mean* pairwise distance, a third of that. The app keeps the spec's mean as the
   primary score and also reports the summed version next to the 135 reference. On the mean scale the
   reference point is 45. Eagleman's score also uses city-block (not Euclidean) RGB distance; the app follows that.
2. **CIELUV white point.** culori's built-in `luv` mode is adapted to D50. The app converts through
   culori's D65 XYZ instead, which matches sRGB and published reference values (unit-tested).
3. **Timbre references are per pitch.** The spec stores one reference vector per timbre. MFCCs shift
   strongly with pitch, so a single averaged vector gave near-uniform weights (low piano read as sine).
   The app keeps one reference per calibration sample and interpolates it to the live pitch.
4. **Extra timbre feature: envelope slope (dB/s).** Overlapping piano notes in real music looked "rich" and
   were labelled strings. Decay vs. sustain survives overlapping notes. With it, the piano demo track is
   labelled "closest to piano" about 62% of frames (was 33%). Instrument matching in mixes is still an
   approximation, as the spec says.
5. **Placeholder sounds.** Instrument samples are an open decision, so piano and strings are synthesized
   in code (no license issues). Swap in real samples via `SAMPLE_FILES` in `config/stimuli.ts`. The demo
   tracks are also generated in code.
6. **Picker start color.** Each trial starts at a random hue (L 0.65, C 0.10) so no hue is favored and
   nothing carries over. The user must touch the picker or choose "No color comes to mind".
7. **Consistency bands.** "Very close" is below the research reference (45 on our scale). The "fairly
   close" upper limit (90) is a design choice with a TODO in config.
8. **Analysis hop.** The AnalyserNode is read once per animation frame (about 735 samples at 44.1 kHz and
   60 fps) rather than an exact 512-sample hop. An AudioWorklet could give the exact hop if needed.
9. **Fireworks style.** The spec describes the associator as "soft, blurred". At the owner's request the
   default is now fireworks; soft glow is still available and is forced on with reduced motion
   ("blur instead of bursts"). Bursts are capped at 4 per second.
10. **Retest scoring.** The fingerprint's consistency and patterns describe the latest visit; the personal
    map uses every visit's answers. "Moved very little / somewhat / a lot" between visits reuses the
    consistency bands, a design choice.
11. **Camera view.** The camera is drawn dimmed (30%) behind the shapes. Real-world light in the camera
    image is not limited by the flash limiter, which only governs light the site generates.
12. **Visual style.** Achromatic neutral grays everywhere, so the only colors on screen are the user's;
   calibration sits on a mid-gray surround (standard for color matching). System fonts only, to avoid adding
   a dependency. Colors, type and radii are tokens at the top of `src/styles.css`.

## Safety model (spec section 6)

- **Sound gate:** the engine throws if anything tries to play before the setup checkboxes are ticked.
- **Mic and camera:** requested only when picked, stopped (tracks ended) when you switch away or leave,
  including if you switch away while the permission prompt is still open. The mic never plays through
  the speakers. Nothing is recorded or uploaded.
- **Flashes (fireworks):** at most 4 bursts per second; each burst covers a small part of the screen;
  sparks fade over ≥ 0.9 s. All light still passes through the limiter below.
- **Flashes (soft glow):** particles fade in over ≥ 0.35 s (0.9 s with reduced motion) and out over ≥ 1.6 s, and spawns
  are capped at 8/s (3/s reduced). On top of that, a limiter caps how fast scene luminance can rise and stops
  any upward swing that would exceed 3 WCAG flashes in a second. A second limiter channel tracks saturated red.
  Tested with the spec's 10-clicks-per-second track, plus an adversarial 10 Hz on/off input.
- **Limitation:** the limiter works on a model of scene luminance computed from the particle state, not on
  rendered pixels. A pixel-level check (e.g. `readPixels` sampled during the e2e run) would be a good Phase 1.5 addition.
