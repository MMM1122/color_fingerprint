/// <reference lib="webworker" />
import { renderTrack, type TrackId } from './tracks';

self.onmessage = (e: MessageEvent<{ id: TrackId; sampleRate: number }>) => {
  const buf = renderTrack(e.data.id, e.data.sampleRate);
  (self as unknown as Worker).postMessage({ id: e.data.id, buffer: buf }, [buf.buffer]);
};
