# Acceptance checklist

Checked Oct 29, 2026 in a cloud Linux container (headless Chromium, software WebGL, fake mic and camera).
✅ = verified by an automated test or audit · ⚠️ = needs a check on real hardware or browsers · ⛔ = not built, by design.

Test totals: 39 unit tests (Vitest), 3 end-to-end tests (Playwright), Lighthouse accessibility 100 and
best practices 100, axe-core (WCAG 2.1 AA + best practice) with 0 violations on every screen.

## Phase 1

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Setup blocks all sound until headphones/volume and the photosensitivity notice are confirmed | ✅ | The audio engine refuses to play before the gate opens. E2E checks the buttons stay disabled until both boxes are ticked and a test tone has played. |
| 2 | Trials in a valid random order (no back-to-back repeats); pause and resume after a reload | ✅ | Unit: 1,000 orders, none back to back. E2E: answers 5 of 60, reloads, resumes at "Sound 6 of 60", and checks there are no back-to-back repeats. |
| 3 | Every answer saved with hex, CIELUV, OKLCH, reaction time and replays | ✅ | E2E reads all 60 saved answers. |
| 4 | Scoring matches hand-calculated fixtures to 2 decimals | ✅ | `tests/fixtures/consistency-hand-calculation.csv`: 3.33 / 0.00 / 20.00, overall 7.78. |
| 5 | Results show palette, band and only supported patterns | ✅ | Unit fixtures (rising, shuffled, gray, flat) and E2E. |
| 6 | Immersive ≥ 55 fps on a 2020-era laptop in Chrome, Firefox, Safari | ⚠️ | Not measurable here (software WebGL). Open with `?fps` on a real laptop. Fireworks draw ≤ 1,600 spark quads + ≤ 320 glows. |
| 7 | Pure A4 sine shows the user's sine color at A4 (ΔE < 5) | ✅ | Unit, full pipeline: ΔE ≈ 2.7. |
| 8 | Flash limiter test passes | ✅ | 10 clicks/s through features → particles → limiter: ≤ 3 flashes/s for fireworks, soft glow and reduced motion. Adversarial 10 Hz input also ≤ 3/s. |
| 9 | Lighthouse accessibility ≥ 90 | ✅ | 100. |

## Phase 2

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Mic and camera ask for permission only when the user picks that mode, and stop when they leave it | ✅ | E2E wraps `getUserMedia`: no calls until picked; the mic track ends when switching to a track; the camera track ends when switching view, when switching off mid-startup, and on Exit. |
| 2 | Retest compares with the saved fingerprint and shows how consistency changed | ✅ | Unit (`compareSessions`) and E2E: seeded fingerprint from 3 days ago, full retest, "Since last time" with both visits' bands and the shift between visits. |
| 3 | Share card PNG contains palette and title only | ✅ | E2E downloads it: PNG, 1200 × 630. The drawing code only renders the title, labels and palette swatches. |
| 4 | Works on iOS Safari (audio unlocks on first tap) | ⚠️ | Code: `audioSession.type = 'playback'`, a silent `<audio>` unlock, `Tone.start()` inside the tap, resume after backgrounding. Phone layout checked with iPhone 13 emulation (touch picking works, no sideways scroll). Needs a check on a real iPhone; WebKit isn't available here. |

Also added in Phase 2: voice "ah" timbre (each voice sound is matched to itself in the unit test), a
calendar reminder (.ics) for the retest, and the fireworks visual style.

## Phase 3

| # | Criterion | Status | Notes |
| --- | --- | --- | --- |
| 1 | Nothing is sent without an explicit opt-in | ⛔ | Data collection not built. The spec gates it on ethics approval (REB/IRB) and consent text. |
| 2 | Aggregate views show only groups of 20+ | ⛔ | Depends on data collection. |
| 3 | Users can delete their submission with a code | ⛔ | Depends on data collection. |
| — | Optional: conversational guide | ✅ | Scripted, offline, on the results "Your patterns" card. Talks only about the user's own answers and the two cited findings. Unit-tested. |
| — | Optional: in-browser audio classifier (YAMNet) | ⛔ | Not built: large dependency the spec says to verify and approve first. |

## Still to check by hand

- Frame rate in Chrome, Firefox and Safari on a mid-range laptop (`?fps`), especially with fireworks.
- iOS Safari on a real iPhone: first-tap audio, the ringer switch, mic and camera.
- How the synthesized sounds feel on headphones, before choosing real samples.
- Five-person think-aloud test (spec section 8).
