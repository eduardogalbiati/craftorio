// A refactor's success measured on the architecture map (#357): its target's quadrant and Danger Zone
// score before the run (kept on the proposal when it joins the roadmap) against the same after the
// run. `quadrantOf` names a model quadrant ('Danger Zone', packages/shared/architecture-model.js QUADRANTS)
// as the outcome stores it ('danger-zone'); `fileScore` reads a file's { quadrant, score } from the
// facts' model. leftDangerZoneCount gives the Refactor tab's header its 30 / 90-day counts.

'use strict';

const DANGER_ZONE = 'danger-zone';
const DAY_MS = 24 * 3600e3;
const UNMEASURED = 'unmeasured';

/** A model quadrant ('Danger Zone', 'Healthy Closure'…) as the outcome stores it ('danger-zone'…), null when not measured. */
const quadrantOf = (q) => (q ? String(q).trim().toLowerCase().replace(/\s+/g, '-') : null);

/** The `{ quadrant, score }` of `file` in an architecture model (score 0 and quadrant 'unmeasured' when not measured, #435), or null without a model. */
function fileScore(model, file) {
  if (!model || !file) return null;
  const row = (model.files || []).find((r) => r.file === file);
  return { quadrant: quadrantOf(row?.quadrant) || UNMEASURED, score: Number(row?.score) || 0 };
}

/** Whether the target left the Danger Zone, how much its score dropped, and whether it improved at all. */
function refactorOutcome(before, after) {
  const leftDangerZone = before?.quadrant === DANGER_ZONE && after?.quadrant !== DANGER_ZONE;
  const scoreDrop = (Number(before?.score) || 0) - (Number(after?.score) || 0);
  return { leftDangerZone, scoreDrop, improved: leftDangerZone || scoreDrop > 0 };
}

/** How many proposals' targets left the Danger Zone within the last `days` before `now`. */
function leftDangerZoneCount(proposals, now = new Date(), days = 30) {
  const from = new Date(now).getTime() - days * DAY_MS;
  return (proposals || []).filter((p) => p?.outcome?.leftDangerZone && Date.parse(p.outcome.at) >= from).length;
}

module.exports = {
  DANGER_ZONE,
  fileScore,
  leftDangerZoneCount,
  quadrantOf,
  refactorOutcome,
};
