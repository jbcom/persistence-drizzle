/**
 * A first-in, first-out async lock. One SQLite connection runs one statement stream: every statement, transaction and
 * foreign writer (persistence-save's snapshot saves) takes this lock, so two writers can never interleave inside a
 * transaction or flush half of one to the web store.
 */
export interface Lock {
  /** Run `task` once every earlier holder has finished. Rejections pass through and release the lock. */
  run<T>(task: () => Promise<T>): Promise<T>
  /** Whether a task holds the lock right now. */
  readonly held: boolean
}

export function createLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve()
  let holders = 0
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const next = tail.then(async () => {
        holders += 1
        try {
          return await task()
        } finally {
          holders -= 1
        }
      })
      // The queue continues past a failure; the caller still sees it.
      tail = next.catch(() => undefined)
      return next
    },
    get held() {
      return holders > 0
    },
  }
}
