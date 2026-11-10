/**
 * Incremental read-only inspector for ManimGX take streams.
 *
 * The pinned engine writes each message as a little-endian u32 length (the bytes
 * after the length), an opcode byte, then fields. SOUND (op 10) carries a WAV as
 * a u32-length byte string. We keep only the current message prefix, never the
 * whole take, and copy only the SOUND payload so the player can still consume the
 * original bytes. This observes what the take actually contains; it does not
 * verify a native decode, which the pinned engine does not expose. It is also not
 * an attestation: scene Python can reach the worker's send callback and inject
 * feed bytes.
 */

const OP_SOUND = 10;
const OP_END = 12;
const MAX_MESSAGE_BYTES = 96 * 1024 * 1024;
const MAX_PENDING_BYTES = MAX_MESSAGE_BYTES + 4096;
const MAX_SOUND_BYTES = 64 * 1024 * 1024;

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

export class TakeInspector {
  #parts: Uint8Array[] = [];
  #offset = 0;
  #available = 0;
  #need = -1;
  #sound: Uint8Array | null = null;
  #soundCount = 0;
  #ended = false;
  #disabled: string | null = null;

  push(chunk: Uint8Array): void {
    if (this.#disabled !== null || this.#ended || chunk.byteLength === 0) return;
    this.#parts.push(chunk);
    this.#available += chunk.byteLength;
    if (this.#available > MAX_PENDING_BYTES) {
      this.#disable('the take stream exceeded the inspection buffer');
      return;
    }
    this.#parse();
  }

  get sound(): Uint8Array | null {
    return this.#sound;
  }

  get soundCount(): number {
    return this.#soundCount;
  }

  get disabledReason(): string | null {
    return this.#disabled;
  }

  #parse(): void {
    for (;;) {
      if (this.#need < 0) {
        if (this.#available < 4) return;
        const length = this.#read(0, 4);
        const messageBytes = readU32(length, 0);
        if (messageBytes < 1 || messageBytes > MAX_MESSAGE_BYTES) {
          this.#disable('a take message length is invalid');
          return;
        }
        this.#need = 4 + messageBytes;
      }
      if (this.#available < this.#need) return;
      const op = this.#read(4, 1)[0];
      if (op === OP_SOUND) {
        if (this.#need < 9) {
          this.#disable('a SOUND message is too short');
          return;
        }
        const lengthBytes = this.#read(5, 4);
        const payloadLength = readU32(lengthBytes, 0);
        if (payloadLength === 0 || payloadLength > MAX_SOUND_BYTES) {
          this.#disable('a SOUND payload has an invalid length');
          return;
        }
        if (9 + payloadLength > this.#need) {
          this.#disable('a SOUND payload exceeds its message');
          return;
        }
        this.#sound = this.#read(9, payloadLength);
        this.#soundCount += 1;
      }
      const ended = op === OP_END;
      this.#consume(this.#need);
      this.#need = -1;
      if (ended) {
        // The take is complete; nothing after END can change its SOUND.
        this.#ended = true;
        this.#parts = [];
        this.#offset = 0;
        this.#available = 0;
        return;
      }
    }
  }

  #read(globalOffset: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let written = 0;
    // globalOffset is relative to the first unconsumed byte, which may sit in the
    // middle of parts[0]. Skipping only globalOffset would re-read bytes that
    // #consume already advanced past when a previous message shared this chunk.
    let skipped = this.#offset + globalOffset;
    for (const part of this.#parts) {
      if (skipped >= part.byteLength) {
        skipped -= part.byteLength;
        continue;
      }
      const start = skipped;
      skipped = 0;
      const take = Math.min(length - written, part.byteLength - start);
      out.set(part.subarray(start, start + take), written);
      written += take;
      if (written === length) break;
    }
    if (written !== length) {
      throw new Error('take inspector read past its buffered bytes');
    }
    return out;
  }

  #consume(length: number): void {
    let left = length;
    while (left > 0) {
      const first = this.#parts[0];
      if (!first) throw new Error('take inspector consumed past its buffered bytes');
      const remaining = first.byteLength - this.#offset;
      if (left >= remaining) {
        left -= remaining;
        this.#parts.shift();
        this.#offset = 0;
      } else {
        this.#offset += left;
        left = 0;
      }
    }
    this.#available -= length;
  }

  #disable(reason: string): void {
    this.#disabled = reason;
    this.#parts = [];
    this.#offset = 0;
    this.#available = 0;
    this.#need = -1;
  }
}
