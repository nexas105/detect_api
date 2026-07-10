'use client';

import type { CSSProperties, ReactNode } from 'react';
import classes from './DetectionFrame.module.css';

export interface DetectionFrameProps {
  children: ReactNode;
  /** Corner colour. Defaults to the interactive accent (cyan). */
  color?: string;
  /** Corner arm length in px. */
  size?: number;
  /** How far the corners sit outside the content box, in px (negative = outside). */
  inset?: number;
  /** Stroke weight in px. */
  weight?: number;
  /** When false the corners fade out but the wrapper keeps its size (no layout shift). */
  active?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Signature "Detection-Bracket": four AF-reticle / bounding-box corners framing
 * the content. Use sparingly — only on the active nav item and primary/hero cards.
 */
export function DetectionFrame({
  children,
  color,
  size = 10,
  inset = -3,
  weight = 1.5,
  active = true,
  className,
  style,
}: DetectionFrameProps) {
  const vars = {
    '--df-color': color,
    '--df-size': `${size}px`,
    '--df-inset': `${inset}px`,
    '--df-weight': `${weight}px`,
  } as CSSProperties;

  const cornerClass = active ? classes.corner : `${classes.corner} ${classes.hidden}`;

  return (
    <div className={className ? `${classes.frame} ${className}` : classes.frame} style={{ ...vars, ...style }}>
      <span className={`${cornerClass} ${classes.tl}`} aria-hidden />
      <span className={`${cornerClass} ${classes.tr}`} aria-hidden />
      <span className={`${cornerClass} ${classes.bl}`} aria-hidden />
      <span className={`${cornerClass} ${classes.br}`} aria-hidden />
      {children}
    </div>
  );
}
