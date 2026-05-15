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
    system: 'Classify whether these video frames carry primary information through visuals. Return JSON only.',
    prompt: 'Return isSlides=true if the frames carry the video\'s primary information visually — this includes presentation slide decks, screen recordings of apps/UIs, terminal or code displays, whiteboards, diagrams, or any other static or near-static informative content. Return isSlides=false only for plain talking-head/speaker-only shots, vlog footage, B-roll, or generic video without informative static content. Return {"isSlides": boolean, "confidence": 0..1, "reason": "..."}.',
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
