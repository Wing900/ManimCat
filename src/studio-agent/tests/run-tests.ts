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
import { runDistributedEventTests } from './run-tests/distributed-events.test'
import { runDistributedRunCoordinationTests } from './run-tests/distributed-run-coordination.test'
import { runPersistenceTests } from './run-tests/persistence.test'
import { runSceneFoundationTests } from './run-tests/scene-foundation.test'
import { runSceneRecordTests } from './run-tests/scene-records.test'
import { runSceneRunAdmissionTests } from './run-tests/scene-run-admission.test'
import { runSceneExecutionBoundaryTests } from './run-tests/scene-execution-boundary.test'
import { runSceneEventRoutingTests } from './run-tests/scene-event-routing.test'
import { runRenderResultBridgeTests } from './run-tests/render-result-bridge.test'

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
  await runDistributedEventTests()
  await runDistributedRunCoordinationTests()
  await runPersistenceTests()
  await runSceneFoundationTests()
  await runSceneRecordTests()
  await runSceneRunAdmissionTests()
  await runSceneExecutionBoundaryTests()
  await runSceneEventRoutingTests()
  await runRenderResultBridgeTests()
  console.log('All studio-agent tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
