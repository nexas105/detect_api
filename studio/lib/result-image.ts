/**
 * Client-side canvas-based result image generator.
 * Produces a shareable "social card" PNG: original image with detection boxes
 * on top, dark info panel below with score, detections, and metadata.
 */

import { boxLineWidth, colorForLabel, loadImage, modelTag } from './detection-draw';

const CATEGORY_COLORS: Record<string, string> = {
  safe: '#22c55e',
  mild: '#14b8a6',
  suggestive: '#eab308',
  erotic: '#f97316',
  explicit: '#ef4444',
  extreme: '#a855f7',
};

const FACTOR_COLORS: Record<string, string> = {
  eroticism: '#ef4444',
  clip_sexiness: '#8b5cf6',
  image_quality: '#3b82f6',
  composition: '#14b8a6',
  aesthetics: '#f97316',
};

const FACTOR_LABELS: Record<string, string> = {
  eroticism: 'Eroticism',
  clip_sexiness: 'CLIP Sexiness',
  image_quality: 'Image Quality',
  composition: 'Composition',
  aesthetics: 'Aesthetics',
};

interface Detection {
  label: string;
  score: number;
  box?: number[];
  model?: string;
}

interface RateMeResultData {
  rating: {
    score: number;
    category: string;
    description: string;
    factors: Record<string, { score: number; weight: number }>;
    age?: { estimated_age: number; bracket: string; available: boolean };
    deepfake?: { fake_probability: number; verdict: string; available: boolean };
    clothing?: { clothing: string; exposure_level: number; available: boolean };
  };
  detections: Detection[];
}

interface ClassifyResultData {
  detections: Detection[];
  age?: { estimated_age: number; bracket: string; available: boolean };
  deepfake?: { fake_probability: number; verdict: string; available: boolean };
  clothing?: { clothing: string; exposure_level: number; available: boolean };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawDetectionBoxes(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  imgWidth: number,
  imgHeight: number,
  offsetY: number
) {
  for (const det of detections) {
    if (!det.box || det.box.length < 4) continue;
    const [x, y, w, h] = det.box;
    const color = colorForLabel(det.label);

    // Draw box
    ctx.strokeStyle = color;
    ctx.lineWidth = boxLineWidth(imgWidth, imgHeight);
    ctx.strokeRect(x, offsetY + y, w, h);

    // Draw label background
    const scoreText = `${Math.round(det.score * 100)}%`;
    const labelText = `${det.label} ${scoreText}${modelTag(det.model)}`;
    const fontSize = Math.max(12, Math.round(Math.min(imgWidth, imgHeight) / 50));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textMetrics = ctx.measureText(labelText);
    const textHeight = fontSize + 4;
    const padding = 4;

    ctx.fillStyle = color;
    ctx.fillRect(
      x,
      offsetY + y - textHeight - padding,
      textMetrics.width + padding * 2,
      textHeight + padding
    );

    // Draw label text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(labelText, x + padding, offsetY + y - padding - 2);
  }
}

/**
 * Interpolate between two colors based on a 0-1 value.
 * Returns a color from green -> yellow -> orange -> red.
 */
function scoreToColor(score: number): string {
  if (score < 0.25) return '#22c55e';
  if (score < 0.5) return '#eab308';
  if (score < 0.75) return '#f97316';
  return '#ef4444';
}

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || '#a855f7';
}

/**
 * Compute the height needed for the info panel.
 */
function computePanelHeight(
  detections: Detection[],
  mode: 'classify' | 'rateme',
  results: any
): number {
  const pad = 20;
  let h = pad; // top padding

  // Title "EroHub Analysis"
  h += 30;

  if (mode === 'rateme') {
    // Score bar line
    h += 36;
    // Category line
    h += 24;
    // spacing
    h += 12;
  }

  // "Detections:" header
  if (detections.length > 0) {
    h += 24;
    // Detection rows (cap at 15)
    const visibleDets = Math.min(detections.length, 15);
    h += visibleDets * 22;
    if (detections.length > 15) h += 20;
    h += 12;
  } else {
    h += 30; // "No NSFW content detected"
    h += 12;
  }

  // Age / Deepfake / Clothing lines
  const data = mode === 'rateme' ? (results as RateMeResultData).rating : results;
  let metaLines = 0;
  if (data?.age?.available) metaLines++;
  if (data?.deepfake?.available) metaLines++;
  if (data?.clothing?.available) metaLines++;
  h += metaLines * 24;
  if (metaLines > 0) h += 8;

  // Factor bars for rateme
  if (mode === 'rateme') {
    const factors = (results as RateMeResultData).rating.factors;
    const factorCount = Object.keys(factors).length;
    if (factorCount > 0) {
      h += 28; // "Factors" header
      h += factorCount * 28;
      h += 8;
    }
  }

  // Watermark
  h += 24;

  h += pad; // bottom padding

  return h;
}

export async function generateResultImage(
  originalFile: File,
  results: any,
  mode: 'classify' | 'rateme'
): Promise<Blob> {
  const img = await loadImage(originalFile);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;

  // Ensure minimum width of 600px — scale up small images
  const minWidth = 600;
  const scale = naturalW < minWidth ? minWidth / naturalW : 1;
  const imgWidth = Math.round(naturalW * scale);
  const imgHeight = Math.round(naturalH * scale);

  const detections: Detection[] = results.detections || [];
  const panelHeight = computePanelHeight(detections, mode, results);
  const totalHeight = imgHeight + panelHeight;

  const canvas = document.createElement('canvas');
  canvas.width = imgWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d')!;

  // Draw original image (scaled)
  ctx.drawImage(img, 0, 0, imgWidth, imgHeight);

  // Scale detection boxes if image was scaled up
  const scaledDetections: Detection[] = detections.map((d) => ({
    ...d,
    box: d.box ? d.box.map((v) => v * scale) : undefined,
  }));

  // Draw detection boxes on the image
  drawDetectionBoxes(ctx, scaledDetections, imgWidth, imgHeight, 0);

  // --- Draw info panel ---
  // Dark gradient background
  const grad = ctx.createLinearGradient(0, imgHeight, 0, totalHeight);
  grad.addColorStop(0, '#1a1b1e');
  grad.addColorStop(1, '#111111');
  ctx.fillStyle = grad;
  ctx.fillRect(0, imgHeight, imgWidth, panelHeight);

  // Thin separator line at top of panel
  ctx.fillStyle = '#333';
  ctx.fillRect(0, imgHeight, imgWidth, 1);

  const pad = 20;
  let curY = imgHeight + pad;

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('EroHub Analysis', pad, curY + 20);
  curY += 30;

  // --- RateMe: Score bar + Category ---
  if (mode === 'rateme') {
    const rating = (results as RateMeResultData).rating;
    const scorePercent = Math.round(rating.score * 100);
    const catColor = getCategoryColor(rating.category);

    curY += 8;

    // Score bar
    const barX = pad;
    const barW = imgWidth - pad * 2 - 80; // leave room for percentage text
    const barH = 20;

    // Bar background
    ctx.fillStyle = '#3f3f46';
    roundRect(ctx, barX, curY, barW, barH, 6);
    ctx.fill();

    // Bar fill
    const fillW = Math.max(0, barW * rating.score);
    if (fillW > 0) {
      ctx.fillStyle = catColor;
      roundRect(ctx, barX, curY, fillW, barH, 6);
      ctx.fill();
    }

    // Percentage text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${scorePercent}%`, barX + barW + 12, curY + 16);
    curY += barH + 8;

    // Category label
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = catColor;
    ctx.fillText(`Category: ${rating.category.toUpperCase()}`, pad, curY + 14);
    curY += 24;

    curY += 4;
  }

  // --- Detections list ---
  if (detections.length > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('\uD83D\uDD0D Detections:', pad, curY + 16);
    curY += 24;

    const visibleDets = detections.slice(0, 15);
    for (const det of visibleDets) {
      const color = colorForLabel(det.label);
      const dotY = curY + 10;

      // Colored dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pad + 8, dotY, 5, 0, Math.PI * 2);
      ctx.fill();

      // Label text
      ctx.fillStyle = '#ffffff';
      ctx.font = '14px sans-serif';
      const labelStr = `${det.label}${modelTag(det.model)}`;
      ctx.fillText(labelStr, pad + 20, dotY + 5);

      // Score percentage (right-aligned)
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(det.score * 100)}%`, imgWidth - pad, dotY + 5);
      ctx.textAlign = 'left';

      curY += 22;
    }

    if (detections.length > 15) {
      ctx.fillStyle = '#71717a';
      ctx.font = '12px sans-serif';
      ctx.fillText(`... and ${detections.length - 15} more`, pad + 20, curY + 12);
      curY += 20;
    }

    curY += 12;
  } else {
    ctx.fillStyle = '#71717a';
    ctx.font = '16px sans-serif';
    ctx.fillText('No NSFW content detected.', pad, curY + 18);
    curY += 30;
    curY += 12;
  }

  // --- Metadata lines (Age, Deepfake, Clothing) ---
  const metaData = mode === 'rateme' ? (results as RateMeResultData).rating : results;

  if (metaData?.age?.available) {
    ctx.fillStyle = '#d4d4d8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    const ageText = `\uD83D\uDC64 Age: ~${metaData.age.estimated_age} (${metaData.age.bracket.replace(/_/g, ' ')})`;
    ctx.fillText(ageText, pad, curY + 14);
    curY += 24;
  }

  if (metaData?.deepfake?.available) {
    ctx.fillStyle = '#d4d4d8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    const verdictLabel = metaData.deepfake.verdict === 'likely_real' ? 'Real Photo'
      : metaData.deepfake.verdict === 'possibly_fake' ? 'Possibly Fake'
      : 'Likely Fake';
    ctx.fillText(`\uD83D\uDEE1 ${verdictLabel}`, pad, curY + 14);
    curY += 24;
  }

  if (metaData?.clothing?.available) {
    ctx.fillStyle = '#d4d4d8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`\uD83D\uDC57 ${metaData.clothing.clothing}`, pad, curY + 14);
    curY += 24;
  }

  if (metaData?.age?.available || metaData?.deepfake?.available || metaData?.clothing?.available) {
    curY += 8;
  }

  // --- Factor bars for rateme ---
  if (mode === 'rateme') {
    const factors = (results as RateMeResultData).rating.factors;
    const factorKeys = Object.keys(factors);
    if (factorKeys.length > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Factors', pad, curY + 14);
      curY += 28;

      const barMaxW = imgWidth - pad * 2 - 120; // space for label + score
      const barH = 10;

      for (const key of factorKeys) {
        const factor = factors[key];
        const fColor = FACTOR_COLORS[key] || '#a855f7';
        const fLabel = FACTOR_LABELS[key] || key;

        // Label (left)
        ctx.fillStyle = '#d4d4d8';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(fLabel, pad, curY + 8);

        // Score text (right of bar area)
        ctx.fillStyle = '#a1a1aa';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(factor.score * 100)}%`, imgWidth - pad, curY + 8);
        ctx.textAlign = 'left';

        // Bar background
        const barX = pad + 100;
        const barActualW = imgWidth - pad * 2 - 100 - 50;
        ctx.fillStyle = '#3f3f46';
        roundRect(ctx, barX, curY + 12, barActualW, barH, 4);
        ctx.fill();

        // Bar fill
        const fillW = Math.max(0, barActualW * factor.score);
        if (fillW > 0) {
          ctx.fillStyle = fColor;
          roundRect(ctx, barX, curY + 12, fillW, barH, 4);
          ctx.fill();
        }

        curY += 28;
      }
      curY += 8;
    }
  }

  // --- Watermark ---
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('erohub.de/demo', imgWidth - pad, totalHeight - pad);
  ctx.textAlign = 'left';

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to generate image'));
      },
      'image/png'
    );
  });
}

export function downloadResultBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `erohub-result-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
