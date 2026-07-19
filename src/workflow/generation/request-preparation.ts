import type { ProblemFramingPlan } from '../../types'

export function normalizeGenerationConcept(concept: string): string {
  return concept.trim().replace(/\s+/g, ' ')
}

export function mergeProblemFramingPlanIntoConcept(
  concept: string,
  problemPlan?: ProblemFramingPlan,
): string {
  if (!problemPlan) {
    return concept
  }

  const steps = problemPlan.steps
    .map((step, index) => `${index + 1}. ${step.title}: ${step.content}`)
    .join('\n')

  return [
    concept,
    '',
    '[Problem Framing Context]',
    `Mode: ${problemPlan.mode}`,
    `Headline: ${problemPlan.headline}`,
    `Summary: ${problemPlan.summary}`,
    'Steps:',
    steps,
    `Visual Motif: ${problemPlan.visualMotif}`,
    `Designer Hint: ${problemPlan.designerHint}`,
  ].join('\n')
}
