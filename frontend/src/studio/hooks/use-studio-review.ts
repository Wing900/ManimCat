import { selectReviewViewModel } from '../store/studio-selectors'
import type { StudioWorkResult } from '../protocol/studio-agent-types'

export function useStudioReview(result: StudioWorkResult | null) {
  return selectReviewViewModel(result)
}
