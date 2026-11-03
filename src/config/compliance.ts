// C8-1: the compliance thresholds, in one place (Rory's answer Q1, 3 November
// 2026). They are Studio's own defaults, chosen for the demo and changeable
// here; none of them is any ad platform's published policy (rule 1). The
// rules that read them are in src/lib/compliance/rules.ts.

export const COMPLIANCE = {
  /**
   * Clear space around the logo, as a share of the ad's shorter side, from
   * every edge of the canvas and from every word. At least `pass` passes;
   * from `review` up to `pass` needs a person's look; below `review`, or
   * touching words, fails.
   */
  logoClearSpace: { pass: 0.04, review: 0.02 },
  /**
   * How much of a social ad the words cover (each drawn line's box, as a share
   * of the canvas). Up to `pass` passes; up to `fail` needs a look; above it
   * fails. Not applied to banners (Q2): their words naturally fill them.
   */
  textDensity: { pass: 0.25, fail: 0.4 },
  /**
   * Contrast that passes AA by less than this share of its threshold (4.5:1
   * for words, 3:1 for large text and the button's edge) needs a look: within
   * 10% above, so 4.5 to 4.95:1 for words.
   */
  contrastMargin: 0.1,
  /**
   * 9:16 stories: the platforms' own controls cover the top and bottom of the
   * screen. No words or logo in the top `top` or bottom `bottom` of the
   * height; within `near` of either band needs a look (Q7).
   */
  platformZones: { top: 0.14, bottom: 0.2, near: 0.04 },
  /** A note on a decision is cut to this many characters. */
  noteMax: 500,
} as const;
