/**
 * breed-step.ts — geometry for <BreedStep>: one real step of the genetic algorithm in
 * Evolutionary Neural Agents, from generation 15 to 16 of the seed-42 run (breed-step.json).
 *
 * The data was logged by a harness that called the project's own Selection::tournament,
 * Crossover::uniform and Mutation::mutate in the same order as GeneticAlgorithm::nextGeneration,
 * and checked that the 100 genomes it produced were identical to the real nextGeneration's (and
 * that the random generator ended in the same state). Nothing here is re-simulated.
 */
import { LAYERS } from "./ena-model";

export type Outcome = "R" | "C" | "T";
export interface BreedFile {
  gen: number;
  pop: [number, Outcome, number][];  // fitness, outcome and steps of generation `gen`, by slot
  elites: number[];                  // slots copied unchanged, best first
  children: { ta: { c: number[]; w: number }; tb: { c: number[]; w: number }; same: number; mut: number; o: Outcome; n: number; f: number }[];
  next: [number, Outcome, number][]; // the same for generation `gen + 1`
  show: { index: number; a: number[]; b: number[]; mask: string; mut: [number, number][]; child: number[] };
}

export const STRIP_W = 500, STRIP_H = 124, BASE = 108;
const PITCH = 5, BAR = 4, SCALE = 16; // 16 fitness points per unit of height

export interface Bar { x: number; y: number; h: number; o: Outcome; slot: number; rank: number }

export function barGeom(f: number) {
  const h = Math.max(1, Math.abs(f) / SCALE);
  return f >= 0 ? { y: BASE - h, h } : { y: BASE, h };
}

/** Generation `gen`, sorted by fitness (rank 0 = fittest). */
export function sortedBars(d: BreedFile): Bar[] {
  const order = d.pop.map((_, i) => i).sort((a, b) => d.pop[b][0] - d.pop[a][0]);
  return order.map((slot, rank) => ({ x: rank * PITCH, ...barGeom(d.pop[slot][0]), o: d.pop[slot][1], slot, rank }));
}

/** Generation `gen + 1`, in slot order (elites first, then children). */
export function nextBars(d: BreedFile): Bar[] {
  return d.next.map(([f, o], slot) => ({ x: slot * PITCH, ...barGeom(f), o, slot, rank: -1 }));
}

export const BAR_W = BAR;
export const slotX = (slot: number) => slot * PITCH;

// ---- genome as the network's matrices ------------------------------------------------------------
export const CELL = 10, CELL_IN = 9, BIAS_GAP = 4, LAYER_GAP = 7;
export interface Cell { gene: number; x: number; y: number; layer: number; bias: boolean }

/** Every gene placed as in NeuralNetwork::getParameters: per layer, weight rows then the biases as a last column. */
export function genomeCells(): { cells: Cell[]; w: number; h: number } {
  const cells: Cell[] = [];
  let gene = 0, y0 = 0, w = 0;
  for (let l = 1; l < LAYERS.length; l++) {
    const rows = LAYERS[l], cols = LAYERS[l - 1];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ gene: gene++, x: c * CELL, y: y0 + r * CELL, layer: l, bias: false });
    for (let r = 0; r < rows; r++) cells.push({ gene: gene++, x: cols * CELL + BIAS_GAP, y: y0 + r * CELL, layer: l, bias: true });
    w = Math.max(w, cols * CELL + BIAS_GAP + CELL);
    y0 += rows * CELL + LAYER_GAP;
  }
  return { cells, w, h: y0 - LAYER_GAP };
}

/** A weight as one of 2 × 11 fill classes: amber for positive, violet for negative, 0 at the surface (|w| ≥ 1.5 is full colour). */
export function weightClass(v: number): string {
  return `w-${v >= 0 ? "p" : "n"}${Math.round(Math.min(1, Math.abs(v) / 1.5) * 10)}`;
}

/** The CSS for those classes (global, scoped under .bs). */
export const weightCss = Array.from({ length: 11 }, (_, k) =>
  `.bs .w-p${k}{fill:color-mix(in srgb,var(--bs-pos) ${k * 10}%,var(--surface))}.bs .w-n${k}{fill:color-mix(in srgb,var(--bs-neg) ${k * 10}%,var(--surface))}`,
).join("");

export const STEPS = ["gen", "elite", "tourA", "tourB", "cross", "mutate", "fill", "eval"] as const;
export type StepKey = (typeof STEPS)[number];
