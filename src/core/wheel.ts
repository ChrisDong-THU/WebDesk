type WheelDelta = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>;

// Browser deltas are pixels, lines or pages, while the host protocol expects
// wheel detents (the Windows adapter multiplies each detent by WHEEL_DELTA=120).
// These are UX defaults, not a claim that browsers expose physical notches.
const PIXELS_PER_DETENT = 100, LINES_PER_DETENT = 3, MAX_DETENTS = 3;

export function createWheelNormalizer() {
  let remainderX = 0, remainderY = 0;
  function axis(delta: number, scale: number, remainder: number): [number, number] {
    if (!Number.isFinite(delta)) return [0, 0];
    const units = Math.max(-MAX_DETENTS, Math.min(MAX_DETENTS, delta * scale)) * 120 + remainder;
    const whole = Math.trunc(units);
    // Preserve sub-unit touchpad motion instead of rounding each tiny event up
    // or down. Never retain the discarded portion of an oversized event.
    return [whole / 120, units - whole];
  }
  return {
    normalize(event: WheelDelta) {
      // Read deltaMode first: some browsers adapt delta values after this read.
      const mode = event.deltaMode;
      const scale = mode === 0 ? 1 / PIXELS_PER_DETENT : mode === 1 ? 1 / LINES_PER_DETENT : mode === 2 ? MAX_DETENTS : 0;
      let deltaX: number, deltaY: number;
      [deltaX, remainderX] = axis(event.deltaX, scale, remainderX);
      [deltaY, remainderY] = axis(event.deltaY, scale, remainderY);
      return { deltaX, deltaY };
    },
    reset() { remainderX = 0; remainderY = 0; },
  };
}
