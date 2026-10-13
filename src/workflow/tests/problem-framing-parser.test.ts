import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractProblemFramingJson,
  normalizeProblemFramingPlan,
  parseProblemFramingResponse,
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

test('normalizes aliases and preserves all steps up to twelve', () => {
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
      { title: 'Six', content: 'This step must be preserved.' },
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
      { title: 'Six', content: 'This step must be preserved.' },
    ],
    visualMotif: 'Coordinate grid',
    designerHint: 'Animate each transformation.',
  })
})

test('parses all twelve tagged steps and every expanded design field without truncation', () => {
  const fields = '<question>为什么？</question><answer>因为几何约束。</answer><audience>初中</audience><background_rules>定长</background_rules><selected_route>勾股</selected_route><alternative_routes>不用求导</alternative_routes><out_of_scope>摩擦</out_of_scope><special_cases>避开竖直</special_cases>'
  const steps = Array.from({ length: 12 }, (_, i) => `<step><phase>derivation</phase><title>${i + 1}</title><content>点亮第${i + 1}条线。</content></step>`).join('')
  const plan = parseProblemFramingResponse(`<plan><mode>clarify</mode><headline>梯子</headline><summary>解释变慢</summary>${fields}<steps>${steps}</steps><visual_motif>梯子</visual_motif><designer_hint>90秒</designer_hint></plan>`, 'zh-CN')
  assert.equal(plan.steps.length, 12)
  assert.equal(plan.steps[11].content, '点亮第12条线。')
  assert.equal(plan.steps[11].phase, 'derivation')
  assert.equal(plan.question, '为什么？')
  assert.equal(plan.backgroundRules, '定长')
  assert.equal(plan.specialCases, '避开竖直')
})

test('rejects thirteen steps rather than silently dropping the ending', () => {
  assert.throws(() => normalizeProblemFramingPlan({ headline: '标题', summary: '摘要', steps: Array.from({ length: 13 }, () => ({ title: '一步', content: '动作' })) }, 'zh-CN'), /at most 12/)
})

test('default generation contract requires expanded fields while legacy reading stays supported', () => {
  const legacy = JSON.stringify({ headline: '标题', summary: '摘要', steps: Array.from({ length: 3 }, () => ({ title: '一步', content: '动作' })) })
  assert.equal(parseProblemFramingResponse(legacy, 'zh-CN').steps.length, 3)
  assert.throws(() => parseProblemFramingResponse(legacy, 'zh-CN', true), /Expanded plan requires question/)
})

test('rejects partial expanded decisions and unknown phases', () => {
  const base = { headline: '标题', summary: '摘要', steps: Array.from({ length: 3 }, () => ({ title: '一步', content: '动作' })) }
  assert.throws(() => normalizeProblemFramingPlan({ ...base, question: '为什么？' }, 'zh-CN'), /answer/)
  assert.throws(() => normalizeProblemFramingPlan({ ...base, steps: base.steps.map(step => ({ ...step, phase: 'wrong' })) }, 'zh-CN'), /Step phase/)
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
