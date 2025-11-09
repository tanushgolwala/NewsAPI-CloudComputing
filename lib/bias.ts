export const BIAS_ALERT_THRESHOLD = 0.6;

export function isBiasFlagged(value: number | null | undefined): boolean {
  return typeof value === "number" && value < BIAS_ALERT_THRESHOLD;
}
