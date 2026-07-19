import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractProblemFramingJson,
  normalizeProblemFramingPlan,
} from '../problem-framing/parser'

test('extracts a JSON object from a fenced model response', () => {
  assert.equal(
    extractProblemFramingJson('```json\n{"headline":"Quadratic"}\n```'),
    '{"headline":"Quadratic"}',
  )
})

test('rejects an HTML response before JSON parsing', () => {
  assert.throws(
    () => extractProblemFramingJson('<!DOCTYPE html><html><body>502</body></html>'),
    /HTML, not JSON/,
  )
})

test('normalizes aliases, trims content, limits steps, and supplies the required minimum', () => {
  const plan = normalizeProblemFramingPlan({
    mode: 'clarify',
    headline: '  Quadratic   function  ',
    summary: '  Show the vertex. ',
    steps: [
      { title: '  Step one ', content: '  Locate the axis. ' },
      { title: 'Two', content: 'Complete the square.' },
      { title: 'Three', content: 'Plot the vertex.' },
      { title: 'Four', content: 'Add the focus.' },
      { title: 'Five', content: 'Compare forms.' },
      { title: 'Six', content: 'This step must be removed.' },
    ],
    visual_motif: '  Coordinate grid ',
    designer_hint: '  Animate each transformation. ',
  }, 'en-US')

  assert.deepEqual(plan, {
    mode: 'clarify',
    headline: 'Quadratic function',
    summary: 'Show the vertex.',
    steps: [
      { title: 'Step one', content: 'Locate the axis.' },
      { title: 'Two', content: 'Complete the square.' },
      { title: 'Three', content: 'Plot the vertex.' },
      { title: 'Four', content: 'Add the focus.' },
      { title: 'Five', content: 'Compare forms.' },
    ],
    visualMotif: 'Coordinate grid',
    designerHint: 'Animate each transformation.',
  })
})

test('fills missing steps and localized fallback content', () => {
  const plan = normalizeProblemFramingPlan({ steps: [{ content: '保留的步骤' }] }, 'zh-CN')

  assert.equal(plan.mode, 'invent')
  assert.equal(plan.steps.length, 3)
  assert.deepEqual(plan.steps[0], { title: '步骤 1', content: '保留的步骤' })
  assert.deepEqual(plan.steps[2], {
    title: '步骤 3',
    content: '继续细化这一段的可视化表达和叙事顺序。',
  })
})
