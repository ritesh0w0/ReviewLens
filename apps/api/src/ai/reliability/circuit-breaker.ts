export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  readonly failureThreshold?: number; // Consecutive failures to trip (default: 3)
  readonly resetTimeoutMs?: number; // Cooldown before HALF_OPEN (default: 60000)
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 60000;
  }

  getState(): CircuitState {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
      }
    }
    return this.state;
  }

  isCallPermitted(): boolean {
    const s = this.getState();
    return s === "CLOSED" || s === "HALF_OPEN";
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }
}
