import { runCredentialsTests } from './run-tests/credentials.test'
import { runRecordTokenUsageTests } from './run-tests/record-token-usage.test'
import { runResolveAccessContextTests } from './run-tests/resolve-access-context.test'

async function main() {
  await runCredentialsTests()
  await runResolveAccessContextTests()
  await runRecordTokenUsageTests()
  console.log('All access tests passed')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
