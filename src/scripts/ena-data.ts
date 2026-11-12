/**
 * ena-data.ts — one fetch of generations.json per page, shared by the header art (<EvolutionLoop>)
 * and figure 01 (<GenerationReplay>), which both replay paths from the same file.
 */
import type { GenerationsFile } from "../lib/ena-scene";

const cache = new Map<string, Promise<GenerationsFile>>();

export function loadGenerations(url: string): Promise<GenerationsFile> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`generations.json: HTTP ${r.status}`);
      return r.json() as Promise<GenerationsFile>;
    });
    p.catch(() => cache.delete(url)); // a later caller may retry
    cache.set(url, p);
  }
  return p;
}
