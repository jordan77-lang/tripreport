import { putMediaRecord } from './mediaStore';

export async function createPhotoMediaFromFile(file, tripId, {
  maxThumbSide = 600,
  maxFullSide = 1600,
  thumbQuality = 0.82,
  fullQuality = 0.85,
} = {}) {
  if (!file || !tripId) throw new Error('A trip and image file are required');

  const id = crypto.randomUUID();
  const mime = normalizeMimeType(file.type);
  const meta = {
    id,
    tripId,
    name: file.name,
    mime,
    size: file.size,
    syncState: 'pending',
    storagePath: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  let thumbBlob = null;
  let fullBlob = null;

  if (file.type?.startsWith('image/')) {
    const dataUrl = await fileToDataUrl(file);
    const thumbDataUrl = await resizeImageDataUrl(dataUrl, { maxSide: maxThumbSide, quality: thumbQuality, mimeType: mime });
    thumbBlob = await dataUrlToBlob(thumbDataUrl);
    const fullDataUrl = await resizeImageDataUrl(dataUrl, { maxSide: maxFullSide, quality: fullQuality, mimeType: mime });
    fullBlob = await dataUrlToBlob(fullDataUrl);
  } else {
    fullBlob = file;
  }

  await putMediaRecord({ ...meta, thumbBlob, fullBlob });

  return {
    id,
    name: file.name,
    mime,
    size: file.size,
    syncState: 'pending',
  };
}

/** Preview before trip exists — returns { previewUrl, file } for wizard UI. */
export function createCoverPhotoPreview(file) {
  if (!file) return null;
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    type: file.type,
  };
}

export async function finalizeCoverPhotoPreview(preview, tripId) {
  if (!preview?.file || !tripId) return null;
  if (preview.previewUrl) URL.revokeObjectURL(preview.previewUrl);
  return createPhotoMediaFromFile(preview.file, tripId, { maxThumbSide: 320, maxFullSide: 1200 });
}

/** @deprecated Use createPhotoMediaFromFile when tripId is known. */
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

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
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
