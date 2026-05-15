'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-800">문제가 발생했습니다</h2>
      <p className="max-w-lg text-sm text-slate-600 dark:text-slate-600">
        {error.message || '예기치 않은 오류입니다. 잠시 후 다시 시도해 주세요.'}
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-slate-400 dark:text-slate-400">ID: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
      >
        다시 시도
      </button>
    </div>
  )
}
