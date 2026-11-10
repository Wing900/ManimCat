/**
 * One strict parser for image-mode code. Native cloud rendering and the browser
 * prepared payload both use it, so block order, duplicates and stray code cannot
 * diverge between the two render targets.
 *
 * Image mode is a sequence of independent, self-contained scenes: each YON_IMAGE
 * block is cleaned and rendered on its own. Nothing outside the anchors is code.
 */

export const MAX_IMAGE_BLOCKS = 24;
export const MAX_IMAGE_SOURCE_BYTES = 1024 * 1024;
export const MAX_IMAGE_BLOCK_INDEX = 999_999;

export interface ImageCodeBlock {
  /** The number in the YON_IMAGE anchor. */
  index: number
  /** The trim()ed source inside the matching END anchor. */
  code: string
}

const BLOCK_PATTERN = /###\s*YON_IMAGE_(\d+)_START\s*###([\s\S]*?)###\s*YON_IMAGE_\1_END\s*###/g;
const BLOCK_MARKER = /###\s*YON_IMAGE_/;

export function parseImageCodeBlocks(code: string): ImageCodeBlock[] {
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new Error('No YON_IMAGE code blocks were found');
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_IMAGE_SOURCE_BYTES) {
    throw new Error(
      `Image mode source exceeds ${MAX_IMAGE_SOURCE_BYTES} bytes`,
    );
  }

  BLOCK_PATTERN.lastIndex = 0;
  const blocks: ImageCodeBlock[] = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = BLOCK_PATTERN.exec(code)) !== null) {
    const index = Number(match[1]);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > MAX_IMAGE_BLOCK_INDEX
    ) {
      throw new Error(`Image block index ${match[1]} is invalid`);
    }
    if (seen.has(index)) {
      throw new Error(`Image mode contains duplicate YON_IMAGE block ${index}`);
    }
    const blockCode = match[2].trim();
    if (!blockCode) {
      throw new Error(`Image block ${index} is empty`);
    }
    if (BLOCK_MARKER.test(blockCode)) {
      throw new Error('Nested YON_IMAGE blocks are not allowed');
    }
    seen.add(index);
    blocks.push({ index, code: blockCode });
  }

  if (blocks.length === 0) {
    throw new Error('No YON_IMAGE code blocks were found');
  }
  if (blocks.length > MAX_IMAGE_BLOCKS) {
    throw new Error(`Image mode has more than ${MAX_IMAGE_BLOCKS} blocks`);
  }

  BLOCK_PATTERN.lastIndex = 0;
  const remaining = code.replace(BLOCK_PATTERN, '').trim();
  if (remaining.length > 0) {
    throw new Error('Image mode only accepts code inside YON_IMAGE blocks');
  }

  blocks.sort((a, b) => a.index - b.index);
  return blocks;
}
