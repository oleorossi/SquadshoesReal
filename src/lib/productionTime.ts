/**
 * Production time calculation utilities
 */

interface TimeCalculationParams {
  pairs: number;
  minutesPerPair: number;
  numWorkers: number;
  efficiency: number; // e.g. 0.85 for 85%
}

/**
 * Calculate production hours for a stage given pairs, SAM, workers and efficiency.
 * Returns hours per worker needed.
 */
export function calculateProductionHours({
  pairs,
  minutesPerPair,
  numWorkers,
  efficiency,
}: TimeCalculationParams): number {
  if (numWorkers === 0 || efficiency === 0) return 0;

  const totalMinutesNeeded = (pairs * minutesPerPair) / efficiency;
  const minutesPerWorker = totalMinutesNeeded / numWorkers;

  return Number((minutesPerWorker / 60).toFixed(2));
}

/**
 * Calculate working days from hours using a configurable daily journey.
 */
export function hoursToWorkingDays(hours: number, journeyHours = 8.8): number {
  if (journeyHours === 0) return 0;
  return Math.ceil(hours / journeyHours);
}
