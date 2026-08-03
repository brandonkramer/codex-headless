import { createRng, seedFromString } from "./stats.ts";
import type { TrialOrder } from "./types.ts";

export interface RepeatPlan {
  repeatIndex: number;
  order: TrialOrder;
  /** control first when AB, treatment first when BA */
  sequence: ("control" | "treatment")[];
}

export interface BenchmarkSchedule {
  seed: number;
  repeats: RepeatPlan[];
}

/**
 * Build AB/BA randomized schedule for paired repeats.
 * Each repeat runs both arms sequentially in randomized order.
 */
export function buildAbBaSchedule(trialsPerArm: number, seedMaterial: string): BenchmarkSchedule {
  const seed = seedFromString(seedMaterial);
  const rng = createRng(seed);
  const repeats: RepeatPlan[] = [];

  for (let i = 0; i < trialsPerArm; i++) {
    const abFirst = rng() < 0.5;
    const order: TrialOrder = abFirst ? "AB" : "BA";
    repeats.push({
      repeatIndex: i,
      order,
      sequence: abFirst ? ["control", "treatment"] : ["treatment", "control"],
    });
  }

  return { seed, repeats };
}

/** Flatten schedule into ordered arm runs for logging / dry-run. */
export function flattenSchedule(schedule: BenchmarkSchedule): Array<{
  repeatIndex: number;
  arm: "control" | "treatment";
  order: TrialOrder;
  sequenceInBlock: number;
}> {
  const flat: Array<{
    repeatIndex: number;
    arm: "control" | "treatment";
    order: TrialOrder;
    sequenceInBlock: number;
  }> = [];

  for (const repeat of schedule.repeats) {
    repeat.sequence.forEach((arm, idx) => {
      flat.push({
        repeatIndex: repeat.repeatIndex,
        arm,
        order: repeat.order,
        sequenceInBlock: idx,
      });
    });
  }
  return flat;
}
