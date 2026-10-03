import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vitest runs without `globals: true` here, so Testing Library never registers its implicit
// auto-cleanup. Registering it once in the shared setup keeps every React spec isolated without
// forcing each file to remember `cleanup()`. Resource cleanup (timers, stubs, event sources) stays
// owned by each fixture; this only unmounts the rendered trees.
afterEach(() => {
  cleanup()
})
