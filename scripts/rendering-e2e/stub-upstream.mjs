#!/usr/bin/env node
/**
 * Deterministic OpenAI-compatible upstream for rendered acceptance tests.
 * It is test-only: it never talks to a real provider and contains no credentials.
 */
import http from 'node:http'

const PORT = Number(process.env.PR10_STUB_PORT || process.argv[2] || 19001)
const HOST = process.env.PR10_STUB_HOST || '0.0.0.0'
const MODEL = 'pr10-stub'

const VIDEO_CODE = [
  'from manimgx import *',
  '',
  'class MainScene(Scene):',
  '    def construct(self):',
  '        self.add(Dot())',
  '        self.wait(0.2)',
].join('\n')

const NARRATED_CODE = [
  'from manimgx import *',
  '',
  'class MainScene(Scene):',
  '    def construct(self):',
  '        self.cue("c1")',
  '        self.add(Dot())',
  '        self.wait(0.2)',
  '        self.narration_end()',
].join('\n')

const EDITED_CODE = [
  'from manimgx import *',
  '',
  'class MainScene(Scene):',
  '    def construct(self):',
  '        self.add(Square())',
  '        self.wait(0.2)',
].join('\n')

const BROKEN_CODE = [
  'from manimgx import *',
  '',
  'class MainScene(Scene):',
  '    def construct(self):',
  '        raise RuntimeError("PR10_RETRY")',
].join('\n')

const IMAGE_CODE = [
  '### YON_IMAGE_1_START ###',
  'from manimgx import *',
  '',
  'class MainScene(Scene):',
  '    def construct(self):',
  '        self.add(Dot())',
  '### YON_IMAGE_1_END ###',
].join('\n')

const ISOLATION_CODE = [
  'import os',
  'import socket',
  'from manimgx import *',
  '',
  'def check_isolation():',
  "    assert not os.path.exists('/etc/passwd'), 'host /etc/passwd is visible'",
  "    assert not os.path.exists('/app/package.json'), 'host app tree is visible'",
  "    assert os.environ.get('PR10_HOST_SECRET') is None, 'host environment secret leaked'",
  '    try:',
  "        with open('/input/blocked.txt', 'w') as handle:",
  "            handle.write('blocked')",
  '    except OSError:',
  '        pass',
  '    else:',
  "        raise AssertionError('/input is writable')",
  '    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
  '    probe.settimeout(1)',
  '    try:',
  "        probe.connect(('127.0.0.1', 19001))",
  '    except OSError:',
  '        pass',
  '    else:',
  "        raise AssertionError('sandbox reached the host fixture port')",
  '    finally:',
  '        probe.close()',
  '',
  'check_isolation()',
  '',
  'class MainScene(Scene):',
  '    def construct(self):',
  '        self.add(Dot())',
  '        self.wait(0.2)',
].join('\n')

const PLOT_CODE = [
  'import matplotlib.pyplot as plt',
  'plt.figure()',
  'plt.plot([0, 1], [0, 1])',
].join('\n')

const HOSTILE_PLOT_CODE = [
  'import os',
  "os.symlink('/input/plot_script.py', 'plot_1.png')",
].join('\n')

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
      return ''
    }).join('\n')
  }
  return ''
}

function messageTexts(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const systems = messages.filter(m => m.role === 'system').map(m => textOf(m.content)).join('\n')
  const users = messages.filter(m => m.role === 'user').map(m => textOf(m.content)).join('\n')
  const hasToolResult = messages.some(m => m.role === 'tool')
  return { systems, users, hasToolResult }
}

function design(narration) {
  const cuePlan = narration
    ? '\n<cue_plan>{"segments":[{"id":"s1","visuals":"A single dot is shown.","teaching":{"learningGoal":"See the dot.","narrationDraft":"This dot is the complete picture.","visualEvidence":"A dot on screen."},"cues":[{"id":"c1","meaning":"The dot appears.","action":"Show the dot."}]}]}</cue_plan>'
    : ''
  return [
    '<design>',
    'Key point: a dot.',
    'Stage: one dot.',
    'Object animation: show the dot.',
    'Transition: none.',
    cuePlan,
    '</design>',
  ].join('\n')
}

function planResponse(body) {
  const { systems, users, hasToolResult } = messageTexts(body)
  const tools = Array.isArray(body?.tools) ? body.tools : []
  const renderTool = tools.find(t => t?.function?.name === 'render')

  // Studio tool loop: one render call, then a final assistant message.
  if (renderTool && !hasToolResult) {
    const props = renderTool.function?.parameters?.properties ?? {}
    const isManim = Object.hasOwn(props, 'outputMode')
    const code = isManim
      ? (users.includes('IMAGE') ? IMAGE_CODE : VIDEO_CODE)
      : (users.includes('hostile') ? HOSTILE_PLOT_CODE : PLOT_CODE)
    const args = isManim
      ? { concept: 'PR10 Studio Manim', code, outputMode: 'video', quality: 'low' }
      : { concept: 'PR10 Studio Matplotlib', code }
    return { kind: 'tool', name: 'render', args }
  }
  if (renderTool && hasToolResult) {
    return { kind: 'text', content: 'The render completed.' }
  }

  if (systems.includes('Repair the current Manim code')) {
    return {
      kind: 'text',
      content: [
        '[[PATCH]]',
        '[[SEARCH]]',
        '        raise RuntimeError("PR10_RETRY")',
        '[[REPLACE]]',
        '        self.add(Dot())',
        '        self.wait(0.2)',
        '[[END]]',
      ].join('\n'),
    }
  }

  if (systems.includes('# narration')) {
    return {
      kind: 'text',
      content: JSON.stringify({
        segments: [{ id: 's1', text: '[[c1]] Hello from the deterministic narrator.' }],
      }),
    }
  }

  if (systems.includes('# code-generation')) {
    if (users.includes('PR10_ISOLATION')) return { kind: 'text', content: `### START ###\n${ISOLATION_CODE}\n### END ###` }
    if (users.includes('PR10_RETRY')) return { kind: 'text', content: `### START ###\n${BROKEN_CODE}\n### END ###` }
    if (/Output mode:\s*image/i.test(users)) return { kind: 'text', content: IMAGE_CODE }
    if (users.includes('旁白同步已开启') || users.includes('narrationCuePlan')) {
      return { kind: 'text', content: `### START ###\n${NARRATED_CODE}\n### END ###` }
    }
    return { kind: 'text', content: `### START ###\n${VIDEO_CODE}\n### END ###` }
  }

  if (systems.includes('constrained Manim code editor')) {
    return { kind: 'text', content: `### START ###\n${EDITED_CODE}\n### END ###` }
  }

  if (systems.includes('# concept-designer')) {
    return { kind: 'text', content: design(users.includes('<cue_plan>')) }
  }

  return { kind: 'text', content: 'ok' }
}

function chunkBase(id) {
  return { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: MODEL }
}

function usage() {
  return { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
}

function sendJson(res, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function completionPayload(plan, stream) {
  const id = `chatcmpl-${Date.now()}`
  if (plan.kind === 'tool') {
    const toolCall = {
      index: 0,
      id: 'call_pr10',
      type: 'function',
      function: { name: plan.name, arguments: JSON.stringify(plan.args) },
    }
    if (!stream) {
      return {
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [toolCall] }, finish_reason: 'tool_calls' }],
        usage: usage(),
      }
    }
    return [
      { ...chunkBase(id), choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ ...toolCall, index: 0 }] }, finish_reason: null }] },
      { ...chunkBase(id), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      { ...chunkBase(id), choices: [], usage: usage() },
    ]
  }
  if (!stream) {
    return {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content: plan.content }, finish_reason: 'stop' }],
      usage: usage(),
    }
  }
  return [
    { ...chunkBase(id), choices: [{ index: 0, delta: { role: 'assistant', content: plan.content }, finish_reason: null }] },
    { ...chunkBase(id), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { ...chunkBase(id), choices: [], usage: usage() },
  ]
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, { ok: true })
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: 'not found' } }))
  }
  let raw = ''
  req.setEncoding('utf8')
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch { /* keep empty */ }
    const plan = planResponse(body)
    if (!body.stream) {
      return sendJson(res, completionPayload(plan, false))
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    for (const chunk of completionPayload(plan, true)) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

server.listen(PORT, HOST, () => {
  console.log(`PR10 stub upstream listening on ${HOST}:${PORT}`)
})
