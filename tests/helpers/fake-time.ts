export class FakeTime {
  constructor(private value = 0) {}

  now(): number {
    return this.value;
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError(
        "Time can only advance by a finite positive duration.",
      );
    }
    this.value += milliseconds;
  }
}
