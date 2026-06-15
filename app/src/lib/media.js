export async function createCoverPhotoFromFile(file, { maxSide = 320, quality = 0.82 } = {}) {
  if (!file) return null;

  const cover = {
    name: file.name,
    size: file.size,
    type: file.type,
  };

  if (!file.type?.startsWith('image/')) return cover;

  try {
    const dataUrl = await fileToDataUrl(file);
    const thumbDataUrl = await resizeImageDataUrl(dataUrl, { maxSide, quality, mimeType: normalizeMimeType(file.type) });
    return { ...cover, thumbDataUrl };
  } catch {
    return cover;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function resizeImageDataUrl(dataUrl, { maxSide, quality, mimeType }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * ratio));
      const height = Math.max(1, Math.round(img.height * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not create canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL(mimeType, quality));
    };
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = dataUrl;
  });
}

function normalizeMimeType(type) {
  if (type === 'image/png') return 'image/png';
  if (type === 'image/webp') return 'image/webp';
  return 'image/jpeg';
}
