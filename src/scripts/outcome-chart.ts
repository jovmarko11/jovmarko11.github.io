/**
 * outcome-chart.ts — the hover layer of <OutcomeChart>: a crosshair that snaps to the nearest
 * generation in both plots and one tooltip with every series. Works with the pointer and, while
 * the chart has focus, with ←/→ (Shift = 10 generations).
 */
const W = 720, L = 40, R = 118; // must match OutcomeChart.astro

export function initOutcomeChart(root: HTMLElement) {
  if (root.dataset.ready) return;
  root.dataset.ready = "1";

  const rows: [number, number, number, number, number | null][] = JSON.parse(root.querySelector("script[data-rows]")!.textContent!);
  const n = rows.length;
  const plot = root.querySelector<HTMLElement>(".oc__plot")!;
  const svgs = [...root.querySelectorAll<SVGSVGElement>("[data-svg]")];
  const crosses = [...root.querySelectorAll<SVGLineElement>("[data-cross]")];
  const tip = root.querySelector<HTMLElement>("[data-tip]")!;
  const tipG = root.querySelector<HTMLElement>("[data-tip-g]")!;
  const tipV = new Map([...root.querySelectorAll<HTMLElement>("[data-tip-v]")].map((e) => [Number(e.dataset.tipV), e]));
  const xOf = (g: number) => L + ((W - L - R) * g) / (n - 1);
  let cur = -1;

  function show(g: number) {
    cur = Math.max(0, Math.min(n - 1, g));
    const r = rows[cur];
    const x = xOf(cur);
    crosses.forEach((c) => { c.setAttribute("x1", String(x)); c.setAttribute("x2", String(x)); });
    root.classList.add("is-hover");
    tipG.textContent = `generation ${r[0]}`;
    tipV.get(1)!.textContent = String(r[1]);
    tipV.get(2)!.textContent = String(r[2]);
    tipV.get(3)!.textContent = String(r[3]);
    tipV.get(4)!.textContent = r[4] === null ? "did not reach" : String(r[4]);
    tip.hidden = false;
    // place the tooltip beside the crosshair, flipping to the left near the right edge
    const box = svgs[0].getBoundingClientRect(), pbox = plot.getBoundingClientRect();
    const px = box.left - pbox.left + (x / W) * box.width;
    const tw = tip.offsetWidth;
    const left = px + 12 + tw > pbox.width ? px - 12 - tw : px + 12;
    tip.style.transform = `translate(${Math.max(0, left)}px, ${box.height * 0.18}px)`;
  }
  function hide() { root.classList.remove("is-hover"); tip.hidden = true; }

  svgs.forEach((svg) => {
    svg.addEventListener("pointermove", (e) => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      show(Math.round(((p.x - L) / (W - L - R)) * (n - 1)));
    });
    svg.addEventListener("pointerleave", hide);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const d = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1);
    show(cur < 0 ? (d > 0 ? 0 : n - 1) : cur + d);
  });
  root.addEventListener("blur", hide);
}
