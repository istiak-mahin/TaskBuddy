/**
 * Generates a small DataURL (Base64) for an image.
 * Useful for Firestore fallbacks or small thumbnails.
 */
export async function generateThumbnail(file: File, maxWidth: number = 256, quality: number = 0.5): Promise<string> {
  const blob = await compressImage(file, maxWidth, quality);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
/**
 * Resizes and compresses an image file with aggressive resilience for mobile & desktop.
 * Returns a Blob (or the original File if already optimized).
 */
export async function compressImage(file: File, maxWidth: number = 512, quality: number = 0.8): Promise<Blob | File> {
  if (!file || file.size === 0) {
    throw new Error('Image source is invalid or empty.');
  }

  const fileSizeKB = file.size / 1024;
  console.log('[ImageAudit] Processing:', { name: file.name, type: file.type, size: fileSizeKB.toFixed(2) + 'KB' });

  // Optimization: Preserve small, standard JPEGs to avoid decoding overhead
  if (file.type === 'image/jpeg' && fileSizeKB < 300) {
    console.log('[ImageAudit] Small JPEG detected. Bypassing compression for speed.');
    return file;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.crossOrigin = "anonymous"; // Mitigate Tainted Canvas issues

      img.onload = () => {
        if (img.width === 0 || img.height === 0) {
          reject(new Error('Selected photo has invalid dimensions.'));
          return;
        }

        const canvas = document.createElement('canvas');
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

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Browser canvas failure. Please try a different browser.'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        try {
          canvas.toBlob((blob) => {
            if (blob) {
              console.log('[ImageAudit] Success:', { size: (blob.size / 1024).toFixed(2) + 'KB' });
              resolve(blob);
            } else {
              reject(new Error('Image conversion failure (toBlob).'));
            }
          }, 'image/jpeg', quality);
        } catch (err) {
          reject(new Error('Hardware security restriction blocked image processing.'));
        }
      };

      img.onerror = () => {
        const errorMsg = file.name.toLowerCase().endsWith('.heic') 
          ? 'iOS HEIC photos are not natively supported here. Please save as JPEG first.' 
          : 'The photo format is not supported by your current browser.';
        reject(new Error(errorMsg));
      };

      img.src = e.target?.result as string;
    };

    reader.onerror = () => reject(new Error('File access error on device.'));
    reader.readAsDataURL(file);
  });
}
