/* ==========================================================================
   Coach mode diagnostics (FEAT-003)
   Splits a wrong distance into "misread the reticle" vs "did the maths wrong",
   which a single distance error can't tell apart.
   ========================================================================== */

import { calculateMIL } from './utils.js';

/**
 * @param {object} scenario  { target: {height,width}, distance (m) }
 * @param {number} userMil   the MIL value the user says they read
 * @param {number} estimateMeters the distance the user entered, in meters
 * @returns {null|{dimension:'height'|'width', trueMil:number, userMil:number,
 *   readingErrorPct:number, impliedMeters:number, mathErrorPct:number, verdict:string|null}}
 */
export function diagnoseEstimate(scenario, userMil, estimateMeters) {
  if (!scenario || !(userMil > 0) || !(estimateMeters > 0)) return null;
  const { target, distance } = scenario;
  const milH = calculateMIL(target.height, distance);
  const milW = calculateMIL(target.width, distance);

  // The user may have milled either dimension; assume the one their reading is closest to.
  const useHeight = Math.abs(userMil - milH) / milH <= Math.abs(userMil - milW) / milW;
  const dimension = useHeight ? 'height' : 'width';
  const trueMil = useHeight ? milH : milW;
  const size = useHeight ? target.height : target.width;

  // Reading error: how far the user's MIL reading is from the true subtension.
  const readingErrorPct = ((userMil - trueMil) / trueMil) * 100;
  // Maths error: the user's distance vs what THEIR OWN reading implies.
  const impliedMeters = (size * 1000) / userMil;
  const mathErrorPct = ((estimateMeters - impliedMeters) / impliedMeters) * 100;

  return {
    dimension,
    trueMil,
    userMil,
    readingErrorPct,
    impliedMeters,
    mathErrorPct,
    verdict: classifyMistake(readingErrorPct, mathErrorPct)
  };
}

/**
 * Turns the two signed error percentages into one short coaching message shown
 * under the result, e.g. "Reading was good — check your arithmetic."
 *
 * Return a string, or null to show only the raw numbers.
 *
 * TODO(you): decide the thresholds and wording. Things to weigh:
 *  - Reading error is a reticle skill: ±0.1 MIL on a 1 MIL target is already 10%,
 *    so a "good" reading threshold probably needs to be looser than for maths.
 *  - Maths error should be ~0% with a calculator; anything over ~1% is a slip.
 *  - Sign matters for reading: positive = read the target too big (answer too
 *    close), negative = too small (answer too far). Is that worth saying?
 *  - Both can be wrong at once; which one should the message lead with?
 */
export function classifyMistake(readingErrorPct, mathErrorPct) {
  return null;
}
