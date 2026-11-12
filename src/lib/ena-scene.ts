/**
 * ena-scene.ts — the arena of Evolutionary Neural Agents as SVG markup, shared by the post's
 * figures (<GenerationReplay>, <AgentBrain>, <TrapMap>) at build time and in the browser.
 *
 * Coordinates are the program's world units, with y growing downwards exactly as the SFML window
 * draws them: the agents start at the top left and the target is at the bottom right. Colours are
 * CSS classes (ena-*); each component styles them from design tokens.
 */
import { LIMIT_X, LIMIT_Y, OBSTACLES, SPAWN, TARGET } from "./ena-model";

export const VIEWBOX = `${-LIMIT_X - 0.6} ${-LIMIT_Y - 0.6} ${2 * LIMIT_X + 1.2} ${2 * LIMIT_Y + 1.2}`;

export type Pt = [number, number];

const f = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toString();

export interface ArenaOptions {
  grid?: boolean;
  labels?: boolean;
}

/** Border, optional 5-unit grid, walls, round obstacles, the target and the start point. */
export function arenaSvg({ grid = true, labels = true }: ArenaOptions = {}): string {
  const out: string[] = [];
  out.push(`<rect class="ena-floor" x="${-LIMIT_X}" y="${-LIMIT_Y}" width="${2 * LIMIT_X}" height="${2 * LIMIT_Y}" />`);
  if (grid) {
    const d: string[] = [];
    for (let x = -LIMIT_X + 5; x < LIMIT_X; x += 5) d.push(`M${x} ${-LIMIT_Y}V${LIMIT_Y}`);
    for (let y = -LIMIT_Y + 5; y < LIMIT_Y; y += 5) d.push(`M${-LIMIT_X} ${y}H${LIMIT_X}`);
    out.push(`<path class="ena-grid" d="${d.join("")}" />`);
  }
  for (const o of OBSTACLES) {
    if (o.kind === "rect") out.push(`<rect class="ena-wall" x="${o.x - o.w / 2}" y="${o.y - o.h / 2}" width="${o.w}" height="${o.h}" />`);
    else out.push(`<circle class="ena-obst" cx="${o.x}" cy="${o.y}" r="${o.r}" />`);
  }
  out.push(`<rect class="ena-border" x="${-LIMIT_X}" y="${-LIMIT_Y}" width="${2 * LIMIT_X}" height="${2 * LIMIT_Y}" />`);
  out.push(`<circle class="ena-target-ring" cx="${TARGET.x}" cy="${TARGET.y}" r="${TARGET.r + 0.9}" />`);
  out.push(`<circle class="ena-target" cx="${TARGET.x}" cy="${TARGET.y}" r="${TARGET.r}" />`);
  out.push(`<circle class="ena-spawn" cx="${SPAWN.x}" cy="${SPAWN.y}" r="0.9" />`);
  if (labels) {
    out.push(`<text class="ena-label" x="${SPAWN.x}" y="${SPAWN.y - 1.7}" text-anchor="middle">start</text>`);
    out.push(`<text class="ena-label" x="${TARGET.x + 2.4}" y="${TARGET.y + 0.55}">target</text>`);
  }
  return out.join("");
}

/** "M x y L x y …" for a polyline; `every` keeps every n-th point (and always the last). */
export function pathD(pts: Pt[], decimals = 2, every = 1): string {
  if (!pts.length) return "";
  let d = `M${f(pts[0][0], decimals)} ${f(pts[0][1], decimals)}`;
  for (let i = 1; i < pts.length; i++) {
    if (i % every && i !== pts.length - 1) continue;
    d += `L${f(pts[i][0], decimals)} ${f(pts[i][1], decimals)}`;
  }
  return d;
}

/** Undo the delta + 0.02-unit quantisation of generations.json (see the export script). */
export function decodePath(enc: number[], q: number): Pt[] {
  const pts: Pt[] = [];
  let x = enc[0], y = enc[1];
  pts.push([x * q, y * q]);
  for (let i = 2; i < enc.length; i += 2) {
    x += enc[i]; y += enc[i + 1];
    pts.push([x * q, y * q]);
  }
  return pts;
}

/** Small "×" centred on a point, for crashes. */
export function crossD([x, y]: Pt, s = 0.7): string {
  return `M${f(x - s)} ${f(y - s)}L${f(x + s)} ${f(y + s)}M${f(x - s)} ${f(y + s)}L${f(x + s)} ${f(y - s)}`;
}

// ---- generations.json ----------------------------------------------------------------------------
export type Outcome = "R" | "C" | "T";
export interface GenData { g: number; best: number; a: [Outcome, number, number[]][] }
export interface GenerationsFile { k: number; q: number; gens: GenData[] }

export interface ReplayAgent {
  o: Outcome;
  n: number;          // steps the episode lasted
  pts: Pt[];          // a point every k steps, plus the final one
  cum: number[];      // path length up to each point
}

export function decodeGeneration(file: GenerationsFile, g: GenData): ReplayAgent[] {
  return g.a.map(([o, n, enc]) => {
    const pts = decodePath(enc, file.q);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { o, n, pts, cum };
  });
}

/** Where an agent is at step t, and how much of its path is drawn. */
export function agentAt(a: ReplayAgent, k: number, t: number): { x: number; y: number; drawn: number; done: boolean } {
  const last = a.pts.length - 1;
  if (t >= a.n || last === 0) {
    const p = a.pts[last];
    return { x: p[0], y: p[1], drawn: a.cum[last], done: t >= a.n };
  }
  const j = Math.max(0, Math.min(Math.floor(t / k), last - 1));
  const t0 = j * k, t1 = j + 1 === last ? a.n : (j + 1) * k;
  const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
  const p = a.pts[j], q = a.pts[j + 1];
  return { x: p[0] + (q[0] - p[0]) * u, y: p[1] + (q[1] - p[1]) * u, drawn: a.cum[j] + (a.cum[j + 1] - a.cum[j]) * u, done: false };
}

export function counts(agents: ReplayAgent[], t: number) {
  let R = 0, C = 0, T = 0;
  for (const a of agents) if (t >= a.n) { if (a.o === "R") R++; else if (a.o === "C") C++; else T++; }
  return { R, C, T, alive: agents.length - R - C - T };
}

/** Full static picture of a generation (every path drawn, end markers), for SSR and reduced motion. */
export function generationStaticSvg(file: GenerationsFile, g: GenData): string {
  const agents = decodeGeneration(file, g);
  const out: string[] = [];
  agents.forEach((a, i) => {
    if (i === g.best) return;
    out.push(`<path class="gr-trail is-${a.o}" d="${pathD(a.pts, 1, 3)}" />`);
  });
  const b = agents[g.best];
  out.push(`<path class="gr-trail gr-trail--best is-${b.o}" d="${pathD(b.pts, 1, 2)}" />`);
  agents.forEach((a) => out.push(endMark(a)));
  return out.join("");
}

export function endMark(a: ReplayAgent): string {
  const p = a.pts[a.pts.length - 1];
  if (a.o === "C") return `<path class="gr-end is-C" d="${crossD(p)}" />`;
  if (a.o === "T") return `<circle class="gr-end is-T" cx="${f(p[0])}" cy="${f(p[1])}" r="0.55" />`;
  return `<circle class="gr-end is-R" cx="${f(p[0])}" cy="${f(p[1])}" r="0.45" />`;
}
