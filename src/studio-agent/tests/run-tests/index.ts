import { runPromptTests } from './prompt.test'
import { runLoopTests } from './loop.test'
import { runReasoningContentTests } from './reasoning-content.test'

async function main() {
  await runPromptTests()
  await runLoopTests()
  await runReasoningContentTests()
  console.log('All studio-agent tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
