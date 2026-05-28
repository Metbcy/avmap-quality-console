/** Packs bits MSB-first into a byte array. */
export class BitWriter {
  private buf: number[] = [];
  private cur = 0;
  private filled = 0;

  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >>> i) & 1);
      this.filled++;
      if (this.filled === 8) {
        this.buf.push(this.cur & 0xff);
        this.cur = 0;
        this.filled = 0;
      }
    }
  }

  /** Flushes remaining bits (zero-padded to next byte boundary). */
  toBytes(): Uint8Array {
    const out = [...this.buf];
    if (this.filled > 0) {
      out.push((this.cur << (8 - this.filled)) & 0xff);
    }
    return new Uint8Array(out);
  }
}

/** Reads bits MSB-first from a byte array. */
export class BitReader {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  read(bits: number): number {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      const byteIdx = (this.pos / 8) | 0;
      const bitIdx = 7 - (this.pos % 8);
      result = (result << 1) | ((this.bytes[byteIdx] >>> bitIdx) & 1);
      this.pos++;
    }
    return result;
  }

  readSigned(bits: number): number {
    const n = this.read(bits);
    return n >= (1 << (bits - 1)) ? n - (1 << bits) : n;
  }

  get byteOffset(): number {
    return (this.pos / 8) | 0;
  }
}
