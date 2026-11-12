/**
 * agent-brain.ts — the player behind <AgentBrain>.
 *
 * Steps lib/ena-model.ts in the browser and redraws the map (agent, rays, trail) and the network
 * (node colours, edge brightness, input values) for every step. Each picture shows the agent where
 * it made the decision: the seven ray distances it read there, and what the network did with them.
 *   - autoplay at ½× real time when ≥ 40 % visible, looping; stops for good once the reader acts
 *   - play/pause, one step, back to the start, speed ¼× / ½× / 1×
 *   - click (or tap) the map to drop the agent at that point, facing right
 * With prefers-reduced-motion: no autoplay; the step button and play still work on request.
 */
import { AGENT_RADIUS, clearance, LIMIT_X, LIMIT_Y, layersFromGenome, makeAgent, step, type AgentState, type StepTrace } from "../lib/ena-model";
import { edgeLoads, nodeValues, rayEnds, turnText, valueFill } from "../lib/agent-brain";
import { pathD, type Pt } from "../lib/ena-scene";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SPEEDS = [0.25, 0.5, 1];
const SPEED_LABEL = ["¼×", "½×", "1×"];
const HOLD_MS = 2500;

export function initAgentBrain(root: HTMLElement) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";

  const genome: number[] = JSON.parse(root.querySelector("script[data-genome]")!.textContent!);
  const layers = layersFromGenome(genome);
  const map = root.querySelector<SVGSVGElement>("[data-map]")!;
  const route = root.querySelector<SVGPathElement>("[data-route]")!;
  const trailEl = root.querySelector<SVGPathElement>("[data-trail]")!;
  const rayEls = [...root.querySelectorAll<SVGLineElement>("[data-rays] line")];
  const hitEls = [...root.querySelectorAll<SVGCircleElement>("[data-hits] circle")];
  const agentEl = root.querySelector<SVGCircleElement>("[data-agent]")!;
  const edgeEls = [...root.querySelectorAll<SVGLineElement>("[data-edges] line")];
  const nodeEls = [...root.querySelectorAll<SVGCircleElement>("[data-nodes] circle")];
  const inEls = [...root.querySelectorAll<SVGTextElement>("[data-in]")];
  const read = new Map([...root.querySelectorAll<HTMLElement>("[data-r]")].map((e) => [e.dataset.r!, e]));
  const msg = root.querySelector<HTMLElement>("[data-msg]")!;
  const playBtn = root.querySelector<HTMLButtonElement>('[data-act="play"]')!;
  const speedBtn = root.querySelector<HTMLButtonElement>('[data-act="speed"]')!;
  const defaultMsg = msg.textContent ?? "";

  let a: AgentState = makeAgent();
  let trail: Pt[] = [];
  let ended = false;
  let speedIdx = 1;
  let playing = false, visible = false, touched = false;
  let raf = 0, last = 0, acc = 0, holdUntil = 0;

  const fmt = (v: number) => (v >= 0 ? " " : "") + v.toFixed(2);

  function show(pre: { pos: AgentState["pos"]; sensorDirs: AgentState["sensorDirs"] }, tr: StepTrace) {
    const ends = rayEnds(pre, tr.scan);
    rayEls.forEach((el, k) => {
      el.setAttribute("x1", pre.pos.x.toFixed(3)); el.setAttribute("y1", pre.pos.y.toFixed(3));
      el.setAttribute("x2", ends[k].x.toFixed(3)); el.setAttribute("y2", ends[k].y.toFixed(3));
      el.style.display = "";
    });
    hitEls.forEach((el, k) => {
      el.setAttribute("cx", ends[k].x.toFixed(3)); el.setAttribute("cy", ends[k].y.toFixed(3));
      el.classList.toggle("is-off", !ends[k].hit);
    });
    agentEl.setAttribute("cx", pre.pos.x.toFixed(3)); agentEl.setAttribute("cy", pre.pos.y.toFixed(3));
    trailEl.setAttribute("d", pathD(trail));
    const vals = nodeValues(tr);
    nodeEls.forEach((el, k) => { el.style.fill = valueFill(vals[k]); });
    const loads = edgeLoads(layers, tr);
    edgeEls.forEach((el, k) => { el.style.opacity = (0.06 + 0.84 * loads[k]).toFixed(3); });
    inEls.forEach((el, k) => { el.textContent = fmt(vals[k]); });
    const s = a.steps - 1;
    read.get("step")!.textContent = `${s} · ${(s * 0.02).toFixed(2)} s`;
    read.get("turn")!.textContent = turnText(tr.turn);
    read.get("speed")!.textContent = `${tr.speed.toFixed(1)} units/s`;
    read.get("status")!.textContent = "driving";
  }

  function finish() {
    ended = true;
    rayEls.forEach((el) => (el.style.display = "none"));
    hitEls.forEach((el) => el.classList.add("is-off"));
    agentEl.setAttribute("cx", a.pos.x.toFixed(3)); agentEl.setAttribute("cy", a.pos.y.toFixed(3));
    trailEl.setAttribute("d", pathD(trail));
    read.get("step")!.textContent = `${a.steps} · ${(a.steps * 0.02).toFixed(2)} s`;
    read.get("status")!.textContent =
      a.status === "reached" ? `reached the target in ${a.steps} steps` : a.status === "ongoing" ? "ran out of time" : `crashed at step ${a.steps}`;
  }

  /** Take one decision and show it; after the last one, show where the agent ended. */
  function advance() {
    if (ended) return;
    if (!a.alive) { trail.push([a.pos.x, a.pos.y]); finish(); return; }
    const pre = { pos: { ...a.pos }, sensorDirs: a.sensorDirs.slice() };
    trail.push([pre.pos.x, pre.pos.y]);
    const tr = step(a, layers)!;
    show(pre, tr);
  }

  function reset(start?: { x: number; y: number }) {
    a = makeAgent(start);
    trail = [];
    ended = false;
    advance();
  }

  function frame(now: number) {
    raf = 0;
    if (!playing || !visible) return;
    const dt = Math.max(0, Math.min(100, now - last)); // a rAF timestamp can be a little older than the kick
    last = now;
    if (holdUntil) {
      if (now >= holdUntil) {
        holdUntil = 0;
        if (touched) { setPlaying(false); return; }
        reset();
      }
    } else {
      acc += (dt / 1000) * 50 * SPEEDS[speedIdx];
      while (acc >= 1 && !ended) { acc -= 1; advance(); }
      if (ended) { acc = 0; holdUntil = now + HOLD_MS; }
    }
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && playing && visible) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function setPlaying(on: boolean) {
    playing = on;
    playBtn.dataset.state = on ? "playing" : "paused";
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    if (on) { route.style.display = "none"; kick(); } else { cancelAnimationFrame(raf); raf = 0; holdUntil = 0; }
  }

  playBtn.addEventListener("click", () => {
    touched = true;
    if (!playing && ended) reset();
    setPlaying(!playing);
  });
  root.querySelector('[data-act="step"]')!.addEventListener("click", () => {
    touched = true; setPlaying(false);
    route.style.display = "none";
    if (ended) reset(); else advance();
  });
  root.querySelector('[data-act="restart"]')!.addEventListener("click", () => {
    touched = true;
    msg.textContent = defaultMsg;
    reset();
    setPlaying(!reduced());
  });
  speedBtn.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speedBtn.textContent = SPEED_LABEL[speedIdx];
  });
  map.addEventListener("click", (e) => {
    const ctm = map.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    touched = true;
    if (Math.abs(p.x) > LIMIT_X || Math.abs(p.y) > LIMIT_Y || clearance(p) < AGENT_RADIUS + 0.1) {
      msg.textContent = "too close to a wall or an obstacle, try another spot";
      return;
    }
    msg.textContent = `dropped at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}), facing right`;
    route.style.display = "none";
    reset({ x: p.x, y: p.y });
    setPlaying(!reduced());
  });

  // sync with the server-rendered picture: replay up to the same step
  const initial = Number(root.dataset.initial);
  reset();
  for (let s = 0; s < initial && !ended; s++) advance();

  new IntersectionObserver((entries) => {
    for (const e of entries) {
      visible = e.isIntersecting;
      if (visible && !touched && !playing && root.dataset.autoplay === "true" && !reduced()) { reset(); setPlaying(true); }
      else if (visible) kick();
    }
  }, { threshold: 0.4 }).observe(root);
}
