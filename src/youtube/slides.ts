import type { OpenRouterClient } from '../llm/openrouter-client.js';

export interface FrameRef {
  tSec: number;
  imagePath: string;
  ocrText?: string;
}

export interface SlideDetectionOptions {
  confidenceThreshold?: number;
  minScenes?: number;
  stabilityThreshold?: number;
}

export interface SlideDetectionResult {
  isSlideHeavy: boolean;
  confidence: number;
  reason: string;
  sceneCount: number;
  stabilityScore: number;
  slides: FrameRef[];
}

type VisionLlm = Pick<OpenRouterClient, 'chatVision'>;

export async function detectSlides(frames: FrameRef[], llm: VisionLlm, options: SlideDetectionOptions = {}): Promise<SlideDetectionResult> {
  const confidenceThreshold = options.confidenceThreshold ?? 0.6;
  const minScenes = options.minScenes ?? 3;
  const stabilityThreshold = options.stabilityThreshold ?? 0.3;
  const stabilityScore = await computeStabilityScore(frames);
  const sample = frames.slice(0, 6);
  const vision = await llm.chatVision<{ isSlides: boolean; confidence: number; reason: string }>({
    system: 'Classify video frames as presentation slides or non-slide video. Return JSON only.',
    prompt: 'Are these frames presentation slides, lecture/screen-share visuals, or non-slide footage? Return {"isSlides": boolean, "confidence": 0..1, "reason": "..."}.',
    images: sample.map((frame) => ({ path: frame.imagePath })),
    json: true,
  });
  const isSlides = Boolean(vision.json?.isSlides);
  const confidence = typeof vision.json?.confidence === 'number' ? vision.json.confidence : 0;
  const reason = typeof vision.json?.reason === 'string' ? vision.json.reason : '';
  const isSlideHeavy = isSlides && confidence >= confidenceThreshold && frames.length >= minScenes && stabilityScore >= stabilityThreshold;

  return { isSlideHeavy, confidence, reason, sceneCount: frames.length, stabilityScore, slides: frames };
}

async function computeStabilityScore(frames: FrameRef[]): Promise<number> {
  return Promise.resolve(frames.length > 0 ? 1 : 0);
}
