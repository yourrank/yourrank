import { expect, it } from 'bun:test';
import { validateRewardImage } from '../reward-image';
const encode = (bytes: Uint8Array) => 'data:image/webp;base64,' + Buffer.from(bytes).toString('base64');
it('allows explicit removal and rejects foreign formats or oversized input', () => {
  expect(validateRewardImage(null)).toBeNull();
  expect(validateRewardImage('')).toBeNull();
  for (const value of ['data:image/svg+xml;base64,PHN2Zy8+', 'https://example.com/a.png', 'data:image/webp;base64,???', 'data:image/webp;base64,' + 'a'.repeat(250000)]) expect(() => validateRewardImage(value)).toThrow();
});
it('rejects a canvas header without a frame, animated headers and broken chunk lengths', () => {
  const bytes = new Uint8Array(30);
  bytes.set(Buffer.from('RIFF'), 0); bytes.set(Buffer.from('WEBPVP8X'), 8);
  const view = new DataView(bytes.buffer); view.setUint32(4, 22, true); view.setUint32(16, 10, true);
  expect(() => validateRewardImage(encode(bytes))).toThrow();
  bytes[20] = 2;
  expect(() => validateRewardImage(encode(bytes))).toThrow();
  bytes[20] = 0; view.setUint32(16, 1000, true);
  expect(() => validateRewardImage(encode(bytes))).toThrow();
});
