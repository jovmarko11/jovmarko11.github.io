/**
 * breed-step.ts — the player behind <BreedStep>.
 *
 * The figure is drawn once; a step only changes `data-step` and the `pN` classes ("step N or
 * later") on the root, and CSS transitions do the rest.
 *   - autoplay when ≥ 40 % visible; dwell time grows with the caption; loops
 *   - prev / play / next, ←/→ while the figure has focus; stops for good once the reader acts
 * With prefers-reduced-motion: no autoplay and the last (complete) frame stays until the reader steps.
 */
import { STEPS } from "../lib/breed-step";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initBreedStep(root: HTMLElement) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";

  const captions: string[] = JSON.parse(root.querySelector("script[data-captions]")!.textContent!);
  const caption = root.querySelector<HTMLElement>("[data-caption]")!;
  const count = root.querySelector<HTMLElement>("[data-count]")!;
  const dots = [...root.querySelectorAll<HTMLElement>("[data-dot]")];
  const playBtn = root.querySelector<HTMLButtonElement>('[data-act="play"]')!;
  const last = STEPS.length - 1;

  let cur = last, timer = 0, playing = false, visible = false, touched = false;

  function show(i: number) {
    cur = (i + STEPS.length) % STEPS.length;
    root.dataset.step = STEPS[cur];
    STEPS.forEach((_, n) => root.classList.toggle(`p${n}`, n <= cur));
    caption.innerHTML = captions[cur];
    dots.forEach((d, n) => d.classList.toggle("is-on", n === cur));
    count.textContent = `${cur + 1} / ${STEPS.length}`;
  }

  const dwell = (i: number) => 2600 + captions[i].replace(/<[^>]+>/g, "").length * 38;

  function schedule() {
    clearTimeout(timer);
    if (!playing || !visible) return;
    timer = window.setTimeout(() => { show(cur + 1); schedule(); }, dwell(cur));
  }
  function setPlaying(on: boolean) {
    playing = on;
    playBtn.dataset.state = on ? "playing" : "paused";
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    if (on) schedule(); else clearTimeout(timer);
  }
  const takeOver = () => { touched = true; setPlaying(false); };

  playBtn.addEventListener("click", () => { touched = true; setPlaying(!playing); });
  root.querySelector('[data-act="prev"]')!.addEventListener("click", () => { takeOver(); show(cur - 1); });
  root.querySelector('[data-act="next"]')!.addEventListener("click", () => { takeOver(); show(cur + 1); });
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); takeOver(); show(cur + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); takeOver(); show(cur - 1); }
  });

  if (!reduced()) show(0);

  new IntersectionObserver((entries) => {
    for (const e of entries) {
      visible = e.isIntersecting;
      if (visible && !touched && !playing && root.dataset.autoplay === "true" && !reduced()) setPlaying(true);
      else if (visible) schedule();
      else clearTimeout(timer);
    }
  }, { threshold: 0.4 }).observe(root);
}
