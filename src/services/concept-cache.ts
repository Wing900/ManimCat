/**
 * Concept Cache Service
 * Utility functions for concept caching and hash generation
 */

import crypto from 'crypto'

/**
 * Normalize concept for consistent caching
 * - Lowercase
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Remove punctuation variations
 */
export function normalizeConcept(concept: string): string {
  return concept
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:'"]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Generate a hash for normalized concept
 * Used as cache key for exact matching
 */
export function generateConceptHash(concept: string, quality: string): string {
  const normalized = normalizeConcept(concept)
  return crypto
    .createHash('sha256')
    .update(`${normalized}:${quality}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Check if caching is enabled via environment
 */
export function isCachingEnabled(): boolean {
  return process.env.DISABLE_CONCEPT_CACHE !== 'true'
}
