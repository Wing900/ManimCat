import { runPromptTests } from './run-tests/prompt.test'
import { runLoopTests } from './run-tests/loop.test'
import { runReasoningContentTests } from './run-tests/reasoning-content.test'
import { runModeAndToolTests } from './run-tests/mode-and-tools.test'
import { runSecurityTests } from './run-tests/security.test'
import { runAgentLoopTests } from './run-tests/agent-loop.test'

async function main() {
  await runPromptTests()
  await runLoopTests()
  await runReasoningContentTests()
  await runModeAndToolTests()
  await runSecurityTests()
  await runAgentLoopTests()
  console.log('All studio-agent tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
