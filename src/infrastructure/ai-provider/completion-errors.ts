/** A generation limit is deterministic; replaying the same request cannot reserve answer tokens. */
export class CompletionTokenLimitError extends Error {
  constructor(input: { model: string; maxTokens?: number; reasoningEffort?: string | null }) {
    super(
      `AI generation exhausted its total token limit (${input.maxTokens ?? 'unknown'} tokens, reasoning_effort=${input.reasoningEffort ?? 'provider-default'}, model=${input.model}). Increase the total token limit or select a lower reasoning effort.`,
    )
    this.name = 'CompletionTokenLimitError'
  }
}
