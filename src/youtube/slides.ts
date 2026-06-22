import type { VideoMeta, TranscriptSegment } from './fetch.js';
import type { YoutubeLlmClient } from './llm.js';
import type { YoutubeNotes, YoutubeVideoType } from './notes.js';

export interface FrameRef {
  tSec: number;
  imagePath: string;
  ocrText?: string;
}

export interface SlideDetectionOptions {
  confidenceThreshold?: number;
  minScenes?: number;
  stabilityThreshold?: number;
  videoType?: YoutubeVideoType;
  transcriptCueScore?: number;
}

export interface SlideDetectionResult {
  isSlideHeavy: boolean;
  confidence: number;
  reason: string;
  sceneCount: number;
  stabilityScore: number;
  slides: FrameRef[];
}

type VisionLlm = Required<Pick<YoutubeLlmClient, 'chatVision'>>;

export interface SlideCapturePlan {
  shouldAttempt: boolean;
  reason: string;
  transcriptCueScore: number;
  slidesMax: number;
  slidesSceneThreshold: number;
}

export interface PlanSlideCaptureInput {
  meta: VideoMeta;
  segments: TranscriptSegment[];
  videoType?: YoutubeVideoType;
  notes?: Pick<YoutubeNotes, 'videoType' | 'chapters'>;
}

export interface UsableSlideFramesOptions {
  videoType?: YoutubeVideoType;
  transcriptCueScore?: number;
}

const POSITIVE_VISUAL_CUES = /\b(slide|screen|demo|terminal|code|repo|repository|browser|notebook|diagram|chart|architecture|dashboard|on the left|on the right|as you can see|let me show)\b/gi;
const NEGATIVE_CONVERSATION_CUES = /\b(podcast|interview|conversation|guest|welcome back|tell me about|what do you think)\b/gi;

export async function detectSlides(frames: FrameRef[], llm: VisionLlm, options: SlideDetectionOptions = {}): Promise<SlideDetectionResult> {
  const confidenceThreshold = options.confidenceThreshold ?? 0.6;
  const minScenes = options.minScenes ?? 3;
  const stabilityThreshold = options.stabilityThreshold ?? 0.3;
  const stabilityScore = await computeStabilityScore(frames);
  if (frames.length < minScenes) {
    return { isSlideHeavy: false, confidence: 0, reason: 'too-few-scenes', sceneCount: frames.length, stabilityScore, slides: frames };
  }

  const ocr = ocrEvidence(frames);
  const transcriptCueScore = options.transcriptCueScore ?? 0;
  if (options.videoType && isStrongVisualType(options.videoType) && ocr.coverage >= 0.5 && ocr.averageWords >= 5) {
    return { isSlideHeavy: true, confidence: 0.8, reason: 'ocr-slide-evidence', sceneCount: frames.length, stabilityScore, slides: frames };
  }
  if (options.videoType && ocr.coverage <= 0.1 && transcriptCueScore <= 0 && !isStrongVisualType(options.videoType)) {
    return { isSlideHeavy: false, confidence: 0, reason: 'weak-ocr-and-transcript-evidence', sceneCount: frames.length, stabilityScore, slides: frames };
  }

  const sample = selectVisionSample(frames);
  const vision = await llm.chatVision<{ isSlides: boolean; confidence: number; reason: string }>({
    system: 'You are a visual content classifier. You are NOT a conversational assistant or coding agent. Your ONLY job is to classify whether the provided video frames contain informative static content. Output valid JSON only. Do not explain your reasoning. Do not add commentary.',
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

export function planSlideCapture(input: PlanSlideCaptureInput): SlideCapturePlan {
  const videoType = input.notes?.videoType ?? input.videoType ?? 'other';
  const transcriptCueScore = scoreTranscriptVisualCues(input);
  const slidesMax = slidesMaxForType(videoType);
  const slidesSceneThreshold = 0.3;

  if (videoType === 'interview' && transcriptCueScore < 2) {
    return { shouldAttempt: false, reason: 'interview-without-visual-cues', transcriptCueScore, slidesMax, slidesSceneThreshold };
  }
  if (isStrongVisualType(videoType)) {
    return { shouldAttempt: true, reason: 'visual-video-type', transcriptCueScore, slidesMax, slidesSceneThreshold };
  }
  if (transcriptCueScore > 0) {
    return { shouldAttempt: true, reason: 'transcript-visual-cues', transcriptCueScore, slidesMax, slidesSceneThreshold };
  }
  return { shouldAttempt: false, reason: 'no-visual-cues', transcriptCueScore, slidesMax, slidesSceneThreshold };
}

export function hasUsableSlideFrames(frames: FrameRef[], options: UsableSlideFramesOptions = {}): boolean {
  const usableFrames = filterUsableSlideFrames(frames);
  if (usableFrames.length < 2) return false;
  const ocr = ocrEvidence(usableFrames);
  if (ocr.coverage >= 0.5 && ocr.averageWords >= 5) return true;
  if (isStrongVisualType(options.videoType ?? 'other') && (options.transcriptCueScore ?? 0) >= 2) return true;
  return false;
}

export function filterUsableSlideFrames(frames: FrameRef[]): FrameRef[] {
  return frames.filter((frame) => isReadableOcr(frame.ocrText ?? ''));
}

function scoreTranscriptVisualCues(input: PlanSlideCaptureInput): number {
  const text = [
    input.meta.title,
    ...input.segments.map((segment) => segment.text),
    ...(input.notes?.chapters ?? []).flatMap((chapter) => [chapter.label, chapter.summary]),
  ].join(' ').toLowerCase();
  const positive = (text.match(POSITIVE_VISUAL_CUES) ?? []).length;
  const negative = (text.match(NEGATIVE_CONVERSATION_CUES) ?? []).length;
  return positive - negative;
}

function slidesMaxForType(videoType: YoutubeVideoType): number {
  switch (videoType) {
    case 'tutorial': return 18;
    case 'talk':
    case 'benchmark': return 12;
    case 'explainer':
    case 'other': return 8;
    case 'interview': return 8;
  }
}

function isStrongVisualType(videoType: YoutubeVideoType): boolean {
  return videoType === 'tutorial' || videoType === 'talk' || videoType === 'benchmark';
}

function ocrEvidence(frames: FrameRef[]): { coverage: number; averageWords: number } {
  const wordCounts = frames.map((frame) => (frame.ocrText ?? '').trim().split(/\s+/).filter(Boolean).length);
  const textFrames = wordCounts.filter((count) => count >= 3).length;
  const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
  return {
    coverage: frames.length ? textFrames / frames.length : 0,
    averageWords: frames.length ? totalWords / frames.length : 0,
  };
}

function isReadableOcr(text: string): boolean {
  const words = text.match(/[A-Za-z][A-Za-z0-9'_-]*/g) ?? [];
  const usefulWords = words.filter((word) => word.length >= 3 && /[aeiou]/i.test(word));
  return usefulWords.length >= 5 && usefulWords.length / Math.max(1, words.length) >= 0.35;
}

function selectVisionSample(frames: FrameRef[]): FrameRef[] {
  const indexes = new Set<number>();
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    indexes.add(Math.min(frames.length - 1, Math.round((frames.length - 1) * fraction)));
  }
  frames
    .map((frame, index) => ({ index, words: (frame.ocrText ?? '').split(/\s+/).filter(Boolean).length }))
    .sort((a, b) => b.words - a.words)
    .slice(0, 2)
    .forEach((entry) => indexes.add(entry.index));
  return [...indexes].sort((a, b) => a - b).slice(0, 6).map((index) => frames[index]);
}

async function computeStabilityScore(frames: FrameRef[]): Promise<number> {
  return Promise.resolve(frames.length > 0 ? 1 : 0);
}
