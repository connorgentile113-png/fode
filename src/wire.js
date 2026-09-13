import { Transform } from 'node:stream';
export const MAX_FRAME = 900_000;
export function encode(value) {
  const body = Buffer.from(JSON.stringify(value));
  if (body.length > MAX_FRAME) throw new Error('Message exceeds 900 KB');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
export class Decoder extends Transform {
  constructor() { super({readableObjectMode: true}); this.buffer = Buffer.alloc(0); }
  _transform(chunk, _, done) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const size = this.buffer.readUInt32LE();
        if (size > MAX_FRAME) throw new Error('Oversized frame');
        if (this.buffer.length < size + 4) break;
        this.push(JSON.parse(this.buffer.subarray(4, 4 + size).toString()));
        this.buffer = this.buffer.subarray(4 + size);
      }
      done();
    } catch (error) { done(error); }
  }
  _flush(done) { done(this.buffer.length ? new Error('Truncated frame') : null); }
}
