/**
 * Shared canvas primitives for detection overlays.
 * Used by result-image.ts (social card) and censor-preview.ts (red overlay).
 */

const LABEL_COLORS: Record<string, string> = {
  // Red — explicit exposed
  FEMALE_BREAST_EXPOSED: '#ef4444',
  FEMALE_GENITALIA_EXPOSED: '#dc2626',
  MALE_GENITALIA_EXPOSED: '#dc2626',
  BUTTOCKS_EXPOSED: '#ef4444',
  ANUS_EXPOSED: '#dc2626',
  NIPPLE: '#ef4444',
  VAGINA: '#dc2626',
  PENIS: '#dc2626',
  MAKE_LOVE: '#991b1b',
  // Orange — covered
  FEMALE_BREAST_COVERED: '#f97316',
  BUTTOCKS_COVERED: '#f97316',
  // Blue — face
  FACE_FEMALE: '#3b82f6',
  FACE_MALE: '#3b82f6',
};

const DEFAULT_COLOR = '#a855f7';

export function colorForLabel(label: string): string {
  return LABEL_COLORS[label] || DEFAULT_COLOR;
}

/** Short model badge, e.g. "NN" for nudenet, "EX" otherwise. */
export function modelTag(model?: string): string {
  if (!model) return '';
  return ` [${model === 'nudenet' ? 'NN' : 'EX'}]`;
}

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Line width scaled to image size, min 2px — shared by both renderers. */
export function boxLineWidth(imgWidth: number, imgHeight: number): number {
  return Math.max(2, Math.round(Math.min(imgWidth, imgHeight) / 200));
}
