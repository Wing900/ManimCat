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

test('normalizes aliases, trims content, and limits steps to five', () => {
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

test('rejects an incomplete plan instead of inventing its content', () => {
  assert.throws(
    () => normalizeProblemFramingPlan({ steps: [{ content: '保留的步骤' }] }, 'zh-CN'),
    /missing required content: headline, summary/,
  )

  assert.throws(
    () => normalizeProblemFramingPlan({
      headline: '标题',
      summary: '摘要',
      steps: [
        { title: '甲', content: '乙' },
        { title: '丙', content: '丁' },
      ],
    }, 'zh-CN'),
    /at least 3 complete steps \(received 2\)/,
  )

  // A step with a title but no content is not a complete step: three of them stay three short.
  assert.throws(
    () => normalizeProblemFramingPlan({
      headline: '标题',
      summary: '摘要',
      steps: [{ title: '甲' }, { title: '乙' }, { title: '丙' }],
    }, 'zh-CN'),
    /at least 3 complete steps \(received 0\)/,
  )
})

test('keeps a complete plan intact', () => {
  const plan = normalizeProblemFramingPlan({
    mode: 'invent',
    headline: '标题',
    summary: '摘要',
    steps: [
      { title: '甲', content: '乙' },
      { title: '丙', content: '丁' },
      { title: '戊', content: '己' },
    ],
  }, 'zh-CN')

  assert.deepEqual(plan.steps, [
    { title: '甲', content: '乙' },
    { title: '丙', content: '丁' },
    { title: '戊', content: '己' },
  ])
  assert.equal(plan.headline, '标题')
  assert.equal(plan.summary, '摘要')
})
