/** Center-crops a picked photo to a square and downsizes it to a JPEG, so uploads stay small and avatars stay sharp. */
export async function squareImage(file: File, size = 512): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That image couldn’t be opened. Try a JPEG or PNG.');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(size, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('That image couldn’t be opened.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('That image couldn’t be opened.'))), 'image/jpeg', 0.88),
  );
}
