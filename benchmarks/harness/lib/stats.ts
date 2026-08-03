import type { DistributionSummary } from "./types.ts";

/** Deterministic mulberry32 PRNG from a numeric seed. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function quantile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sortedAsc[base]!;
  const hi = sortedAsc[base + 1] ?? lo;
  return lo + rest * (hi - lo);
}

export function summarizeDistribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0]!,
    q1: quantile(sorted, 0.25),
    median: median(sorted),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
  };
}

/** Relative improvement: (control - treatment) / control. Positive = treatment faster/cheaper. */
export function medianImprovement(control: readonly number[], treatment: readonly number[]): number {
  const c = median(control);
  const t = median(treatment);
  if (c === 0) return t === 0 ? 0 : -1;
  return (c - t) / c;
}

export interface BootstrapMedianDiffOptions {
  control: readonly number[];
  treatment: readonly number[];
  resamples?: number;
  seed: number;
  /** When true, estimate control - treatment median difference (positive = treatment lower). */
  paired?: boolean;
}

/**
 * Bootstrap 95% CI on median difference (control − treatment).
 * Unpaired: resample each arm independently (different lengths OK).
 * Paired: requires equal length; diff per index.
 */
export function bootstrapMedianDiffCi(opts: BootstrapMedianDiffOptions): {
  pointEstimate: number;
  lower: number;
  upper: number;
  resamples: number;
} {
  const resamples = opts.resamples ?? 2000;
  const rng = createRng(opts.seed);
  const diffs: number[] = [];

  if (opts.paired) {
    if (opts.control.length !== opts.treatment.length || opts.control.length === 0) {
      return { pointEstimate: 0, lower: 0, upper: 0, resamples: 0 };
    }
    const pairedDiffs = opts.control.map((c, i) => c - opts.treatment[i]!);
    const pointEstimate = median(pairedDiffs);
    for (let r = 0; r < resamples; r++) {
      const sample: number[] = [];
      for (let i = 0; i < pairedDiffs.length; i++) {
        const idx = Math.floor(rng() * pairedDiffs.length);
        sample.push(pairedDiffs[idx]!);
      }
      diffs.push(median(sample));
    }
    diffs.sort((a, b) => a - b);
    return {
      pointEstimate,
      lower: quantile(diffs, 0.025),
      upper: quantile(diffs, 0.975),
      resamples,
    };
  }

  const pointEstimate = median(opts.control) - median(opts.treatment);
  const cArr = [...opts.control];
  const tArr = [...opts.treatment];
  if (cArr.length === 0 || tArr.length === 0) {
    return { pointEstimate: 0, lower: 0, upper: 0, resamples: 0 };
  }

  for (let r = 0; r < resamples; r++) {
    const cSample: number[] = [];
    const tSample: number[] = [];
    for (let i = 0; i < cArr.length; i++) {
      cSample.push(cArr[Math.floor(rng() * cArr.length)]!);
    }
    for (let i = 0; i < tArr.length; i++) {
      tSample.push(tArr[Math.floor(rng() * tArr.length)]!);
    }
    diffs.push(median(cSample) - median(tSample));
  }
  diffs.sort((a, b) => a - b);
  return {
    pointEstimate,
    lower: quantile(diffs, 0.025),
    upper: quantile(diffs, 0.975),
    resamples,
  };
}

/** Relative improvement CI from absolute median-diff CI (approx via control median scale). */
export function relativeImprovementFromDiffCi(
  controlMedian: number,
  diffCi: { pointEstimate: number; lower: number; upper: number },
): { point: number; lower: number; upper: number } {
  if (controlMedian === 0) {
    return { point: 0, lower: 0, upper: 0 };
  }
  return {
    point: diffCi.pointEstimate / controlMedian,
    lower: diffCi.lower / controlMedian,
    upper: diffCi.upper / controlMedian,
  };
}

export function okRate(okFlags: readonly boolean[]): number {
  if (okFlags.length === 0) return 0;
  return okFlags.filter(Boolean).length / okFlags.length;
}
