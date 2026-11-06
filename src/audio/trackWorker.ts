/// <reference lib="webworker" />
import { renderTrackStereo, type GeneratedTrackId } from './tracks';

self.onmessage = (e: MessageEvent<{ id: GeneratedTrackId; sampleRate: number }>) => {
  const [left, right] = renderTrackStereo(e.data.id, e.data.sampleRate);
  (self as unknown as Worker).postMessage({ id: e.data.id, left, right }, [left.buffer, right.buffer]);
};
