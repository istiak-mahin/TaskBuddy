/**
 * Generates a small DataURL (Base64) for an image.
 * Useful for Firestore fallbacks or small thumbnails.
 */
export async function generateThumbnail(
  file: File,
  maxWidth: number = 256,
  quality: number = 0.5
): Promise<string> {
  const blob = await compressImage(file, maxWidth, quality);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read thumbnail data.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Resizes and compresses an image file with strong fallbacks for mobile & desktop.
 * Returns a Blob or the original File.
 */
export async function compressImage(
  file: File,
  maxWidth: number = 512,
  quality: number = 0.8
): Promise<Blob | File> {
  if (!file || file.size === 0) {
    throw new Error('Image source is invalid or empty.');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file.');
  }

  const fileSizeKB = file.size / 1024;

  console.log('[ImageAudit] Processing:', {
    name: file.name,
    type: file.type,
    size: `${fileSizeKB.toFixed(2)}KB`,
  });

  // Very small files do not need compression.
  if (fileSizeKB < 250) {
    console.log('[ImageAudit] Small image detected. Skipping compression.');
    return file;
  }

  // HEIC often fails in browser decoding on many devices.
  if (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.(heic|heif)$/i.test(file.name)
  ) {
    throw new Error(
      'HEIC photos are not reliably supported here. Please convert the image to JPG or PNG first.'
    );
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await loadImageFromObjectUrl(objectUrl);

    if (!img.width || !img.height) {
      throw new Error('Selected photo has invalid dimensions.');
    }

    let { width, height } = img;

    if (width > height) {
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
    } else {
      if (height > maxWidth) {
        width = Math.round((width * maxWidth) / height);
        height = maxWidth;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx) {
      throw new Error('Browser canvas failure. Please try a different browser.');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const compressedBlob = await canvasToBlob(canvas, 'image/jpeg', quality);

    // If compression somehow makes it bigger, keep the original file.
    if (compressedBlob.size >= file.size) {
      console.log('[ImageAudit] Compression not useful. Using original file.');
      return file;
    }

    console.log('[ImageAudit] Success:', {
      original: `${(file.size / 1024).toFixed(2)}KB`,
      compressed: `${(compressedBlob.size / 1024).toFixed(2)}KB`,
      width,
      height,
    });

    return compressedBlob;
  } catch (error) {
    console.warn('[ImageAudit] Compression failed. Using original file.', error);
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadImageFromObjectUrl(
  objectUrl: string
): Promise<HTMLImageElement | ImageBitmap> {
  // Faster and more reliable path when supported
  if ('createImageBitmap' in window) {
    try {
      const response = await fetch(objectUrl);
      const blob = await response.blob();
      return await Promise.race([
        createImageBitmap(blob),
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

function timeoutReject<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}