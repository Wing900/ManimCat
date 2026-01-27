import express from 'express'

import { SYSTEM_PROMPTS, generateConceptDesignerPrompt, generateCodeGenerationPrompt } from '../prompts'
import { CODE_RETRY_SYSTEM_PROMPT, buildInitialCodePrompt } from '../services/code-retry/prompts'
import { buildRetryFixPrompt } from '../services/code-retry/manager'
import type { PromptOverrides } from '../types'

const router = express.Router()

const PLACEHOLDERS = {
  concept: '{{concept}}',
  seed: '{{seed}}',
  sceneDesign: '{{sceneDesign}}',
  errorMessage: '{{errorMessage}}',
  attempt: '{{attempt}}'
}

function buildDefaultPromptTemplates(): PromptOverrides {
  return {
    system: {
      conceptDesigner: SYSTEM_PROMPTS.conceptDesigner,
      codeGeneration: SYSTEM_PROMPTS.codeGeneration,
      codeRetry: CODE_RETRY_SYSTEM_PROMPT
    },
    user: {
      conceptDesigner: generateConceptDesignerPrompt(PLACEHOLDERS.concept, PLACEHOLDERS.seed),
      codeGeneration: generateCodeGenerationPrompt(PLACEHOLDERS.concept, PLACEHOLDERS.seed, PLACEHOLDERS.sceneDesign),
      codeRetryInitial: buildInitialCodePrompt(PLACEHOLDERS.concept, PLACEHOLDERS.seed, PLACEHOLDERS.sceneDesign),
      codeRetryFix: buildRetryFixPrompt(PLACEHOLDERS.concept, PLACEHOLDERS.errorMessage, PLACEHOLDERS.attempt)
    }
  }
}

router.get('/prompts/defaults', (_req, res) => {
  res.json(buildDefaultPromptTemplates())
})

export default router
