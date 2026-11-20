import { runEngine, type EngineInput, type EngineOutput } from './energy';

self.onmessage = (ev: MessageEvent<EngineInput>) => {
  const output = runEngine(ev.data);
  (self as unknown as Worker).postMessage(output, {
    transfer: [output.fluence.buffer, output.depth.buffer, output.dwell.buffer],
  });
};

export type { EngineInput, EngineOutput };
