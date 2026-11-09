/**
 * Artifact hand-off from the sandbox back to the server.
 *
 * Never read a path chosen by the renderer, and never trust a path printed on
 * stdout. The parent only accepts a known file name or scans for regular PNG
 * files, then copies verified bytes to a server-owned destination.
 */

import fs from 'node:fs'
import path from 'node:path'

const COPY_CHUNK_BYTES = 1024 * 1024
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0

export interface VerifyFileOptions {
  allowEmpty?: boolean
}

export function assertRegularNonSymlinkFile(
  candidate: string,
  label: string,
  options: VerifyFileOptions = {}
): fs.Stats {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(candidate)
  } catch {
    throw new Error(`${label} is missing: ${candidate}`)
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${candidate}`)
  }
  if (!stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${candidate}`)
  }
  if (!options.allowEmpty && stat.size === 0) {
    throw new Error(`${label} is empty: ${candidate}`)
  }
  return stat
}

/**
 * Copy a verified regular file using O_NOFOLLOW and an atomic destination
 * rename. A symlink that appears between verification and open still fails.
 */
export function copyVerifiedRegularFile(
  source: string,
  target: string,
  options: VerifyFileOptions = {}
): void {
  assertRegularNonSymlinkFile(source, 'Sandbox artifact', options)

  const sourceFd = fs.openSync(source, fs.constants.O_RDONLY | O_NOFOLLOW)
  let targetFd: number | undefined
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`

  try {
    const stat = fs.fstatSync(sourceFd)
    if (!stat.isFile()) {
      throw new Error(`Sandbox artifact is not a regular file: ${source}`)
    }
    if (!options.allowEmpty && stat.size === 0) {
      throw new Error(`Sandbox artifact is empty: ${source}`)
    }

    fs.mkdirSync(path.dirname(target), { recursive: true })
    targetFd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)

    const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES)
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(sourceFd, buffer, 0, buffer.length, null)
      if (bytesRead > 0) {
        let offset = 0
        while (offset < bytesRead) {
          offset += fs.writeSync(targetFd, buffer, offset, bytesRead - offset)
        }
      }
    } while (bytesRead > 0)

    fs.fsyncSync(targetFd)
    fs.closeSync(targetFd)
    targetFd = undefined
    fs.renameSync(temporary, target)
  } catch (error) {
    if (targetFd !== undefined) {
      try {
        fs.closeSync(targetFd)
      } catch {
        // Best effort.
      }
    }
    fs.rmSync(temporary, { force: true })
    throw error
  } finally {
    fs.closeSync(sourceFd)
  }
}

/**
 * Only regular, non-symlink PNG files in the private output directory count.
 * A PNG symlink is a hard failure rather than something to silently skip.
 */
export function listPngArtifacts(outputDirectory: string): string[] {
  const entries = fs.readdirSync(outputDirectory, { withFileTypes: true })
  const artifacts: string[] = []

  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith('.png')) continue
    const candidate = path.join(outputDirectory, entry.name)
    assertRegularNonSymlinkFile(candidate, 'Matplotlib PNG artifact')
    artifacts.push(candidate)
  }

  artifacts.sort((left, right) => left.localeCompare(right))
  return artifacts
}

/** Copy each verified PNG into the server-owned Studio output directory. */
export function publishPngArtifacts(sources: readonly string[], targetDirectory: string): string[] {
  fs.mkdirSync(targetDirectory, { recursive: true })
  return sources.map((source) => {
    const target = path.join(targetDirectory, path.basename(source))
    copyVerifiedRegularFile(source, target)
    return target
  })
}
