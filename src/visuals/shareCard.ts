/**
 * Share card: a PNG of the palette with a title. Nothing personal: no scores, dates, names or answers
 * beyond the averaged palette colors themselves.
 */
import { PITCHES_MIDI, TIMBRES, TIMBRE_LABELS, midiToName } from '../config/stimuli';
import type { Fingerprint } from '../types';
import { oklchToHex } from '../science/color';

export const SHARE_TITLE = 'My Color Fingerprint';

export function drawShareCard(canvas: HTMLCanvasElement, anchors: Fingerprint['anchors']): void {
  const W = 1200;
  const H = 630;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1d1d1d';
  ctx.fillRect(0, 0, W, H);

  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  ctx.fillStyle = '#f3f3f3';
  ctx.font = `400 56px ${font}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(SHARE_TITLE, 72, 118);

  const rows = TIMBRES.length;
  const cols = PITCHES_MIDI.length;
  const left = 300;
  const top = 178;
  const gap = 8;
  const size = Math.min((W - left - 72 - gap * (cols - 1)) / cols, (H - top - 56 - gap * (rows - 1)) / rows);

  ctx.font = `400 22px ${font}`;
  ctx.fillStyle = '#c4c4c4';
  PITCHES_MIDI.forEach((m, c) => ctx.fillText(midiToName(m), left + c * (size + gap), top - 14));
  TIMBRES.forEach((t, r) => {
    const y = top + r * (size + gap);
    ctx.fillStyle = '#f3f3f3';
    ctx.fillText(TIMBRE_LABELS[t], 72, y + size / 2 + 8);
    PITCHES_MIDI.forEach((m, c) => {
      const x = left + c * (size + gap);
      const a = anchors[t]?.[m];
      if (a) {
        ctx.fillStyle = oklchToHex(a);
        ctx.fillRect(x, y, size, size);
      } else {
        ctx.strokeStyle = '#3d3d3d';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
      }
    });
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image.'))), 'image/png'),
  );
}
