import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { run } from '../support/fakes'
import {
  deriveOwnerId,
  hashCatKey,
  isBrowserSecretCredential,
  isCatKeyCredential
} from '../../domain/credentials'

/** A credential of the right shape: prefix + 64 lowercase hex characters. */
function credentialOf(prefix: 'mc_' | 'byok_'): string {
  return `${prefix}${'a1b2c3d4'.repeat(8)}`
}

export async function runCredentialsTests(): Promise<void> {
  await run('a CatKey is exactly the prefix plus 64 lowercase hex characters', async () => {
    assert.equal(isCatKeyCredential(credentialOf('mc_')), true)

    assert.equal(isCatKeyCredential(`mc_${'a'.repeat(63)}`), false, '63 hex is too short')
    assert.equal(isCatKeyCredential(`mc_${'a'.repeat(65)}`), false, '65 hex is too long')
    assert.equal(isCatKeyCredential(`mc_${'A'.repeat(64)}`), false, 'uppercase hex must not pass')
    assert.equal(isCatKeyCredential(`mc_${'g'.repeat(64)}`), false, 'non-hex must not pass')
    assert.equal(isCatKeyCredential(`MC_${'a'.repeat(64)}`), false, 'the prefix is case-sensitive')
    assert.equal(isCatKeyCredential(`byok_${'a'.repeat(64)}`), false, 'a BYOK secret is not a CatKey')
    assert.equal(isCatKeyCredential(''), false)
  })

  await run('a browser secret is exactly the prefix plus 64 lowercase hex characters', async () => {
    assert.equal(isBrowserSecretCredential(credentialOf('byok_')), true)

    assert.equal(isBrowserSecretCredential(`byok_${'a'.repeat(63)}`), false)
    assert.equal(isBrowserSecretCredential(`byok_${'a'.repeat(65)}`), false)
    assert.equal(isBrowserSecretCredential(`byok_${'A'.repeat(64)}`), false)
    assert.equal(isBrowserSecretCredential(`mc_${'a'.repeat(64)}`), false, 'a CatKey is not a browser secret')
  })

  await run('the stored CatKey hash is the full sha256 of the plaintext', async () => {
    const credential = credentialOf('mc_')
    const expected = createHash('sha256').update(credential).digest('hex')

    assert.equal(hashCatKey(credential), expected)
    assert.equal(hashCatKey(credential).length, 64, 'the hash is stored whole')
    assert.notEqual(hashCatKey(credential), credential, 'the plaintext is never the stored value')
  })

  await run('the owner id derivation stays byte-identical to the pre-migration one', async () => {
    // Studio rows written before this module existed are keyed by sha256(token).slice(0, 32).
    // If this ever changes, every Session created before the migration becomes unreachable.
    for (const credential of [credentialOf('mc_'), credentialOf('byok_'), 'legacy-opaque-key']) {
      const expected = createHash('sha256').update(credential).digest('hex').slice(0, 32)

      assert.equal(deriveOwnerId(credential), expected)
      assert.equal(deriveOwnerId(credential).length, 32)
    }
  })

  await run('the owner id derivation trims surrounding whitespace', async () => {
    const credential = credentialOf('mc_')

    assert.equal(deriveOwnerId(`  ${credential}  `), deriveOwnerId(credential))
  })
}
