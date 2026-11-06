/// <reference lib="webworker" />
import { renderTrack, type GeneratedTrackId } from './tracks';

self.onmessage = (e: MessageEvent<{ id: GeneratedTrackId; sampleRate: number }>) => {
  const buf = renderTrack(e.data.id, e.data.sampleRate);
  (self as unknown as Worker).postMessage({ id: e.data.id, buffer: buf }, [buf.buffer]);
};
