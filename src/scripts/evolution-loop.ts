/**
 * evolution-loop.ts — the player behind <EvolutionLoop>, the header art of Evolutionary Neural
 * Agents. One state machine, one requestAnimationFrame loop:
 *
 *   rewind → [ drive → hold → score → select → breed → ff ] × 4 generations → rewind → …
 *
 * drive replays the recorded paths at 1000 steps per 2.6 s (about 7.7× the simulation's real time,
 * 3× that once five or fewer agents are still driving);
 * every other phase only moves or recolours the 100 cells of the grid. The loop runs only while the
 * header is on screen. With prefers-reduced-motion, or if the paths can't be loaded, the static
 * picture from the server (generation 299, ranked) stays.
 */
import { agentAt, counts, crossD, decodeGeneration, pathD, type GenerationsFile, type ReplayAgent } from "../lib/ena-scene";
import { loadGenerations } from "./ena-data";

interface Shown { g: number; rank: number[]; picks: number[]; parents: number; mut: number; bestF: number }
interface Payload { k: number; shown: Shown[]; ff: [number, string][][]; fit: number[] }
type Phase = "rewind" | "drive" | "hold" | "score" | "select" | "breed" | "ff";
type CellState = "R" | "C" | "T" | "new";

const MS_PER_STEP = 2.6;
const FAST_BELOW = 5;
const HOLD = 450, SCORE = 1100, SELECT = 1500, BREED = 1300, REWIND = 1100, FF_FRAME = 85, FF_TAIL = 400;
const PITCH = 16, CELL = 13;
const SVG_NS = "http://www.w3.org/2000/svg";
const N_GENS = 300;

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const pos = (p: number): [number, number] => [(p % 10) * PITCH + CELL / 2, Math.floor(p / 10) * PITCH + CELL / 2];
const pad = (g: number) => String(g).padStart(3, "0");
const stageOf: Record<Phase, string> = { rewind: "loop", drive: "drive", hold: "drive", score: "score", select: "select", breed: "breed", ff: "loop" };

export function initEvolutionLoop(root: HTMLElement) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";
  if (reduced()) return;

  const data: Payload = JSON.parse(root.querySelector("script[data-loop]")!.textContent!);
  const layer = root.querySelector<SVGGElement>("[data-layer]")!;
  const genEl = root.querySelector<HTMLElement>("[data-gen]")!;
  const capEl = root.querySelector<HTMLElement>("[data-cap]")!;
  const litEl = root.querySelector<HTMLElement>("[data-lit]")!;
  const cursorEl = root.querySelector<HTMLElement>("[data-cursor]")!;
  const stages = [...root.querySelectorAll<HTMLElement>("[data-stage]")];
  const legend = Object.fromEntries([...root.querySelectorAll<HTMLElement>("[data-n]")].map((e) => [e.dataset.n!, e]));
  // The server renders the cells in grid order, so slot[p] is the cell at grid position p.
  let slot = [...root.querySelectorAll<SVGGElement>(".el-c")];
  const state = new Map<SVGGElement, CellState>();

  let decoded: ReplayAgent[][] = [];
  let phase: Phase = "rewind", pt = 0, si = 0, t = 0, end = 0, fromG = 299, shownGen = 299;
  let agents: ReplayAgent[] = [], trails: SVGPathElement[] = [], lengths: number[] = [], dots: SVGCircleElement[] = [], ends: SVGElement[] = [];
  let ffIdx = -1, bred = 8, selectStep = 0;
  let visible = false, raf = 0, last = 0, started = false, alive = 100;

  // ---- small view helpers ---------------------------------------------------------------------
  function setCell(el: SVGGElement, s: CellState) {
    if (state.get(el) === s) return;
    state.set(el, s);
    el.classList.remove("is-R", "is-C", "is-T", "is-new");
    el.classList.add(`is-${s}`);
  }
  function place(el: SVGGElement, x: number, y: number) {
    el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
  }
  function showGen(g: number) {
    if (g === shownGen) return;
    shownGen = g;
    genEl.textContent = pad(g);
    litEl.style.clipPath = `inset(0 ${(100 - (100 * (g + 1)) / N_GENS).toFixed(2)}% 0 0)`;
    cursorEl.style.left = `${((100 * (g + 0.5)) / N_GENS).toFixed(2)}%`;
  }
  function setLegend(R: number | string, C: number | string, T: number | string, fit: string) {
    legend.R.textContent = String(R);
    legend.C.textContent = String(C);
    legend.T.textContent = String(T);
    legend.fit.textContent = fit;
  }
  const fitText = (g: number) => (data.fit[g] ? `${data.fit[g]} steps` : "didn’t arrive");
  const cap = (html: string) => { capEl.innerHTML = html; };

  // ---- arena ----------------------------------------------------------------------------------
  function buildArena() {
    const s = data.shown[si];
    agents = decoded[si];
    const elites = new Set(s.rank.slice(0, 8));
    const best = s.rank[0];
    layer.textContent = "";
    layer.classList.remove("is-ranked", "is-selected", "is-gone");
    trails = []; lengths = []; dots = []; ends = [];
    const tg = document.createElementNS(SVG_NS, "g"), eg = document.createElementNS(SVG_NS, "g"), dg = document.createElementNS(SVG_NS, "g");
    const order = agents.map((_, j) => j).filter((j) => j !== best).concat(best); // the best path on top
    for (const j of order) {
      const a = agents[j];
      const L = a.cum[a.cum.length - 1];
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", pathD(a.pts));
      p.setAttribute("class", `gr-trail is-${a.o}${elites.has(j) ? " is-elite" : ""}${j === best ? " is-best" : ""}`);
      p.style.strokeDasharray = `${L + 1} ${L + 1}`;
      p.style.strokeDashoffset = String(L + 1);
      tg.appendChild(p);
      trails[j] = p; lengths[j] = L;

      const e0 = a.pts[a.pts.length - 1];
      let e: SVGElement;
      if (a.o === "C") { e = document.createElementNS(SVG_NS, "path"); e.setAttribute("d", crossD(e0)); }
      else { e = document.createElementNS(SVG_NS, "circle"); e.setAttribute("cx", String(e0[0])); e.setAttribute("cy", String(e0[1])); e.setAttribute("r", a.o === "T" ? "0.6" : "0.5"); }
      e.setAttribute("class", `gr-end is-${a.o} is-hidden`);
      eg.appendChild(e); ends[j] = e;

      const d = document.createElementNS(SVG_NS, "circle");
      d.setAttribute("r", "0.55");
      d.setAttribute("class", "gr-dot");
      dg.appendChild(d); dots[j] = d;
    }
    layer.append(tg, eg, dg);
    end = Math.max(...agents.map((a) => a.n));
  }

  function renderDrive() {
    const k = data.k;
    for (let j = 0; j < agents.length; j++) {
      const s = agentAt(agents[j], k, t);
      trails[j].style.strokeDashoffset = String(lengths[j] + 1 - s.drawn);
      trails[j].classList.toggle("is-live", !s.done);
      dots[j].classList.toggle("is-hidden", s.done);
      ends[j].classList.toggle("is-hidden", !s.done);
      if (!s.done) { dots[j].setAttribute("cx", s.x.toFixed(2)); dots[j].setAttribute("cy", s.y.toFixed(2)); }
      setCell(slot[j], s.done ? agents[j].o : "new");
    }
    const c = counts(agents, t);
    alive = c.alive;
    setLegend(c.R, c.C, c.T, "…");
    const g = data.shown[si].g;
    cap(`${g === 0 ? "random weights, no training yet" : "all 100 drive at once"} · step <b>${Math.min(end, Math.floor(t))}</b>`);
  }

  // ---- phases ---------------------------------------------------------------------------------
  function enter(p: Phase) {
    phase = p; pt = 0;
    const on = stageOf[p];
    stages.forEach((el) => el.classList.toggle("is-on", el.dataset.stage === on));
    root.classList.toggle("is-snap", p === "ff" || p === "rewind"); // colours flick, no fades
    const s = data.shown[si];
    switch (p) {
      case "rewind":
        cap("seed 42 · back to random weights");
        layer.classList.add("is-gone");
        slot.forEach((el) => { setCell(el, "new"); el.classList.remove("is-elite", "is-dim", "is-pop"); });
        setLegend("–", "–", "–", "–");
        break;
      case "drive":
        buildArena();
        t = 0;
        showGen(s.g);
        slot.forEach((el, q) => {
          place(el, ...pos(q));
          setCell(el, "new");
          el.classList.remove("is-dim", "is-pop");
          el.classList.toggle("is-elite", s.g > 0 && q < 8); // cells 0–7 are last generation's elites
        });
        renderDrive();
        break;
      case "hold":
        break;
      case "score":
        cap(`fitness ranks them · best F = <b>${s.bestF.toFixed(1)}</b>`);
        layer.classList.add("is-ranked");
        slot.forEach((el) => el.classList.remove("is-elite"));
        setLegend(...legendOf(s.g), fitText(s.g));
        break;
      case "select":
        selectStep = 0;
        cap(`<b>8</b> elites kept · <b>${s.parents}</b> of 100 win a tournament`);
        break;
      case "breed":
        bred = 8;
        cap(`<b>92</b> children · crossover + ~${s.mut} mutated genes each`);
        layer.classList.add("is-gone");
        break;
      case "ff": {
        ffIdx = -1;
        const n = data.shown[si + 1].g - s.g - 1;
        cap(`the same loop, <b>${n}</b> more generation${n === 1 ? "" : "s"}`);
        break;
      }
    }
  }

  function legendOf(g: number): [number, number, number] {
    const a = data.shown.find((s) => s.g === g) ? decoded[data.shown.findIndex((s) => s.g === g)] : null;
    if (!a) return [0, 0, 0];
    const c = counts(a, Infinity);
    return [c.R, c.C, c.T];
  }

  function tick(dt: number) {
    pt += dt;
    const s = data.shown[si];
    switch (phase) {
      case "rewind": {
        const u = Math.min(1, pt / REWIND);
        showGen(Math.round(fromG * (1 - ease(u))));
        if (u >= 1) { si = 0; enter("drive"); }
        break;
      }
      case "drive":
        // the last few agents of a generation are played 3× faster (the step counter stays exact)
        t = Math.min(end, t + (dt / MS_PER_STEP) * (alive <= FAST_BELOW ? 3 : 1));
        renderDrive();
        if (t >= end) enter("hold");
        break;
      case "hold":
        if (pt >= HOLD) enter("score");
        break;
      case "score": {
        // slot[i] is agent i; slide every cell from position i to its rank
        const u = ease(Math.min(1, pt / SCORE));
        s.rank.forEach((agent, r) => {
          const [x0, y0] = pos(agent), [x1, y1] = pos(r);
          place(slot[agent], x0 + (x1 - x0) * u, y0 + (y1 - y0) * u);
        });
        if (pt >= SCORE) { slot = s.rank.map((agent) => slot[agent]); enter("select"); }
        break;
      }
      case "select": {
        // slot[r] is now the agent of rank r
        const u = pt / SELECT;
        if (selectStep === 0 && u >= 0.12) {
          selectStep = 1;
          for (let r = 0; r < 8; r++) slot[r].classList.add("is-elite");
          layer.classList.add("is-selected");
        }
        if (selectStep === 1 && u >= 0.45) {
          selectStep = 2;
          for (let r = 8; r < 100; r++) if (s.picks[s.rank[r]] === 0) slot[r].classList.add("is-dim");
        }
        if (pt >= SELECT) enter("breed");
        break;
      }
      case "breed": {
        const u = pt / BREED;
        while (bred < 100 && u >= 0.05 + (0.75 * (bred - 8)) / 91) {
          const el = slot[bred++];
          el.classList.remove("is-dim");
          setCell(el, "new");
          el.classList.remove("is-pop");
          void el.getBoundingClientRect(); // restart the pop animation
          el.classList.add("is-pop");
        }
        if (pt >= BREED) {
          if (si < data.shown.length - 1) enter("ff");
          else { fromG = s.g; enter("rewind"); }
        }
        break;
      }
      case "ff": {
        const list = data.ff[si];
        const i = Math.min(list.length - 1, Math.floor(pt / FF_FRAME));
        if (i !== ffIdx) {
          ffIdx = i;
          const [h, m] = list[i];
          showGen(h);
          let R = 0, C = 0, T = 0;
          for (let q = 0; q < 100; q++) {
            const o = m[q] as "R" | "C" | "T";
            setCell(slot[q], o);
            slot[q].classList.remove("is-pop");
            if (o === "R") R++; else if (o === "C") C++; else T++;
          }
          setLegend(R, C, T, fitText(h));
        }
        if (pt >= list.length * FF_FRAME + FF_TAIL) { si++; enter("drive"); }
        break;
      }
    }
  }

  // ---- loop -----------------------------------------------------------------------------------
  function frame(now: number) {
    raf = 0;
    if (!visible) return;
    const dt = Math.max(0, Math.min(100, now - last)); // after a hidden tab, don't jump
    last = now;
    tick(dt);
    raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (!raf && visible && started) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  loadGenerations(root.dataset.src!).then((file: GenerationsFile) => {
    decoded = data.shown.map((s) => {
      const g = file.gens.find((x) => x.g === s.g);
      if (!g) throw new Error(`EvolutionLoop: generation ${s.g} not in generations.json`);
      return decodeGeneration(file, g);
    });
    started = true;
    fromG = 299;
    enter("rewind");
    kick();
  }).catch(() => { /* the static picture stays */ });

  new IntersectionObserver((entries) => {
    for (const e of entries) {
      visible = e.isIntersecting;
      if (visible) kick();
    }
  }).observe(root);
}
