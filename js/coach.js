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
 * One short coaching message from the two signed errors (%).
 *  - Arithmetic should be exact: more than 1% away from your own reading is a slip.
 *  - A reading within ±3% is about as good as a reticle allows (0.1 MIL on a
 *    3+ MIL target); beyond that, say which way it was off and what that did.
 *  - When both are off, lead with whichever caused more of the miss.
 */
export function classifyMistake(readingErrorPct, mathErrorPct) {
  const reading = Math.abs(readingErrorPct);
  const maths = Math.abs(mathErrorPct);
  const readingOk = reading <= 3;
  const mathsOk = maths <= 1;
  const readingTip = readingErrorPct > 0
    ? 'You read the target too big, which puts your answer too close.'
    : 'You read the target too small, which puts your answer too far.';
  const mathsTip = 'Check the arithmetic: size in mm ÷ MIL reading = metres.';

  if (readingOk && mathsOk) return 'Good reading and correct arithmetic.';
  if (readingOk) return `Your reading was good. ${mathsTip}`;
  if (mathsOk) return `Your arithmetic was right; the reading was off by ${reading.toFixed(0)}%. ${readingTip}`;
  return reading >= maths
    ? `Mostly the reading (${reading.toFixed(0)}% off). ${readingTip} The arithmetic was also ${maths.toFixed(0)}% off.`
    : `Mostly the arithmetic (${maths.toFixed(0)}% off). ${mathsTip} The reading was also ${reading.toFixed(0)}% off.`;
}
