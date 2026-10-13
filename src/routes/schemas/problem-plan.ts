import { z } from 'zod'

/** Shared request contract for creating and refining a planning card. */
export const problemPlanSchema = z.object({
  mode: z.enum(['clarify', 'invent']),
  headline: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  steps: z.array(z.object({
    title: z.string().trim().min(1),
    content: z.string().trim().min(1),
    phase: z.enum(['background', 'phenomenon', 'derivation', 'closing']).optional(),
  })).min(3).max(12),
  visualMotif: z.string(),
  designerHint: z.string(),
  question: z.string().trim().min(1).optional(),
  answer: z.string().trim().min(1).optional(),
  audience: z.string().trim().min(1).optional(),
  backgroundRules: z.string().trim().min(1).optional(),
  selectedRoute: z.string().trim().min(1).optional(),
  alternativeRoutes: z.string().trim().min(1).optional(),
  outOfScope: z.string().trim().min(1).optional(),
  specialCases: z.string().trim().min(1).optional(),
}).superRefine((plan, context) => {
  const fields = ['question', 'answer', 'audience', 'backgroundRules', 'selectedRoute', 'alternativeRoutes', 'outOfScope', 'specialCases'] as const
  if (fields.some(field => plan[field] !== undefined)) {
    for (const field of fields) if (plan[field] === undefined) context.addIssue({ code: 'custom', path: [field], message: 'Expanded plans must preserve all design decisions' })
  }
})
