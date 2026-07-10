/**
 * Shared backend response types (mirrors api/src/schemas.py).
 * The backend types `rating`/`clip_analysis` as loose dicts, so these
 * frontend interfaces are the source of truth for those shapes.
 */

import type {
  AgeAnalysis,
  ClothingAnalysis,
  DeepfakeAnalysis,
} from '@/components/ClipAnalysisCards';

export type { AgeAnalysis, ClothingAnalysis, DeepfakeAnalysis };
export type { ApiKeyOption as ApiKey } from './use-api-keys';

export interface Detection {
  label: string;
  score: number;
  box?: number[];
  model?: string;
}

// ── RateMe rating breakdown ──────────────────────────────────────────────

export interface BreakdownItem {
  label: string;
  confidence: number;
  weight: number;
  contribution: number;
}

export interface ClipPrompt {
  prompt: string;
  similarity: number;
  weight: number;
  contribution: number;
}

interface FactorBase {
  score: number;
  weight: number;
}

export interface EroticismFactor extends FactorBase {
  breakdown: BreakdownItem[];
}

export interface ClipSexinessFactor extends FactorBase {
  available: boolean;
  top_prompts?: ClipPrompt[];
}

export interface ImageQualityFactor extends FactorBase {
  resolution: number;
  sharpness: number;
  brightness: number;
  contrast: number;
}

export interface CompositionFactor extends FactorBase {
  has_face: boolean;
  aspect_ratio: number;
  centering: number;
  pose?: { score: number; details: string };
}

export interface AestheticsFactor extends FactorBase {
  saturation: number;
  color_variety: number;
  noise_level: number;
}

export interface AgeAttractiveFactor extends FactorBase {
  estimated_age?: number;
  available?: boolean;
}

export interface RatingFactors {
  eroticism: EroticismFactor;
  clip_sexiness: ClipSexinessFactor;
  image_quality: ImageQualityFactor;
  composition: CompositionFactor;
  aesthetics: AestheticsFactor;
}

export interface Rating {
  score: number;
  category: string;
  description: string;
  factors: RatingFactors & { age_attractiveness?: AgeAttractiveFactor };
  age?: AgeAnalysis;
  deepfake?: DeepfakeAnalysis;
  clothing?: ClothingAnalysis;
}

export interface RateMeResult {
  models: string[];
  rating: Rating;
  detections: Detection[];
}

// ── Moderate ─────────────────────────────────────────────────────────────

export interface ClipSexinessAnalysis {
  score: number;
  available: boolean;
  top_prompts?: ClipPrompt[];
}

export interface ModerateResult {
  image_id: string;
  action: 'allow' | 'flag' | 'block';
  confidence: number;
  reasons: string[];
  detections: Detection[];
  rating: Rating;
  clip_analysis: {
    sexiness: ClipSexinessAnalysis;
    age: AgeAnalysis;
    deepfake: DeepfakeAnalysis;
    clothing: ClothingAnalysis;
  };
  summary: { nudity_score: number };
}
