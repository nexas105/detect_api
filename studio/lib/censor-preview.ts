/**
 * Client-side censor preview generator.
 * Draws semi-transparent red overlay rectangles on detection boxes
 * to simulate what censoring would look like.
 */

import { boxLineWidth, loadImage } from './detection-draw';

interface Detection {
  label: string;
  score: number;
  box?: number[];
}

export async function generateCensorPreview(
  originalFile: File,
  detections: Detection[]
): Promise<Blob> {
  const img = await loadImage(originalFile);
  const imgWidth = img.naturalWidth;
  const imgHeight = img.naturalHeight;

  const canvas = document.createElement('canvas');
  canvas.width = imgWidth;
  canvas.height = imgHeight;
  const ctx = canvas.getContext('2d')!;

  // Draw original image
  ctx.drawImage(img, 0, 0, imgWidth, imgHeight);

  // Draw semi-transparent red overlay on each detection box
  for (const det of detections) {
    if (!det.box || det.box.length < 4) continue;
    const [x, y, w, h] = det.box;

    // Red semi-transparent fill
    ctx.fillStyle = 'rgba(220, 38, 38, 0.55)';
    ctx.fillRect(x, y, w, h);

    // Red border
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.9)';
    ctx.lineWidth = boxLineWidth(imgWidth, imgHeight);
    ctx.strokeRect(x, y, w, h);

    // Label text
    const labelText = det.label;
    const fontSize = Math.max(11, Math.round(Math.min(imgWidth, imgHeight) / 60));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textMetrics = ctx.measureText(labelText);
    const padding = 3;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(x, y, textMetrics.width + padding * 2, fontSize + padding * 2);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(labelText, x + padding, y + fontSize + padding - 1);
  }

  // Watermark
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CENSOR PREVIEW - Full censoring with API key', imgWidth / 2, imgHeight - 10);
  ctx.textAlign = 'left';

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to generate preview'));
      },
      'image/png'
    );
  });
}
