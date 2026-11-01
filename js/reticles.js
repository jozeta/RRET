/* ==========================================================================
   Reticle catalogue. The designs, their scale legends and help text all live in
   js/reticle-designs.js, so the drawing, the readout and the help can't drift.
   ========================================================================== */

import { RETICLE_CATALOG } from './reticle-designs.js';

export async function loadReticles() {
  return RETICLE_CATALOG;
}
