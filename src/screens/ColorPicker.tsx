/**
 * OKLCH color picker.
 *  - Hue ring: every hue at the current lightness and colorfulness, as this screen will show it.
 *  - Shade plane: for the current hue, lightness (up) × colorfulness (right). The area a normal
 *    (sRGB) screen can show is drawn in color; the rest is hatched, so people can see the limit
 *    instead of dragging into a dead zone.
 *  - Sliders with numeric inputs (keyboard), plus a hex field for an exact color.
 * Equal slider steps look like roughly equal color steps (OKLCH).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Oklch } from '../types';
import { answerFromHex, describeColor, encodeSrgb8, maxChroma, oklchToHex, oklchToLinearSrgb } from '../science/color';

const C_MAX = 0.37;
const HATCH = 'repeating-linear-gradient(135deg, #4a4a4a 0 5px, #3a3a3a 5px 10px)';

type Props = { value: Oklch; onChange(v: Oklch): void; idPrefix?: string };

export default function ColorPicker({ value, onChange, idPrefix = 'pk' }: Props) {
  const [l, c, h] = value;
  const ringRef = useRef<HTMLCanvasElement>(null);
  const planeRef = useRef<HTMLCanvasElement>(null);
  const hex = oklchToHex(value);
  const cMaxHere = maxChroma(l, h);
  const displayC = Math.min(c, cMaxHere);
  const clamped = c - cMaxHere > 0.005;

  // Ring: each hue at this lightness and colorfulness, limited to what the screen can show.
  useEffect(() => {
    const cv = ringRef.current!;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const size = (cv.width = cv.height = Math.round(cv.clientWidth * Math.min(2, devicePixelRatio)) || 300);
    const r0 = size * 0.36;
    const r1 = size * 0.5;
    ctx.clearRect(0, 0, size, size);
    const ringC = Math.max(0.05, c);
    for (let d = 0; d < 360; d += 2) {
      const a0 = ((d - 90 - 1.2) * Math.PI) / 180;
      const a1 = ((d - 90 + 1.2) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, r1, a0, a1);
      ctx.arc(size / 2, size / 2, r0, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = oklchToHex([l, Math.min(ringC, maxChroma(l, d)), d]);
      ctx.fill();
    }
  }, [l, c]);

  // Shade plane for the current hue.
  useEffect(() => {
    const cv = planeRef.current!;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = 240;
    const H = 160;
    cv.width = W;
    cv.height = H;
    const img = ctx.createImageData(W, H);
    const step = C_MAX / (W - 1);
    for (let y = 0; y < H; y++) {
      const L = 1 - y / (H - 1);
      const edge = maxChroma(L, h);
      for (let x = 0; x < W; x++) {
        const C = (x / (W - 1)) * C_MAX;
        const k = (y * W + x) * 4;
        // Past the edge: transparent, so the hatched CSS background shows through.
        // The pixel on the edge is partly transparent, which smooths the boundary.
        const over = (C - edge) / step;
        if (over >= 1) {
          img.data[k + 3] = 0;
          continue;
        }
        const rgb = oklchToLinearSrgb(L, Math.min(C, edge), h);
        img.data[k] = encodeSrgb8(rgb[0]);
        img.data[k + 1] = encodeSrgb8(rgb[1]);
        img.data[k + 2] = encodeSrgb8(rgb[2]);
        img.data[k + 3] = over > 0 ? Math.round(255 * (1 - over)) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [h]);

  function fromRing(e: React.PointerEvent) {
    const rect = ringRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    onChange([l, c < 0.02 ? 0.1 : c, Math.round(deg) % 360]);
  }

  function fromPlane(e: React.PointerEvent) {
    const rect = planeRef.current!.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const L = Math.round((1 - fy) * 100) / 100;
    // Dragging past the edge snaps to the most colorful shade the screen can show.
    const C = Math.min(fx * C_MAX, maxChroma(L, h));
    onChange([L, Math.round(C * 100) / 100, h]);
  }

  const knob = useMemo(() => {
    const a = ((h - 90) * Math.PI) / 180;
    const r = 0.43;
    return { left: `${50 + r * 100 * Math.cos(a)}%`, top: `${50 + r * 100 * Math.sin(a)}%` };
  }, [h]);

  const lTrack = `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => oklchToHex([x, c, h])).join(',')})`;
  // Colorfulness track: real colors up to the screen's limit, hatched beyond it.
  const edgePct = (cMaxHere / C_MAX) * 100;
  const cStops = [0, 0.25, 0.5, 0.75, 1].map((f) => `${oklchToHex([l, f * cMaxHere, h])} ${(f * edgePct).toFixed(1)}%`);
  const cTrack = `linear-gradient(90deg, ${cStops.join(',')}, transparent ${edgePct.toFixed(1)}%), ${HATCH}`;
  const hTrack = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360]
    .map((x) => oklchToHex([l, Math.min(Math.max(0.05, c), maxChroma(l, x % 360)), x]))
    .join(',')})`;

  const row = (
    key: 'h' | 'l' | 'c',
    label: string,
    v: number,
    min: number,
    max: number,
    step: number,
    track: string,
    set: (x: number) => Oklch,
  ) => {
    const id = `${idPrefix}-${key}`;
    return (
      <div className="slider-row" style={{ ['--track' as string]: track }}>
        <label htmlFor={id}>{label}</label>
        <input id={id} type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(set(Number(e.target.value)))} />
        <input
          type="number"
          aria-label={`${label} value`}
          min={min}
          max={max}
          step={step}
          value={v}
          onChange={(e) => {
            const x = Number(e.target.value);
            if (Number.isFinite(x)) onChange(set(Math.min(max, Math.max(min, x))));
          }}
        />
      </div>
    );
  };

  return (
    <div className="picker">
      <div className="picker-top">
        <div className="wheel">
          <canvas
            ref={ringRef}
            aria-hidden="true"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              fromRing(e);
            }}
            onPointerMove={(e) => e.buttons && fromRing(e)}
          />
          <div className="swatch" style={{ background: hex }} />
          <div className="knob" style={{ ...knob, background: oklchToHex([l, Math.min(Math.max(0.05, c), maxChroma(l, h)), h]) }} />
        </div>
        <div className="plane-wrap">
          <div className="plane" style={{ background: HATCH }}>
            <canvas
              ref={planeRef}
              aria-hidden="true"
              data-testid="shade-plane"
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                fromPlane(e);
              }}
              onPointerMove={(e) => e.buttons && fromPlane(e)}
            />
            <div
              className="knob"
              style={{ left: `${(displayC / C_MAX) * 100}%`, top: `${(1 - l) * 100}%`, background: hex }}
            />
          </div>
          <p className="quiet plane-legend">
            <span>↑ lighter</span>
            <span>more colorful →</span>
          </p>
        </div>
      </div>
      {row('h', 'Hue', Math.round(h), 0, 359, 1, hTrack, (x) => [l, c, x])}
      {row('l', 'Lightness', Math.round(l * 100), 0, 100, 1, lTrack, (x) => [x / 100, c, h])}
      {row('c', 'Colorfulness', Math.round(c * 100), 0, Math.round(C_MAX * 100), 1, cTrack, (x) => [l, x / 100, h])}
      <div className="picker-foot">
        <p className="quiet" aria-live="polite" style={{ margin: 0 }}>
          {describeColor([l, displayC, h])}
          {clamped ? ' (the most colorful this screen can show)' : ''}
        </p>
        <HexField hex={hex} onHex={(x) => onChange(answerFromHex(x).oklch)} id={`${idPrefix}-hex`} />
      </div>
    </div>
  );
}

/** Type an exact color, e.g. #3a7bd5. Applied once it is a valid 6-digit hex. */
function HexField({ hex, onHex, id }: { hex: string; onHex(h: string): void; id: string }) {
  const [text, setText] = useState(hex);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(hex);
  }, [hex, focused]);
  return (
    <label className="hex-field" htmlFor={id}>
      <span>Hex</span>
      <input
        id={id}
        type="text"
        inputMode="text"
        spellCheck={false}
        maxLength={7}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(hex);
        }}
        onChange={(e) => {
          let v = e.target.value.trim();
          if (!v.startsWith('#')) v = '#' + v;
          setText(v);
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onHex(v.toLowerCase());
        }}
      />
    </label>
  );
}
