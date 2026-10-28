// Prepares an image file for embedding in a PDF.
// pdf-lib can embed PNG and JPEG only, so anything else (WebP, GIF, BMP, SVG, AVIF…) is
// converted to PNG. JPEGs with an EXIF rotation are re-encoded so they are not sideways.

function sniffType(bytes, fallback) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return fallback || '';
}

function jpegOrientation(b) {
  try {
    let off = 2;
    while (off + 4 < b.length && b[off] === 0xff) {
      const marker = b[off + 1];
      const len = (b[off + 2] << 8) | b[off + 3];
      if (marker === 0xe1 && b[off + 4] === 0x45 && b[off + 5] === 0x78 && b[off + 6] === 0x69 && b[off + 7] === 0x66) {
        const tiff = off + 10;
        const little = b[tiff] === 0x49;
        const u16 = (o) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
        const u32 = (o) =>
          little
            ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
            : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
        const ifd = tiff + u32(tiff + 4);
        const count = u16(ifd);
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          if (u16(entry) === 0x0112) return u16(entry + 8);
        }
        return 1;
      }
      if (marker === 0xda) break;
      off += 2 + len;
    }
  } catch {
    /* ignore malformed EXIF */
  }
  return 1;
}

async function decode(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('could not read this image');
  } finally {
    // the decoded bitmap stays valid after the URL is revoked
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export async function prepareImage(file) {
  const raw = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(raw, file.type);
  if (!type.startsWith('image/')) throw new Error('not an image');

  const img = await decode(new Blob([raw], { type }));
  const nw = img.naturalWidth || 300;
  const nh = img.naturalHeight || 300;

  let bytes = raw;
  let mime = type;
  const usable = type === 'image/png' || (type === 'image/jpeg' && jpegOrientation(raw) <= 1);

  if (!usable) {
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    mime = type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, nw, nh);
    }
    ctx.drawImage(img, 0, 0, nw, nh);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
    if (!blob) throw new Error('could not convert this image');
    bytes = new Uint8Array(await blob.arrayBuffer());
  }

  return { name: file.name, bytes, mime, nw, nh, url: URL.createObjectURL(new Blob([bytes], { type: mime })) };
}
