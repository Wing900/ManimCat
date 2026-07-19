import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeProblemFramingPlanIntoConcept,
  normalizeGenerationConcept,
} from '../generation/request-preparation'

test('normalizes whitespace before queue submission', () => {
  assert.equal(
    normalizeGenerationConcept('  explain\n\n  a   quadratic function  '),
    'explain a quadratic function',
  )
})

test('preserves a concept when no problem framing plan exists', () => {
  assert.equal(
    mergeProblemFramingPlanIntoConcept('Explain vectors'),
    'Explain vectors',
  )
})

test('serializes the complete problem framing plan into a stable queue concept', () => {
  assert.equal(
    mergeProblemFramingPlanIntoConcept('Explain vectors', {
      mode: 'clarify',
      headline: 'Vector addition',
      summary: 'Build head-to-tail intuition.',
      steps: [
        { title: 'Place', content: 'Place the first vector.' },
        { title: 'Add', content: 'Place the second vector head-to-tail.' },
      ],
      visualMotif: 'Grid',
      designerHint: 'Animate displacement.',
    }),
    [
      'Explain vectors',
      '',
      '[Problem Framing Context]',
      'Mode: clarify',
      'Headline: Vector addition',
      'Summary: Build head-to-tail intuition.',
      'Steps:',
      '1. Place: Place the first vector.',
      '2. Add: Place the second vector head-to-tail.',
      'Visual Motif: Grid',
      'Designer Hint: Animate displacement.',
    ].join('\n'),
  )
})
