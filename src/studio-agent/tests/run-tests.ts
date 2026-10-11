import { runPromptTests } from './run-tests/prompt.test'
import { runLoopTests } from './run-tests/loop.test'
import { runReasoningContentTests } from './run-tests/reasoning-content.test'
import { runModeAndToolTests } from './run-tests/mode-and-tools.test'
import { runSecurityTests } from './run-tests/security.test'
import { runAgentLoopTests } from './run-tests/agent-loop.test'
import { runApiRagTests } from './run-tests/api-rag.test'
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
import { runSessionDeleteTests } from './run-tests/session-delete.test'
import { runCachedStudioReadsTests } from './run-tests/cached-studio-reads.test'
import { runBufferedConversationTests } from './run-tests/buffered-conversations.test'
import { runRunLivenessSweeperTests } from './run-tests/run-liveness-sweeper.test'
import { runConversationSeedTests } from './run-tests/conversation-seed.test'
import { runRenderCancellationTests } from './run-tests/render-cancellation.test'
import { runRenderMediaHandoffTests } from './run-tests/render-media-handoff.test'
import { runSceneSourceMaterializationTests } from './run-tests/scene-source-materialization.test'
import { runStudioWorkspaceCleanupTests } from './run-tests/studio-workspace-cleanup.test'

async function main() {
  await runPromptTests()
  await runLoopTests()
  await runReasoningContentTests()
  await runModeAndToolTests()
  await runSecurityTests()
  await runAgentLoopTests()
  await runApiRagTests()
  await runRenderMediaHandoffTests()
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
  await runSessionDeleteTests()
  await runCachedStudioReadsTests()
  await runBufferedConversationTests()
  await runRunLivenessSweeperTests()
  await runConversationSeedTests()
  await runSceneSourceMaterializationTests()
  await runRenderCancellationTests()
  await runStudioWorkspaceCleanupTests()
  console.log('All studio-agent tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
