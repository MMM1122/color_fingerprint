# Phase 1 acceptance checklist

Checked Oct 29, 2026 in a cloud Linux container (headless Chromium, software WebGL).
✅ = verified by an automated test or audit · ⚠️ = needs a check on real hardware or browsers.

| # | Criterion (spec section 7) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Setup screen blocks all sound until headphones/volume and the photosensitivity notice are confirmed | ✅ | The audio engine throws if anything plays before the gate opens. The e2e test checks the test-tone and Start buttons are disabled until both boxes are ticked, and Start also needs one test tone. |
| 2 | 45 trials in a valid random order (no back-to-back repeats); pause and resume after a page reload | ✅ | Unit: 1,000 generated orders, none back to back; each stimulus appears exactly 3 times. E2E: answers 5 trials, reloads, resumes at "Sound 6 of 45", and checks no back-to-back repeat across the remaining 40. In-session Pause/Resume is also present. |
| 3 | Every answer saved with hex, CIELUV, OKLCH, reaction time and replays | ✅ | E2E reads the saved fingerprint from localStorage and checks all 45 answers have each field. |
| 4 | Scoring matches hand-calculated fixtures to 2 decimal places | ✅ | `tests/fixtures/consistency-hand-calculation.csv` (3 stimuli × 3 answers): per-stimulus 3.33 / 0.00 / 20.00, overall 7.78. |
| 5 | Results show palette, consistency band and only the patterns the data supports | ✅ | Unit: rising-lightness fixture gives ρ ≥ 0.5, shuffled does not; gray answers give no timbre pattern; flat answers give "no clear pattern". E2E: scripted answers show the three supported patterns and not "no clear pattern". |
| 6 | Immersive mode ≥ 55 fps on a 2020-era laptop in Chrome, Firefox and Safari | ⚠️ | Can't be measured here: the container renders WebGL in software (2–20 fps). Open with `?fps` on a real laptop in each browser. The design is light (≤ 320 instanced quads, one bloom pass at reduced resolution, pixel ratio capped at 1.5). |
| 7 | A pure A4 sine shows the user's sine color at A4 (within ΔE 5 after smoothing) | ✅ | Unit test runs a 440 Hz sine through the full feature → timbre-weight → personal-map → smoothing pipeline: ΔE ≈ 2.7 (CIELUV) with ~97% sine weight. This tests the pipeline code, not the browser's audio path. |
| 8 | Flash limiter test passes | ✅ | Spec's 10 clicks/s track through features + particles + limiter: ≤ 3 flashes/s (normal and reduced motion). Also an adversarial 10 Hz on/off input, ≤ 3/s. Flashes are counted by a separate WCAG counter. The limit is enforced on a luminance model, not on rendered pixels (see README). |
| 9 | Lighthouse accessibility ≥ 90 | ✅ | Lighthouse 12 on the landing page: accessibility 100, best practices 100. axe-core (WCAG 2.1 AA + best practice) on landing, setup, calibration, paused, all four results cards, immersive warning and immersive: 0 violations. |

## Also verified

- Stimuli are loudness-normalized to −23 LUFS (BS.1770 K-weighting): unit test checks all 15.
- Pitch detection: 220/440/880 Hz → A3/A4/A5.
- Timbre matching: each calibration sound, played back, gets its own timbre as top weight (all 15).
- Hue interpolation takes the short way (350° → 10° passes through 0°).
- CIELUV (D65) matches published reference values for red, green, blue, white and black.

## Still to check by hand

- Frame rate in Chrome, Firefox and Safari on a mid-range laptop (`?fps`).
- How the synthesized piano and strings sound on headphones, before choosing real samples.
- Five-person think-aloud test (spec section 8).
