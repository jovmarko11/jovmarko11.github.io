/**
 * agent-brain.ts — layout and per-step drawing values for <AgentBrain>: where the network's
 * nodes and edges go, and how one step of lib/ena-model.ts (rays, inputs, activations) maps to
 * colours and opacities. Shared by the build-time render and scripts/agent-brain.ts.
 */
import { LAYERS, SENSOR_ANGLES, SENSOR_MAX, type AgentState, type Layer, type StepTrace } from "./ena-model";

export const NET_W = 470, NET_H = 330;
const COL_X = [182, 266, 344, 418];
const TOP = 18, BOTTOM = NET_H - 18;

export const INPUT_LABELS = [
  "ray left 90°", "ray left 60°", "ray left 30°", "ray ahead", "ray right 30°", "ray right 60°", "ray right 90°",
  "sin(target angle)", "cos(target angle)", "distance to target", "speed",
];
/** Short forms for narrow screens (the legend under the figure explains them). */
export const INPUT_SHORT = ["L90°", "L60°", "L30°", "0°", "R30°", "R60°", "R90°", "sin θ", "cos θ", "dist", "speed"];
export const OUTPUT_LABELS = ["turn", "speed"];

export interface Node { l: number; i: number; x: number; y: number }
export interface Edge { l: number; i: number; j: number; x1: number; y1: number; x2: number; y2: number; w: number }

export function nodes(): Node[] {
  const out: Node[] = [];
  LAYERS.forEach((n, l) => {
    const span = l === 0 ? BOTTOM - TOP : l === 1 ? (BOTTOM - TOP) * 0.86 : l === 2 ? (BOTTOM - TOP) * 0.5 : (BOTTOM - TOP) * 0.3;
    const mid = (TOP + BOTTOM) / 2;
    for (let i = 0; i < n; i++) out.push({ l, i, x: COL_X[l], y: n === 1 ? mid : mid - span / 2 + (span * i) / (n - 1) });
  });
  return out;
}

export function edges(layers: Layer[]): Edge[] {
  const ns = nodes();
  const at = (l: number, i: number) => ns.find((n) => n.l === l && n.i === i)!;
  const out: Edge[] = [];
  layers.forEach(({ w }, l) => {
    for (let i = 0; i < w.length; i++) for (let j = 0; j < w[i].length; j++) {
      const a = at(l, j), b = at(l + 1, i);
      out.push({ l, i, j, x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: w[i][j] });
    }
  });
  return out;
}

/** A value in [-1, 1] as a fill: amber for positive, violet for negative, the surface at 0. */
export function valueFill(v: number): string {
  const p = Math.round(Math.min(1, Math.abs(v)) * 100);
  return `color-mix(in srgb, var(${v >= 0 ? "--ab-pos" : "--ab-neg"}) ${p}%, var(--surface))`;
}

/** Every node's value for one step: the 11 inputs, then each layer's tanh output. */
export function nodeValues(trace: StepTrace): number[] {
  return [...trace.inputs, ...trace.acts.flat()];
}

/** How much each edge carries on this step, |w · input|, scaled per layer to 0..1. */
export function edgeLoads(layers: Layer[], trace: StepTrace): number[] {
  const ins = [trace.inputs, ...trace.acts.slice(0, -1)];
  const out: number[] = [];
  layers.forEach(({ w }, l) => {
    const loads: number[] = [];
    for (let i = 0; i < w.length; i++) for (let j = 0; j < w[i].length; j++) loads.push(Math.abs(w[i][j] * ins[l][j]));
    const max = Math.max(1e-9, ...loads);
    for (const v of loads) out.push(v / max);
  });
  return out;
}

/** End points of the seven rays for drawing (world units). */
export function rayEnds(a: Pick<AgentState, "pos" | "sensorDirs">, scan: number[]) {
  return SENSOR_ANGLES.map((_, k) => {
    const d = a.sensorDirs[k], len = scan[k] * SENSOR_MAX;
    return { x: a.pos.x + d.x * len, y: a.pos.y + d.y * len, hit: scan[k] < 1 };
  });
}

export function turnText(turn: number): string {
  const perSecond = turn / 0.02 / Math.PI; // fraction of the maximum turn rate
  if (Math.abs(perSecond) < 0.005) return "straight";
  return `${perSecond > 0 ? "right" : "left"} ${Math.abs(perSecond).toFixed(2)}·π rad/s`;
}
