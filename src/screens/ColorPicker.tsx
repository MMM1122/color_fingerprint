/**
 * OKLCH color picker: hue ring + lightness and chroma sliders, each with a numeric input.
 * Equal slider steps look like roughly equal color steps. Fully keyboard operable via the sliders.
 */
import { useEffect, useMemo, useRef } from 'react';
import { clampChroma } from 'culori';
import type { Oklch } from '../types';
import { describeColor, oklchToHex } from '../science/color';

const C_MAX = 0.37;

type Props = { value: Oklch; onChange(v: Oklch): void; idPrefix?: string };

export default function ColorPicker({ value, onChange, idPrefix = 'pk' }: Props) {
  const [l, c, h] = value;
  const ringRef = useRef<HTMLCanvasElement>(null);
  const hex = oklchToHex(value);
  const displayC = (clampChroma({ mode: 'oklch', l, c, h }, 'oklch') as { c?: number }).c ?? 0;
  const clamped = c - displayC > 0.005;

  // Ring shows every hue at the current lightness (and a moderate chroma so it stays in gamut).
  useEffect(() => {
    const cv = ringRef.current!;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const size = (cv.width = cv.height = Math.round(cv.clientWidth * Math.min(2, devicePixelRatio)) || 300);
    const r0 = size * 0.36;
    const r1 = size * 0.5;
    ctx.clearRect(0, 0, size, size);
    for (let d = 0; d < 360; d += 2) {
      const a0 = ((d - 90 - 1.2) * Math.PI) / 180;
      const a1 = ((d - 90 + 1.2) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, r1, a0, a1);
      ctx.arc(size / 2, size / 2, r0, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = oklchToHex([l, Math.max(0.06, Math.min(c, 0.16)), d]);
      ctx.fill();
    }
  }, [l, c]);

  function fromPointer(e: React.PointerEvent) {
    const rect = ringRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    onChange([l, c < 0.02 ? 0.1 : c, Math.round(deg) % 360]);
  }

  const knob = useMemo(() => {
    const a = ((h - 90) * Math.PI) / 180;
    const r = 0.43;
    return { left: `${50 + r * 100 * Math.cos(a)}%`, top: `${50 + r * 100 * Math.sin(a)}%` };
  }, [h]);

  const lTrack = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((x) => oklchToHex([x, c, h])).join(',')})`;
  const cTrack = `linear-gradient(90deg, ${[0, 0.1, 0.2, 0.3, C_MAX].map((x) => oklchToHex([l, x, h])).join(',')})`;
  const hTrack = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((x) => oklchToHex([l, Math.max(0.06, Math.min(c, 0.16)), x])).join(',')})`;

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
      <div className="wheel">
        <canvas
          ref={ringRef}
          aria-hidden="true"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => e.buttons && fromPointer(e)}
        />
        <div className="swatch" style={{ background: hex }} />
        <div className="knob" style={{ ...knob, background: oklchToHex([l, Math.max(0.06, Math.min(c, 0.16)), h]) }} />
      </div>
      {row('h', 'Hue', Math.round(h), 0, 359, 1, hTrack, (x) => [l, c, x])}
      {row('l', 'Lightness', Math.round(l * 100), 0, 100, 1, lTrack, (x) => [x / 100, c, h])}
      {row('c', 'Colorfulness', Math.round(c * 100), 0, Math.round(C_MAX * 100), 1, cTrack, (x) => [l, x / 100, h])}
      <p className="quiet" aria-live="polite" style={{ margin: 0 }}>
        {describeColor([l, displayC, h])}, {hex}
        {clamped ? ' (the most colorful this screen can show)' : ''}
      </p>
    </div>
  );
}
