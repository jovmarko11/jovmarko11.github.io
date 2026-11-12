/**
 * generation-replay.ts — the player behind <GenerationReplay>.
 *
 * Fetches the recorded paths when the figure comes near the viewport, then replays a generation
 * at 5× the simulation's real time (250 steps per second). A path is drawn in grey while its agent
 * is still driving and takes the colour of its outcome when the episode ends.
 *   - autoplay when ≥ 40 % visible: plays every generation in turn, then starts over
 *   - clicking a tab plays only that generation; the slider scrubs; play/pause and replay buttons
 *   - ←/→ move between the generation tabs
 * With prefers-reduced-motion: no autoplay; a tab shows its generation complete, the slider scrubs.
 */
import { agentAt, counts, crossD, decodeGeneration, pathD, type GenerationsFile, type ReplayAgent } from "../lib/ena-scene";
import { loadGenerations } from "./ena-data";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STEPS_PER_SECOND = 250;
const HOLD_MS = 1800;
const SVG_NS = "http://www.w3.org/2000/svg";

interface Built {
  agents: ReplayAgent[];
  trails: SVGPathElement[];
  lengths: number[];
  dots: SVGCircleElement[];
  ends: SVGElement[];
  end: number;
}

export function initGenerationReplay(root: HTMLElement) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";

  const k = Number(root.dataset.k);
  const captions: Record<string, string> = JSON.parse(root.querySelector("script[data-captions]")!.textContent!);
  const layer = root.querySelector<SVGGElement>("[data-layer]")!;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".gr__tab")];
  const genLabel = root.querySelector<HTMLElement>("[data-gen]")!;
  const caption = root.querySelector<HTMLElement>("[data-caption]")!;
  const clock = root.querySelector<HTMLElement>("[data-clock]")!;
  const range = root.querySelector<HTMLInputElement>("[data-range]")!;
  const playBtn = root.querySelector<HTMLButtonElement>('[data-act="play"]')!;
  const countEls = new Map([...root.querySelectorAll<HTMLElement>("[data-c]")].map((e) => [e.dataset.c!, e]));

  let file: GenerationsFile | null = null;
  let decoded: ReplayAgent[][] = [];
  let built: Built | null = null;
  let gi = tabs.length - 1, t = 0;
  let playing = false, visible = false, touched = false, story = true;
  let raf = 0, last = 0, holdUntil = 0, loading = false;

  function build(i: number) {
    gi = i;
    const g = file!.gens[i];
    const agents = decoded[i];
    layer.textContent = "";
    const order = agents.map((_, j) => j).filter((j) => j !== g.best).concat(g.best); // best on top
    const trails: SVGPathElement[] = [], lengths: number[] = [], dots: SVGCircleElement[] = [], ends: SVGElement[] = [];
    const tg = document.createElementNS(SVG_NS, "g"), eg = document.createElementNS(SVG_NS, "g"), dg = document.createElementNS(SVG_NS, "g");
    for (const j of order) {
      const a = agents[j];
      const p = document.createElementNS(SVG_NS, "path");
      const L = a.cum[a.cum.length - 1];
      p.setAttribute("d", pathD(a.pts));
      p.setAttribute("class", `gr-trail is-${a.o}${j === g.best ? " gr-trail--best" : ""}`);
      p.style.strokeDasharray = `${L + 1} ${L + 1}`;
      tg.appendChild(p);
      trails[j] = p; lengths[j] = L;

      const e0 = a.pts[a.pts.length - 1];
      let e: SVGElement;
      if (a.o === "C") { e = document.createElementNS(SVG_NS, "path"); e.setAttribute("d", crossD(e0)); }
      else { e = document.createElementNS(SVG_NS, "circle"); e.setAttribute("cx", String(e0[0])); e.setAttribute("cy", String(e0[1])); e.setAttribute("r", a.o === "T" ? "0.55" : "0.45"); }
      e.setAttribute("class", `gr-end is-${a.o}`);
      eg.appendChild(e); ends[j] = e;

      const d = document.createElementNS(SVG_NS, "circle");
      d.setAttribute("r", j === g.best ? "0.7" : "0.42");
      d.setAttribute("class", "gr-dot");
      dg.appendChild(d); dots[j] = d;
    }
    layer.append(tg, eg, dg);
    const end = Math.max(...agents.map((a) => a.n));
    built = { agents, trails, lengths, dots, ends, end };
    range.max = String(end);
    tabs.forEach((b, j) => b.setAttribute("aria-selected", j === i ? "true" : "false"));
    genLabel.textContent = `Generation ${g.g}`;
    caption.innerHTML = captions[String(g.g)];
  }

  function render() {
    if (!built) return;
    const { agents, trails, lengths, dots, ends } = built;
    for (let j = 0; j < agents.length; j++) {
      const s = agentAt(agents[j], k, t);
      trails[j].style.strokeDashoffset = String(lengths[j] + 1 - s.drawn);
      trails[j].classList.toggle("is-live", !s.done);
      dots[j].classList.toggle("is-hidden", s.done);
      ends[j].classList.toggle("is-hidden", !s.done);
      if (!s.done) { dots[j].setAttribute("cx", s.x.toFixed(2)); dots[j].setAttribute("cy", s.y.toFixed(2)); }
    }
    const c = counts(agents, t);
    countEls.get("R")!.textContent = String(c.R);
    countEls.get("C")!.textContent = String(c.C);
    countEls.get("T")!.textContent = String(c.T);
    countEls.get("alive")!.textContent = String(c.alive);
    const step = Math.min(Math.floor(t), built.end);
    clock.textContent = `step ${step} · ${(step * 0.02).toFixed(1)} s`;
    range.value = String(step);
  }

  function frame(now: number) {
    raf = 0;
    if (!playing || !visible || !built) return;
    const dt = Math.max(0, Math.min(100, now - last)); // a rAF timestamp can be a little older than the kick
    last = now;
    if (holdUntil) {
      if (now >= holdUntil) {
        holdUntil = 0;
        if (!story) { setPlaying(false); return; }
        build((gi + 1) % tabs.length);
        t = 0;
        render();
      }
    } else {
      t += (dt / 1000) * STEPS_PER_SECOND;
      if (t >= built.end) { t = built.end; holdUntil = now + HOLD_MS; }
      render();
    }
    raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!raf && playing && visible) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function setPlaying(on: boolean) {
    playing = on;
    playBtn.dataset.state = on ? "playing" : "paused";
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    if (on) kick(); else { cancelAnimationFrame(raf); raf = 0; holdUntil = 0; }
  }

  async function load() {
    if (file || loading) return;
    loading = true;
    try {
      file = await loadGenerations(root.dataset.src!);
    } catch {
      loading = false;
      return; // the static picture stays
    }
    decoded = file.gens.map((g) => decodeGeneration(file!, g));
    if (reduced()) { build(gi); t = built!.end; render(); return; }
    build(0); t = 0; render();
    if (visible && !touched && root.dataset.autoplay === "true") setPlaying(true);
  }

  function selectTab(i: number) {
    touched = true;
    if (!file) return;
    build(i);
    if (reduced()) { t = built!.end; render(); setPlaying(false); return; }
    t = 0; render();
    story = false;
    setPlaying(true);
  }

  tabs.forEach((b, i) => {
    b.addEventListener("click", () => selectTab(i));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const n = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[n].focus();
      selectTab(n);
    });
  });
  playBtn.addEventListener("click", () => {
    touched = true;
    if (!built) return;
    if (!playing && t >= built.end) t = 0;
    story = true;
    setPlaying(!playing);
  });
  root.querySelector('[data-act="restart"]')!.addEventListener("click", () => {
    touched = true;
    if (!built) return;
    t = 0; render(); story = false;
    setPlaying(!reduced());
  });
  range.addEventListener("input", () => {
    touched = true;
    if (!built) return;
    setPlaying(false);
    t = Number(range.value);
    render();
  });

  new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) load(); }, { rootMargin: "900px 0px" }).observe(root);
  new IntersectionObserver((entries) => {
    for (const e of entries) {
      visible = e.isIntersecting;
      if (visible && file && !touched && !playing && root.dataset.autoplay === "true" && !reduced()) setPlaying(true);
      else if (visible) kick();
    }
  }, { threshold: 0.4 }).observe(root);
}
