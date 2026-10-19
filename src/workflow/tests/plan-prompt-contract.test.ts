import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoleSystemPrompt, getRoleUserPrompt } from '../../prompts/loader'
import { formatProblemFramingPlan } from '../generation/request-preparation'
import { buildRetryPrompt } from '../code-retry/prompt-builder'
import { problemPlanSchema } from '../../routes/schemas/problem-plan'
import { generateSceneDesignStage } from '../concept-design/scene-design-stage'
import { generateCodeFromDesignStage } from '../concept-design/code-from-design-stage'
import type OpenAI from 'openai'
import type { ProblemFramingPlan } from '../../types'

const plan: ProblemFramingPlan = {
  mode: 'clarify', headline: '梯子', summary: '等时位移', question: '为什么变慢？', answer: '位移递减。',
  audience: '初中', backgroundRules: '定长和匀速', selectedRoute: '勾股相减', alternativeRoutes: '不采用微积分',
  outOfScope: '摩擦', specialCases: '避开竖直', visualMotif: '同一梯子', designerHint: '90秒',
  steps: Array.from({ length: 12 }, (_, i) => ({ title: `步骤${i + 1}`, content: `动作${i + 1}。`, phase: 'derivation' })),
}

test('request schema retains all decisions and twelve steps', () => {
  assert.deepEqual(problemPlanSchema.parse(plan), plan)
  assert.equal(problemPlanSchema.safeParse({ ...plan, steps: [...plan.steps, plan.steps[0]] }).success, false)
  assert.equal(problemPlanSchema.safeParse({ ...plan, answer: undefined }).success, false)
})

test('actual generation stages send all Plan fields without merging them into the task', async () => {
  const requests: Array<{ messages: Array<{ content: unknown }> }> = []
  const client = { chat: { completions: { create: async (request: { messages: Array<{ content: unknown }> }) => {
    requests.push(request)
    const content = requests.length === 1 ? '<design>分镜覆盖步骤1至12</design>' : '### START ###\nfrom manim import *\nclass MainScene(Scene):\n    def construct(self):\n        pass\n### END ###'
    return (async function* () { yield { choices: [{ delta: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } })()
  } } } } as unknown as OpenAI
  const design = await generateSceneDesignStage({ client, concept: '原始需求', problemPlan: plan, outputMode: 'video', model: 'fixture', designerTemperature: 0, designerMaxTokens: 100, designerThinkingTokens: 0 })
  await generateCodeFromDesignStage({ client, concept: '原始需求', problemPlan: plan, sceneDesign: design, outputMode: 'video', model: 'fixture', coderTemperature: 0, maxTokens: 100, thinkingTokens: 0 })
  assert.equal(requests.length, 2)
  for (const request of requests) {
    const user = String(request.messages[1].content)
    assert.ok(user.includes('动作12。'))
    assert.ok(user.includes('Selected route: 勾股相减'))
    assert.ok(!user.includes('[Problem Framing Context]'))
  }
  assert.ok(String(requests[1].messages[1].content).includes('分镜覆盖步骤1至12'))
})

test('complete Plan reaches designer, coder and repair in both locales exactly once', () => {
  const formatted = formatProblemFramingPlan(plan)
  for (const locale of ['zh-CN', 'en-US'] as const) {
    for (const role of ['conceptDesigner', 'codeGeneration'] as const) {
      const prompt = getRoleUserPrompt(role, { concept: '原始需求', plan: formatted, sceneDesign: '分镜内容', outputMode: 'video', isVideo: true }, { locale })
      assert.ok(prompt.includes('12. [derivation] 步骤12: 动作12。'))
      assert.ok(prompt.includes('Selected route: 勾股相减'))
      assert.equal(prompt.split('Question: 为什么变慢？').length - 1, 1)
      assert.ok(!prompt.includes('{{plan}}'))
    }
    const repair = buildRetryPrompt({ concept: '原始需求', problemPlan: plan, sceneDesign: '分镜内容', outputMode: 'video', promptOverrides: { locale } }, '错误', 1, '代码')
    assert.ok(repair.includes('动作12。'))
    assert.ok(repair.includes('分镜内容'))
  }
})

test('custom older prompt cannot accidentally omit Plan or retry storyboard', () => {
  const prompt = buildRetryPrompt({ concept: '原始需求', problemPlan: plan, sceneDesign: '分镜内容', outputMode: 'video', promptOverrides: { roles: { codeRetry: { user: 'Fix {{code}} for {{concept}}' } } } }, '错误', 1, '代码')
  assert.ok(prompt.includes('动作12。'))
  assert.ok(prompt.includes('分镜内容'))
})

test('no-plan generation has no empty Plan block and keeps locale/style safeguards', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const prompt = getRoleUserPrompt('codeGeneration', { concept: '需求', sceneDesign: '分镜', outputMode: 'image', isImage: true }, { locale })
    assert.ok(!prompt.includes('Plan ('))
    assert.ok(prompt.includes('YON_IMAGE'))
    const system = getRoleSystemPrompt('codeGeneration', { locale })
    assert.ok(system.includes('rate_func=linear'))
    assert.ok(system.includes('MathTypst'))
    assert.ok(system.includes('#FFF9F0'))
  }
})
