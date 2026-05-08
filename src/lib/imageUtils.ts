/**
 * Generates a small DataURL (Base64) for an image.
 * This is designed for Firestore profile photo fallback, so it keeps the final
 * payload small enough to avoid document-size issues.
 */
export async function generateThumbnail(
  file: File,
  maxWidth: number = 256,
  quality: number = 0.65
): Promise<string> {
  return generateSmallImageDataUrl(file, maxWidth, quality);
}

export async function generateSmallImageDataUrl(
  file: File,
  maxWidth: number = 256,
  quality: number = 0.65,
  maxDataUrlChars: number = 750_000
): Promise<string> {
  if (!file || file.size === 0) {
    throw new Error('Image source is invalid or empty.');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file.');
  }

  if (isHeicLike(file)) {
    throw new Error(
      'HEIC photos are not reliably supported here. Please convert the image to JPG or PNG first.'
    );
  }

  const attempts = [
    { width: maxWidth, quality },
    { width: Math.min(maxWidth, 220), quality: 0.58 },
    { width: Math.min(maxWidth, 192), quality: 0.5 },
    { width: Math.min(maxWidth, 160), quality: 0.42 },
  ];

  let lastDataUrl = '';

  for (const attempt of attempts) {
    const blob = await resizeImageToJpeg(file, attempt.width, attempt.quality);
    const dataUrl = await blobToDataUrl(blob);
    lastDataUrl = dataUrl;

    if (dataUrl.length <= maxDataUrlChars) {
      return dataUrl;
    }
  }

  console.warn('[ImageAudit] Profile image still large after aggressive compression:', {
    chars: lastDataUrl.length,
    maxDataUrlChars,
  });

  if (lastDataUrl.length <= 950_000) {
    return lastDataUrl;
  }

  throw new Error('The photo is too large after compression. Please select a smaller JPG or PNG image.');
}

/**
 * Resizes and compresses an image file with strong fallbacks for mobile & desktop.
 * Returns a Blob. This function always compresses instead of returning the original
 * image, which prevents large phone photos from being saved directly to Firestore.
 */
export async function compressImage(
  file: File,
  maxWidth: number = 512,
  quality: number = 0.8
): Promise<Blob> {
  if (!file || file.size === 0) {
    throw new Error('Image source is invalid or empty.');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file.');
  }

  if (isHeicLike(file)) {
    throw new Error(
      'HEIC photos are not reliably supported here. Please convert the image to JPG or PNG first.'
    );
  }

  const fileSizeKB = file.size / 1024;

  console.log('[ImageAudit] Processing:', {
    name: file.name,
    type: file.type,
    size: `${fileSizeKB.toFixed(2)}KB`,
  });

  return resizeImageToJpeg(file, maxWidth, quality);
}

function isHeicLike(file: File) {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(heic|heif)$/i.test(file.name)
  );
}

async function resizeImageToJpeg(
  file: File,
  maxWidth: number,
  quality: number
): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await loadImageFromObjectUrl(objectUrl);

    const sourceWidth = img.width;
    const sourceHeight = img.height;

    if (!sourceWidth || !sourceHeight) {
      throw new Error('Selected photo has invalid dimensions.');
    }

    let width = sourceWidth;
    let height = sourceHeight;

    if (width > height) {
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
    } else if (height > maxWidth) {
      width = Math.round((width * maxWidth) / height);
      height = maxWidth;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);

    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx) {
      throw new Error('Browser canvas failure. Please try a different browser.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const compressedBlob = await canvasToBlob(canvas, 'image/jpeg', quality);

    console.log('[ImageAudit] Success:', {
      original: `${(file.size / 1024).toFixed(2)}KB`,
      compressed: `${(compressedBlob.size / 1024).toFixed(2)}KB`,
      width: canvas.width,
      height: canvas.height,
    });

    return compressedBlob;
  } catch (error) {
    console.warn('[ImageAudit] Compression failed:', error);
    throw error instanceof Error
      ? error
      : new Error('Photo processing failed. Please try another image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadImageFromObjectUrl(
  objectUrl: string
): Promise<HTMLImageElement | ImageBitmap> {
  if ('createImageBitmap' in window) {
    try {
      const response = await fetch(objectUrl);
      const blob = await response.blob();
      return await Promise.race([
        createImageBitmap(blob, { imageOrientation: 'from-image' }),
        timeoutReject<ImageBitmap>(12000, 'Image decoding timed out.'),
      ]);
    } catch {
      // Fallback below
    }
  }

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();

    const timer = window.setTimeout(() => {
      reject(new Error('Image loading timed out.'));
    }, 12000);

    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };

    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('The selected image could not be processed.'));
    };

    img.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Image conversion failed.'));
            return;
          }
          resolve(blob);
        },
        type,
        quality
      );
    } catch {
      reject(new Error('Hardware/browser restriction blocked image processing.'));
    }
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read thumbnail data.'));
    reader.readAsDataURL(blob);
  });
}

function timeoutReject<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}
