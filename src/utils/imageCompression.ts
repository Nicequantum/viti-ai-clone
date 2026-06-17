export async function compressImageForUpload(file: File, maxDim = 1600, quality = 0.72): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const img = await loadImage(file);
  try {
    let { width, height } = img;
    if (Math.max(width, height) <= maxDim && file.size < 900_000) {
      return file;
    }
    if (Math.max(width, height) > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToJpegBlob(canvas, quality);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (e) {
    console.warn('Image compression failed, uploading original', e);
    return file;
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to compress image'))),
      'image/jpeg',
      quality
    );
  });
}