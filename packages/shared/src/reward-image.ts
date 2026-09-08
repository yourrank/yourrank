export const REWARD_IMAGE_MAX_BYTES = 180 * 1024;
export const REWARD_IMAGE_MAX_EDGE = 960;

/** Accept only bounded, static WebP bytes produced by the image editor. */
export function validateRewardImage(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !value.startsWith('data:image/webp;base64,') || value.length > REWARD_IMAGE_MAX_BYTES * 4 / 3 + 32) throw new Error('Choose an optimized WebP image under 180 KB.');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(value.slice(23)), c => c.charCodeAt(0)); } catch { throw new Error('Invalid image. Choose the file again.'); }
  const text = (start: number, size: number) => String.fromCharCode(...bytes.slice(start, start + size));
  const u24 = (i: number) => bytes[i] + (bytes[i + 1] << 8) + (bytes[i + 2] << 16);
  if (bytes.length < 30 || bytes.length > REWARD_IMAGE_MAX_BYTES || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WEBP') throw new Error('Invalid WebP image.');
  const view = new DataView(bytes.buffer);
  if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error('Incomplete WebP image.');
  let width = 0, height = 0, canvasWidth = 0, canvasHeight = 0, frames = 0;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Incomplete WebP image.');
    const kind = text(offset, 4), size = view.getUint32(offset + 4, true), start = offset + 8;
    const next = start + size + (size % 2);
    if (next > bytes.length) throw new Error('Incomplete WebP image.');
    if (kind === 'VP8X') {
      if (offset !== 12 || size !== 10 || (bytes[start] & 2)) throw new Error('Choose a static image.');
      canvasWidth = u24(start + 4) + 1; canvasHeight = u24(start + 7) + 1;
    } else if (kind === 'VP8 ') {
      if (size <= 10 || (bytes[start] & 1) || text(start + 3, 3) !== '\x9d\x01\x2a') throw new Error('Invalid WebP frame.');
      width = view.getUint16(start + 6, true) & 16383; height = view.getUint16(start + 8, true) & 16383; frames++;
    } else if (kind === 'VP8L') {
      if (size <= 5 || bytes[start] !== 47 || (bytes[start + 4] & 224)) throw new Error('Invalid WebP frame.');
      const bits = view.getUint32(start + 1, true); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; frames++;
    } else if (!['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(kind)) throw new Error('Choose a static WebP image.');
    offset = next;
  }
  if (frames !== 1 || (canvasWidth && (canvasWidth !== width || canvasHeight !== height))) throw new Error('Invalid WebP image.');
  if (!width || !height || width > REWARD_IMAGE_MAX_EDGE || height > REWARD_IMAGE_MAX_EDGE) throw new Error('Image must be static and at most 960 pixels per side.');
  return value;
}
