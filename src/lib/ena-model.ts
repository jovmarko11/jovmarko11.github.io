/**
 * ena-model.ts — a TypeScript copy of one agent from Evolutionary Neural Agents
 * (jovmarko11/EvolutionaryNeuralAgents): the arena from SceneBuilder::buildWorld, the analytic
 * ray casts of World / CircleObstacle / RectObstacle, and Agent::step (scan → encodeInputs →
 * NeuralNetwork::forward → decodeOutput → applyAction → resolveMovement), plus the bookkeeping
 * of Episode::step.
 *
 * Every arithmetic step follows the C++ code in the same order (including the agent radius,
 * which is a float in Params.h), so a replay matches the original to the last few bits. It was
 * checked against the project's own Agent and Episode on the 100 genomes of a real generation and
 * on the evolved best genome from 400 start poses (see the post's Results). No DOM here: used at
 * build time by <AgentBrain> and in the browser by scripts/agent-brain.ts.
 */

// ---- Params.h ---------------------------------------------------------------------------------
export const LIMIT_X = 20, LIMIT_Y = 30;
export const SPAWN = { x: -15, y: -25 };
export const NUM_SENSORS = 7;
export const FOV = Math.PI;
export const AGENT_RADIUS = Math.fround(0.3); // inline constexpr float agentRadius = 0.3f
export const MAX_COLLISION_STEP = 0.1;
export const SENSOR_MAX = 6.0;
export const MAX_SPEED = 10.0;
export const MAX_TURN_RATE = Math.PI;
export const TIME_STEP = 0.02;
export const MAX_STEPS = 1000;
export const LAYERS = [11, 10, 4, 2];
export const TARGET = { x: 10, y: 15, r: 0.8 };

// ---- SceneBuilder::buildWorld -------------------------------------------------------------------
export interface Rect { kind: "rect"; x: number; y: number; w: number; h: number }
export interface Circle { kind: "circle"; x: number; y: number; r: number }
export type Obstacle = Rect | Circle;

export const OBSTACLES: Obstacle[] = [
  { kind: "rect", x: -8, y: -16, w: 24, h: 2 },
  { kind: "rect", x: 8, y: -4, w: 24, h: 2 },
  { kind: "rect", x: -8, y: 8, w: 24, h: 2 },
  { kind: "circle", x: -4, y: -24, r: 2.5 },
  { kind: "circle", x: 9, y: -26, r: 2.0 },
  { kind: "circle", x: -13, y: -13, r: 1.8 },
  { kind: "circle", x: -2, y: -7, r: 1.8 },
  { kind: "circle", x: 9, y: -13, r: 1.8 },
  { kind: "circle", x: -15, y: -1, r: 1.8 },
  { kind: "circle", x: -4, y: 5, r: 1.8 },
  { kind: "circle", x: 8, y: -1, r: 1.8 },
  { kind: "circle", x: 17, y: 5, r: 1.5 },
  { kind: "circle", x: -9, y: 14, r: 2.5 },
  { kind: "circle", x: 2, y: 21, r: 3.0 },
  { kind: "circle", x: 16, y: 22, r: 2.5 },
  { kind: "circle", x: -16, y: 24, r: 2.0 },
];

export type Status = "ongoing" | "blocked" | "out" | "reached";

// ---- Vec2 -------------------------------------------------------------------------------------
type V = { x: number; y: number };
const len = (v: V) => Math.sqrt(v.x * v.x + v.y * v.y);
const rotated = (v: V, a: number): V => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};
const normalized = (v: V): V => {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
};

// ---- geometry ---------------------------------------------------------------------------------
function distanceTo(o: Obstacle, p: V): number {
  if (o.kind === "circle") return len({ x: p.x - o.x, y: p.y - o.y }) - o.r;
  const dx = Math.abs(p.x - o.x) - o.w / 2.0;
  const dy = Math.abs(p.y - o.y) - o.h / 2.0;
  const outside = len({ x: Math.max(dx, 0.0), y: Math.max(dy, 0.0) });
  const inside = Math.min(Math.max(dx, dy), 0.0);
  return outside + inside;
}

function intersectRay(o: Obstacle, origin: V, d: V, maxDistance: number): number | null {
  if (o.kind === "circle") {
    const L = { x: o.x - origin.x, y: o.y - origin.y };
    const tca = L.x * d.x + L.y * d.y;
    const d2 = (L.x * L.x + L.y * L.y) - tca * tca;
    const r2 = o.r * o.r;
    if (d2 > r2) return null;
    const thc = Math.sqrt(r2 - d2);
    const t0 = tca - thc, t1 = tca + thc;
    const t = t0 >= 0.0 ? t0 : t1;
    if (t < 0.0 || t > maxDistance) return null;
    return t;
  }
  const minX = o.x - o.w / 2.0, maxX = o.x + o.w / 2.0;
  const minY = o.y - o.h / 2.0, maxY = o.y + o.h / 2.0;
  let tmin = 0.0, tmax = maxDistance;
  if (Math.abs(d.x) < 1e-12) {
    if (origin.x < minX || origin.x > maxX) return null;
  } else {
    let t1 = (minX - origin.x) / d.x, t2 = (maxX - origin.x) / d.x;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(d.y) < 1e-12) {
    if (origin.y < minY || origin.y > maxY) return null;
  } else {
    let t1 = (minY - origin.y) / d.y, t2 = (maxY - origin.y) / d.y;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

function boundaryDistance(o: V, d: V): number {
  let tx = Infinity;
  if (d.x > 0.0) tx = (LIMIT_X - o.x) / d.x;
  else if (d.x < 0.0) tx = (-LIMIT_X - o.x) / d.x;
  let ty = Infinity;
  if (d.y > 0.0) ty = (LIMIT_Y - o.y) / d.y;
  else if (d.y < 0.0) ty = (-LIMIT_Y - o.y) / d.y;
  return Math.min(tx, ty);
}

export function castRay(origin: V, d: V, maxDistance: number): number {
  let closest = Math.min(maxDistance, boundaryDistance(origin, d));
  for (const o of OBSTACLES) {
    const hit = intersectRay(o, origin, d, closest);
    if (hit !== null) closest = hit;
  }
  return closest;
}

export function inRange(c: V, radius: number): Status {
  if (Math.abs(c.x) + radius > LIMIT_X || Math.abs(c.y) + radius > LIMIT_Y) return "out";
  for (const o of OBSTACLES) if (distanceTo(o, c) <= radius) return "blocked";
  if (len({ x: c.x - TARGET.x, y: c.y - TARGET.y }) - TARGET.r <= radius) return "reached";
  return "ongoing";
}

/** World::clearance — distance to the nearest obstacle or wall (negative inside). */
export function clearance(p: V): number {
  let nearest = Math.min(LIMIT_X - Math.abs(p.x), LIMIT_Y - Math.abs(p.y));
  for (const o of OBSTACLES) nearest = Math.min(nearest, distanceTo(o, p));
  return nearest;
}

// ---- NeuralNetwork ----------------------------------------------------------------------------
export interface Layer { w: number[][]; b: number[] } // w[out][in]

/** NeuralNetwork::setParameters: per layer, weights row by row, then biases. */
export function layersFromGenome(genome: number[]): Layer[] {
  const layers: Layer[] = [];
  let k = 0;
  for (let l = 1; l < LAYERS.length; l++) {
    const rows = LAYERS[l], cols = LAYERS[l - 1];
    const w: number[][] = [];
    for (let i = 0; i < rows; i++) { const r: number[] = []; for (let j = 0; j < cols; j++) r.push(genome[k++]); w.push(r); }
    const b: number[] = [];
    for (let i = 0; i < rows; i++) b.push(genome[k++]);
    layers.push({ w, b });
  }
  if (k !== genome.length) throw new Error(`ena-model: genome has ${genome.length} genes, the network needs ${k}`);
  return layers;
}

/** Layer::forward for every layer (tanh everywhere); returns the output of each layer. */
export function forward(layers: Layer[], input: number[]): number[][] {
  const outs: number[][] = [];
  let x = input;
  for (const { w, b } of layers) {
    const y: number[] = [];
    for (let i = 0; i < w.length; i++) {
      let sum = 0;
      for (let j = 0; j < w[i].length; j++) sum += w[i][j] * x[j];
      y.push(Math.tanh(sum + b[i]));
    }
    outs.push(y);
    x = y;
  }
  return outs;
}

// ---- Agent + Episode --------------------------------------------------------------------------
export const SENSOR_ANGLES = Array.from({ length: NUM_SENSORS }, (_, i) => -FOV / 2.0 + i * (FOV / (NUM_SENSORS - 1)));

export interface AgentState {
  start: V; startHeading: V;
  pos: V; heading: V; vel: V;
  sensorDirs: V[];
  alive: boolean; status: Status;
  steps: number; best: number; // Episode: steps taken, best distance to the target so far
}

/** One step's inner values, for drawing. */
export interface StepTrace {
  scan: number[];          // ScanResult::distance per ray, 0..1 (1 = nothing within 6 units)
  inputs: number[];        // the 11 network inputs
  acts: number[][];        // outputs of the 3 layers
  turn: number; speed: number; // AgentAction (turnAngle in rad per step, speed in units/s)
  status: Status;
}

export function makeAgent(start: V = SPAWN, headingRad = 0): AgentState {
  const h = rotated({ x: 1, y: 0 }, headingRad);
  const startHeading = normalized(h);
  const a: AgentState = {
    start: { ...start }, startHeading, pos: { ...start }, heading: startHeading, vel: { x: 0, y: 0 },
    sensorDirs: [], alive: true, status: "ongoing", steps: 0,
    best: len({ x: TARGET.x - start.x, y: TARGET.y - start.y }),
  };
  a.sensorDirs = SENSOR_ANGLES.map((ang) => rotated(a.heading, ang));
  return a;
}

export function scan(a: AgentState): number[] {
  return a.sensorDirs.map((d) => castRay(a.pos, d, SENSOR_MAX) / SENSOR_MAX);
}

export function encodeInputs(a: AgentState, scanD: number[]): number[] {
  const input = scanD.map((d) => 1.0 - d);
  const to = { x: TARGET.x - a.pos.x, y: TARGET.y - a.pos.y };
  const cross = a.heading.x * to.y - a.heading.y * to.x;
  const dot = a.heading.x * to.x + a.heading.y * to.y;
  const angleToGoal = Math.atan2(cross, dot);
  const initial = len({ x: TARGET.x - a.start.x, y: TARGET.y - a.start.y });
  const distanceToGoal = initial > 1e-9 ? Math.min(1.0, len(to) / initial) : 0.0;
  const normalizedSpeed = Math.min(1.0, len(a.vel) / MAX_SPEED);
  input.push(Math.sin(angleToGoal), Math.cos(angleToGoal), distanceToGoal, normalizedSpeed);
  return input;
}

function resolveMovement(from: V, to: V): { status: Status; pos: V } {
  const delta = { x: to.x - from.x, y: to.y - from.y };
  const distance = len(delta);
  const substeps = Math.max(1, Math.ceil(distance / MAX_COLLISION_STEP));
  let lastSafe = from;
  for (let i = 1; i <= substeps; ++i) {
    const t = i / substeps;
    const sample = { x: from.x + delta.x * t, y: from.y + delta.y * t };
    const status = inRange(sample, AGENT_RADIUS);
    if (status === "blocked" || status === "out") return { status, pos: lastSafe };
    if (status === "reached") return { status, pos: sample };
    lastSafe = sample;
  }
  return { status: "ongoing", pos: to };
}

/** Agent::step + Episode::step. Mutates the agent; returns what happened inside. */
export function step(a: AgentState, layers: Layer[]): StepTrace | null {
  if (!a.alive) return null;
  const scanD = scan(a);
  const inputs = encodeInputs(a, scanD);
  const acts = forward(layers, inputs);
  const out = acts[acts.length - 1];
  const turnOut = Math.min(1, Math.max(-1, out[0]));
  const speedOut = Math.min(1, Math.max(-1, out[1]));
  const turn = turnOut * MAX_TURN_RATE * TIME_STEP;
  const speed = 0.5 * (speedOut + 1.0) * MAX_SPEED;

  a.heading = normalized(rotated(a.heading, turn));
  a.vel = { x: a.heading.x * speed, y: a.heading.y * speed };
  a.sensorDirs = SENSOR_ANGLES.map((ang) => rotated(a.heading, ang));

  const desired = { x: a.pos.x + a.vel.x * TIME_STEP, y: a.pos.y + a.vel.y * TIME_STEP };
  const move = resolveMovement(a.pos, desired);
  a.pos = move.pos;
  a.status = move.status;
  if (move.status !== "ongoing") a.alive = false;

  a.steps++;
  a.best = Math.min(a.best, len({ x: TARGET.x - a.pos.x, y: TARGET.y - a.pos.y }));
  if (a.alive && a.steps >= MAX_STEPS) { a.alive = false; a.status = "ongoing"; }
  return { scan: scanD, inputs, acts, turn, speed, status: move.status };
}

/** Runs a whole episode; returns every position, starting with the spawn point. */
export function runEpisode(genome: number[], start: V = SPAWN, headingRad = 0) {
  const layers = layersFromGenome(genome);
  const a = makeAgent(start, headingRad);
  const path: V[] = [{ ...a.pos }];
  while (a.alive) { step(a, layers); path.push({ ...a.pos }); }
  const outcome = a.status === "reached" ? "R" : a.status === "ongoing" ? "T" : "C";
  return { path, outcome, steps: a.steps, best: a.best };
}
