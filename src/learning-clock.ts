import { AsyncLocalStorage } from 'node:async_hooks'

export type LearningClock = () => Date
const clocks = new AsyncLocalStorage<LearningClock>()

/** Request/job scoped learning time. Authentication expiry and network deadlines use wall time. */
export function learningNow(): Date {
  const value = clocks.getStore()?.() ?? new Date()
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid learning clock.')
  return new Date(value.getTime())
}

/** Dependency injection only: no request parameter, route or environment variable can set time. */
export function withLearningClock<T>(clock: LearningClock | undefined, work: () => T): T {
  return clocks.run(clock ?? (() => new Date()), work)
}
