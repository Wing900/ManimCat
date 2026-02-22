import type { TestResult } from './types';

interface TestResultBannerProps {
  testResult: TestResult;
}

export function TestResultBanner({ testResult }: TestResultBannerProps) {
  if (testResult.status === 'idle') {
    return null;
  }

  return (
    <div
      className={`rounded-2xl text-sm ${
        testResult.status === 'success'
          ? 'bg-green-50 dark:bg-green-900/20'
          : testResult.status === 'testing'
            ? 'bg-blue-50 dark:bg-blue-900/20'
            : 'bg-red-50 dark:bg-red-900/20'
      }`}
    >
      <div
        className={`p-4 ${
          testResult.status === 'success'
            ? 'text-green-600 dark:text-green-400'
            : testResult.status === 'testing'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-red-600 dark:text-red-400'
        }`}
      >
        {testResult.status === 'testing' ? (
          <div className="flex items-center gap-2">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>{testResult.message}</span>
          </div>
        ) : (
          <span>{testResult.message}</span>
        )}
      </div>
    </div>
  );
}
