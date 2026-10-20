/** Bounded streaming decoder for Wire.Reply. Copies fragmented payloads once,
 * rather than concatenating the entire frame for every stdout chunk. */
export class NativeResponseDecoder {
  private header = Buffer.alloc(8);
  private headerBytes = 0;
  private payload?: Buffer;
  private payloadBytes = 0;
  private error = 0;
  constructor(private readonly limit = 32 * 1024 * 1024) {}

  push(chunk: Buffer, consume: (error: number, payload: Buffer) => void) {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.payload) {
        const count = Math.min(8 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count);
        offset += count; this.headerBytes += count;
        if (this.headerBytes !== 8) continue;
        const length = this.header.readUInt32LE(4);
        if (length > this.limit) throw Error('Invalid native response');
        this.error = this.header.readUInt32LE(0);
        this.payload = Buffer.allocUnsafe(length);
      }
      const count = Math.min(this.payload.length - this.payloadBytes, chunk.length - offset);
      chunk.copy(this.payload, this.payloadBytes, offset, offset + count);
      offset += count; this.payloadBytes += count;
      if (this.payloadBytes === this.payload.length) {
        const payload = this.payload, error = this.error;
        this.reset(); consume(error, payload);
      }
    }
  }

  reset() { this.headerBytes = 0; this.payload = undefined; this.payloadBytes = 0; }
}
