/**
 * project-art — registry of per-project header illustrations.
 * The key is what a project's front-matter sets in `art:` (see ARTS in content/schema.ts).
 * To add one: create the component here, add the key to ARTS, map it below.
 */
import ParseLayers from "./ParseLayers.astro";
import EvolutionLoop from "./EvolutionLoop.astro";
import type { Art } from "../../content/schema";

export const PROJECT_ART: Record<Art, { component: typeof ParseLayers | typeof EvolutionLoop; props?: Record<string, unknown> }> = {
  "parse-layers": { component: ParseLayers, props: { variant: "compact" } },
  "evolution-loop": { component: EvolutionLoop },
};
