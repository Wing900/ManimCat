import { runPromptTests } from './run-tests/prompt.test'
import { runLoopTests } from './run-tests/loop.test'
import { runReasoningContentTests } from './run-tests/reasoning-content.test'
import { runModeAndToolTests } from './run-tests/mode-and-tools.test'
import { runSecurityTests } from './run-tests/security.test'
import { runAgentLoopTests } from './run-tests/agent-loop.test'
import { runKnowledgeTests } from './run-tests/knowledge.test'
import { runMatplotlibKnowledgeTests } from './run-tests/matplotlib-knowledge.test'
import { runStaticCheckTests } from './run-tests/static-check.test'
import { runTokenUsageTests } from './run-tests/token-usage.test'
import { runPersistenceTests } from './run-tests/persistence.test'

async function main() {
  await runPromptTests()
  await runLoopTests()
  await runReasoningContentTests()
  await runModeAndToolTests()
  await runSecurityTests()
  await runAgentLoopTests()
  await runKnowledgeTests()
  await runMatplotlibKnowledgeTests()
  await runStaticCheckTests()
  await runTokenUsageTests()
  await runPersistenceTests()
  console.log('All studio-agent tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
