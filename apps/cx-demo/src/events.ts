import { EventEmitter } from 'node:events';
import type { StreamEvent } from './types.ts';

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitStream(ev: StreamEvent): void {
  bus.emit('stream', ev);
}

export function subscribeStream(listener: (ev: StreamEvent) => void): () => void {
  bus.on('stream', listener);
  return () => bus.off('stream', listener);
}
