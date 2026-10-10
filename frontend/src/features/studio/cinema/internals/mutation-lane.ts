/**
 * One serialized mutation queue for the Cinema controller.
 *
 * Tasks run one at a time, in order, and the lane reports whether anything is queued or running so
 * the UI can show a pending state. A late task cannot overtake an earlier one, and the pending flag
 * is published through a callback so the controller owns the dispatch (the flag is a fact about the
 * lane, not about a Session generation).
 */
export class MutationLane {
  private tail: Promise<unknown> = Promise.resolve()
  private pendingCount = 0
  private readonly onChange: (pending: boolean) => void

  constructor(onChange: (pending: boolean) => void) {
    this.onChange = onChange
  }

  get pending(): boolean {
    return this.pendingCount > 0
  }

  /** Start a fresh ordering only when nothing is queued; a still-running task is allowed to drain. */
  resetWhenIdle(): void {
    if (this.pendingCount === 0) {
      this.tail = Promise.resolve()
    }
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pendingCount += 1
    this.onChange(this.pending)
    const run = this.tail.then(
      () => this.runTask(task),
      () => this.runTask(task),
    )
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private runTask<T>(task: () => Promise<T>): Promise<T> {
    return Promise.resolve()
      .then(task)
      .finally(() => {
        this.pendingCount = Math.max(0, this.pendingCount - 1)
        this.onChange(this.pending)
      })
  }
}