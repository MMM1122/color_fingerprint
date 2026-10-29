# Attribution

## Audio

| File / source | What it is | Source | License |
| --- | --- | --- | --- |
| Calibration sounds (piano, pure tone, bowed strings × C3, A3, F4, D5, B5) | Synthesized in the browser by `src/audio/synth.ts` | Original code in this repo | Same as this project |
| Built-in tracks "Rain on the keys", "Slow bloom", "Three voices" | Generated in the browser by `src/audio/tracks.ts` | Original code in this repo | Same as this project |

The synthesized piano and strings are **placeholders**. Spec section 3 asks for openly licensed instrument
samples, and choosing them is an open decision (spec section 11). To use real samples, put the files in
`public/samples/`, list them in `SAMPLE_FILES` in `src/config/stimuli.ts`, and add one row per file here
with its source URL, author and license.

No sample or track from a third party is included yet.

## Software

| Package | Version | License |
| --- | --- | --- |
| React, React DOM | 19.3.1 | MIT |
| Zustand | 5.0.16 | MIT |
| Tone.js | 15.1.22 | MIT |
| Meyda | 5.6.3 | MIT |
| Pitchy | 4.1.0 | MIT |
| culori | 4.0.2 | MIT |
| Three.js (including `examples/jsm` post-processing passes) | 0.186.1 | MIT |

Dev and test tools: Vite, TypeScript, Vitest, Playwright (all MIT or Apache-2.0).

## Research cited in the product

- Eagleman, D. M., Kagan, A. D., Nelson, S. S., Sagaram, D., & Sarma, A. K. (2007). A standardized test battery for the study of synesthesia. *Journal of Neuroscience Methods*, 159(1), 139–145.
- Rothen, N., Seth, A. K., Witzel, C., & Ward, J. (2013). Diagnosing synaesthesia with online colour pickers: maximising sensitivity and specificity. *Journal of Neuroscience Methods*, 215(1), 156–160.
- Ward, J., Huckstep, B., & Tsakanikos, E. (2006). Sound-colour synaesthesia: to what extent does it use cross-modal mechanisms common to us all? *Cortex*, 42(2), 264–280.

## Borrowed components

SynesthesiaColorPicker was considered (spec section 3) but not used; the OKLCH picker in
`src/screens/ColorPicker.tsx` is original. Credit it here if it is adopted later.
