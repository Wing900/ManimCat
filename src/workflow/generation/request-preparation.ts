import type { ProblemFramingPlan } from '../../types'

export function normalizeGenerationConcept(concept: string): string {
  return concept.trim().replace(/\s+/g, ' ')
}

export function formatProblemFramingPlan(problemPlan?: ProblemFramingPlan): string {
  if (!problemPlan) return ''
  const steps = problemPlan.steps
    .map((step, index) => `${index + 1}. ${step.phase ? `[${step.phase}] ` : ''}${step.title}: ${step.content}`)
    .join('\n')

  return [
    `Mode: ${problemPlan.mode}`,
    `Headline: ${problemPlan.headline}`,
    `Summary: ${problemPlan.summary}`,
    ...Object.entries({
      Question: problemPlan.question, Answer: problemPlan.answer, Audience: problemPlan.audience,
      'Background rules': problemPlan.backgroundRules, 'Selected route': problemPlan.selectedRoute,
      'Alternative routes': problemPlan.alternativeRoutes, 'Out of scope': problemPlan.outOfScope,
      'Special cases': problemPlan.specialCases,
    }).filter(([, value]) => value !== undefined).map(([label, value]) => `${label}: ${value}`),
    'Steps:',
    steps,
    `Visual Motif: ${problemPlan.visualMotif}`,
    `Designer Hint: ${problemPlan.designerHint}`,
  ].join('\n')
}
