import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createTtsClient, type TtsClient } from '../llm/tts-client.js';
import { youtubeArtifactsDir, youtubeNotePath } from '../paths.js';
import { upsertYoutubeVideosAsSources, type YoutubeSourceVideoInput } from '../canonical-bookmarks-db.js';
import { fetchSlidesForVideo as fetchSlidesForVideoDefault, fetchVideo as fetchVideoDefault, NoTranscriptError, type VideoFetchResult } from './fetch.js';
import { generateNotes, renderNotesMarkdown, type YoutubeNotes } from './notes.js';
import { buildScript, defaultOverviewMinutes } from './script.js';
import { detectSlides, filterUsableSlideFrames, hasUsableSlideFrames, planSlideCapture, type FrameRef } from './slides.js';
import { assembleVideo as assembleVideoDefault, type AssembleVideoInput } from './video-assemble.js';
import { loadYoutubeState, markVideo, shouldProcess, updateYoutubeState } from './state.js';
import { writeYoutubeIndexFromState } from './index-html.js';
import type { YoutubeLlmClient } from './llm.js';
import type { YtDlpAccessOptions } from './yt-dlp.js';

export type OverviewMode = 'none' | 'slides' | 'audio' | 'video';

export interface ProcessVideoOptions {
  overview: OverviewMode;
  force?: boolean;
  llm: YoutubeLlmClient;
  tts?: TtsClient;
  targetMinutes?: number;
  slideConfidence?: number;
  ytDlp?: YtDlpAccessOptions;
  indexCanonical?: boolean;
  assembleVideo?: (input: AssembleVideoInput) => Promise<{ outPath: string; durationSec: number }>;
  fetchVideo?: (videoId: string, options: { wantFrames?: boolean; ytDlp?: YtDlpAccessOptions }) => Promise<VideoFetchResult>;
  fetchSlides?: (videoId: string, options: { outDir: string; slidesMax: number; slidesSceneThreshold: number; ytDlp?: YtDlpAccessOptions }) => Promise<FrameRef[]>;
}

export interface ProcessVideoResult {
  videoId: string;
  status: 'done' | 'partial' | 'skipped-unchanged' | 'skipped-no-transcript';
  processed: boolean;
  notesPath?: string;
  audioPath?: string;
  videoPath?: string;
  canonicalSource?: YoutubeSourceVideoInput;
}

export async function processVideo(videoId: string, options: ProcessVideoOptions): Promise<ProcessVideoResult> {
  const fetchVideo = options.fetchVideo ?? fetchVideoDefault;
  const state = await loadYoutubeState();
  let fetched: VideoFetchResult;
  const slidesDir = options.overview === 'video' ? youtubeArtifactsDir(videoId) : undefined;
  if (slidesDir) await mkdir(slidesDir, { recursive: true });
  try {
    fetched = await fetchVideo(videoId, { wantFrames: options.overview === 'video', slidesDir, ytDlp: options.ytDlp });
  } catch (error) {
    if (error instanceof NoTranscriptError) {
      await updateYoutubeState((latest) => {
        markVideo(latest, videoId, { status: 'skipped-no-transcript', error: error.message, artifacts: {} });
      });
      return { videoId, status: 'skipped-no-transcript', processed: false };
    }
    throw error;
  }
  if (!shouldProcess(state, videoId, fetched.contentHash, Boolean(options.force))) {
    return { videoId, status: 'skipped-unchanged', processed: false, notesPath: state.videos[videoId]?.artifacts.notesPath };
  }

  const notes = await generateNotes(fetched, options.llm);
  const existingNotesPath = state.videos[videoId]?.artifacts.notesPath;
  const notesPath = youtubeNotePath(videoId, fetched.meta.publishDate, existingNotesPath);
  let notesForMarkdown = notes;
  let slideImages: FrameRef[] = [];
  const artifacts: Record<string, string | undefined> = { notesPath };
  let status: 'done' | 'partial' = 'done';

  if (options.overview === 'slides' || options.overview === 'video') {
    const slidePlan = planSlideCapture({ meta: fetched.meta, segments: fetched.segments, notes });
    if (slidePlan.shouldAttempt) {
      const artifactDir = youtubeArtifactsDir(videoId);
      const frames = await (options.fetchSlides ?? fetchSlidesForVideoDefault)(videoId, {
        outDir: artifactDir,
        slidesMax: slidePlan.slidesMax,
        slidesSceneThreshold: slidePlan.slidesSceneThreshold,
        ytDlp: options.ytDlp,
      }).catch(() => [] as FrameRef[]);
      const usableFrames = filterUsableSlideFrames(frames);
      if (hasUsableSlideFrames(usableFrames, { videoType: notes.videoType, transcriptCueScore: slidePlan.transcriptCueScore })) {
        artifacts.slideCount = String(usableFrames.length);
        artifacts.slidesDir = artifactDir;
        slideImages = usableFrames;
      }
    }
  }

  notesForMarkdown = withApproximateChapters(notesForMarkdown, fetched.meta.durationSec);
  // Slides are embedded inline within the chapter timeline for visual continuity,
  // not appended as a detached link list.
  let notesMarkdown = renderNotesMarkdown(videoId, fetched.meta, notesForMarkdown, slideImages);

  if (options.overview === 'audio') {
    try {
      const audioPath = await synthesizeAudioOverview(videoId, fetched, notes, options);
      artifacts.audioPath = audioPath;
      notesMarkdown += `\n## Audio overview\n\n- ${audioPath}\n`;
    } catch {
      artifacts.audioOverview = 'failed';
      status = 'partial';
    }
  }

  if (options.overview === 'video') {
    const slideCountNum = Number(artifacts.slideCount ?? '0');
    if (!slideCountNum) {
      artifacts.videoOverview = 'skipped-not-candidate';
    } else if (!options.llm.chatVision) {
      artifacts.videoOverview = 'skipped-not-slides';
    } else {
      const artifactDir = youtubeArtifactsDir(videoId);
      const slidePlan = planSlideCapture({ meta: fetched.meta, segments: fetched.segments, notes });
      const frames = await (options.fetchSlides ?? fetchSlidesForVideoDefault)(videoId, {
        outDir: artifactDir,
        slidesMax: slidePlan.slidesMax,
        slidesSceneThreshold: slidePlan.slidesSceneThreshold,
        ytDlp: options.ytDlp,
      }).catch(() => [] as FrameRef[]);
      const usableFrames = filterUsableSlideFrames(frames);
      const slideDecision = usableFrames.length
        ? await detectSlides(usableFrames, { chatVision: options.llm.chatVision }, { confidenceThreshold: options.slideConfidence, videoType: notes.videoType, transcriptCueScore: slidePlan.transcriptCueScore })
        : { isSlideHeavy: false, slides: [] as FrameRef[] };
      if (!slideDecision.isSlideHeavy) {
        artifacts.videoOverview = 'skipped-not-slides';
      } else {
        const audioSegmentPaths: string[] = [];
        try {
          const script = await buildScript({ ...fetched, notes, slides: slideDecision.slides }, options.llm, { targetMinutes: options.targetMinutes ?? defaultOverviewMinutes({ videoType: notes.videoType, durationSec: fetched.meta.durationSec }) });
          await mkdir(artifactDir, { recursive: true });
          const tts = options.tts ?? createTtsClient();
          for (let i = 0; i < script.segments.length; i += 1) {
            const audioPath = path.join(artifactDir, `segment-${i}.mp3`);
            const audio = await tts.synthesize(script.segments[i].text, audioPath);
            audioSegmentPaths.push(audio.outPath);
          }
          const videoPath = path.join(artifactDir, `${videoId}.overview.mp4`);
          await (options.assembleVideo ?? assembleVideoDefault)({
            slides: slideDecision.slides,
            segments: script.segments,
            audioSegmentPaths,
            srtPath: path.join(artifactDir, `${videoId}.srt`),
            outPath: videoPath,
          });
          artifacts.videoPath = videoPath;
          notesMarkdown += `\n## Video overview\n\n- ${videoPath}\n`;
        } catch (videoError) {
          const videoErrorMessage = videoError instanceof Error ? videoError.message : String(videoError);
          console.warn(`  ! video assembly failed for ${videoId}: ${videoErrorMessage}`);
          try {
            const audioPath = audioSegmentPaths.length
              ? await concatenateAudioSegments(videoId, audioSegmentPaths)
              : await synthesizeAudioOverview(videoId, fetched, notes, options);
            artifacts.audioPath = audioPath;
            artifacts.videoOverview = 'failed-degraded-to-audio';
            notesMarkdown += `\n## Audio overview\n\n- ${audioPath}\n\nVideo assembly failed (${videoErrorMessage}), so FieldTheory kept an audio overview instead.\n`;
          } catch (audioError) {
            const audioErrorMessage = audioError instanceof Error ? audioError.message : String(audioError);
            console.warn(`  ! audio fallback failed for ${videoId}: ${audioErrorMessage}`);
            artifacts.videoOverview = 'failed';
          }
          status = 'partial';
        }
      }
    }
  }

  const qualityWarnings = validateNoteQuality(fetched, notesForMarkdown, slideImages.length > 0);
  if (qualityWarnings.length) {
    artifacts.validationWarnings = qualityWarnings.map((warning) => warning.message).join('; ');
    // Only serious warnings (insufficient source material) downgrade a note to
    // partial. Minor warnings (approximate timestamps, sparse chapters) are
    // rendered for transparency but still ship as done.
    if (qualityWarnings.some((warning) => warning.severity === 'serious')) status = 'partial';
    notesMarkdown += `\n## Quality warnings\n\n${qualityWarnings.map((warning) => `- ${warning.message}`).join('\n')}\n`;
  }

  await mkdir(path.dirname(notesPath), { recursive: true });
  await writeFile(notesPath, notesMarkdown, 'utf8');
  const canonicalSource: YoutubeSourceVideoInput = {
    videoId,
    title: fetched.meta.title,
    tldr: notes.tldr,
    keyPoints: notes.keyPoints,
    chapters: notes.chapters,
    actionItems: notes.actionItems,
    topics: notes.topics,
    notePath: notesPath,
    channel: fetched.meta.channel ?? null,
    durationSec: fetched.meta.durationSec ?? null,
    videoType: notes.videoType,
    published: fetched.meta.publishDate ?? null,
  };
  if (options.indexCanonical !== false) await upsertYoutubeVideosAsSources([canonicalSource]);

  // Enumerate the known artifact keys so unset ones (undefined) clear stale values
  // from prior failed/degraded runs. markVideo merges artifacts shallowly, so omitting
  // a key would otherwise let leftover failure markers (e.g. videoOverview) persist.
  const artifactsForState: Record<string, string | undefined> = {
    notesPath: artifacts.notesPath,
    audioPath: artifacts.audioPath,
    videoPath: artifacts.videoPath,
    videoOverview: artifacts.videoOverview,
    audioOverview: artifacts.audioOverview,
    slideCount: artifacts.slideCount,
    slidesDir: artifacts.slidesDir,
    validationWarnings: artifacts.validationWarnings,
  };
  await updateYoutubeState((latest) => {
    markVideo(latest, videoId, {
      status,
      contentHash: fetched.contentHash,
      title: fetched.meta.title,
      channel: fetched.meta.channel,
      durationSec: fetched.meta.durationSec,
      published: fetched.meta.publishDate ?? null,
      videoType: notes.videoType,
      tldr: notes.tldr,
      topics: notes.topics,
      artifacts: artifactsForState,
    });
  });
  await writeYoutubeIndexFromState();

  return { videoId, status, processed: true, notesPath, audioPath: artifacts.audioPath, videoPath: artifacts.videoPath, canonicalSource };
}

function withApproximateChapters(notes: YoutubeNotes, durationSec: number | undefined): YoutubeNotes {
  if (notes.chapters.length > 1 || notes.keyPoints.length < 2 || durationSec == null || durationSec < 10 * 60) return notes;
  const chapterCount = Math.min(6, notes.keyPoints.length);
  const spacing = Math.max(1, Math.floor(durationSec / chapterCount));
  return {
    ...notes,
    chapters: notes.keyPoints.slice(0, chapterCount).map((point, index) => ({
      tSec: index * spacing,
      label: `Part ${index + 1}`,
      summary: point,
    })),
  };
}

type QualityWarning = { message: string; severity: 'serious' | 'minor' };

function validateNoteQuality(fetched: VideoFetchResult, notes: YoutubeNotes, hasSlidesSection: boolean): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const duration = fetched.meta.durationSec ?? 0;
  // Serious: not enough source text for the video length. The summary is built
  // from insufficient material, so the note cannot be trusted as complete.
  if (duration >= 10 * 60 && fetched.transcriptText.length < 2_000) {
    warnings.push({ message: 'Transcript coverage is thin for this video length; summaries may miss later details.', severity: 'serious' });
  }
  // Minor: the transcript is complete enough but lacks timestamp granularity, so
  // chapters are approximate. The note is still navigable and trustworthy.
  if (duration >= 10 * 60 && fetched.segments.length <= 1) {
    warnings.push({ message: 'Only one source transcript segment was available; chapter timestamps are approximate.', severity: 'minor' });
  }
  if (duration >= 10 * 60 && notes.chapters.length < 3) {
    warnings.push({ message: 'Fewer than three chapter summaries were generated for a long video.', severity: 'minor' });
  }
  if (!hasSlidesSection && /\b(slide|screen|demo|terminal|code)\b/i.test(fetched.transcriptText) && notes.videoType === 'tutorial') {
    warnings.push({ message: 'No usable slides/screenshots passed validation for this tutorial.', severity: 'minor' });
  }
  // Serious: generated notes are too thin relative to video length. This usually
  // means the model produced boilerplate instead of extracting real content.
  const totalContentLength = [
    notes.tldr,
    ...notes.keyPoints,
    ...notes.chapters.map((c) => c.summary),
  ].join(' ').length;
  const expectedMin = duration >= 45 * 60 ? 8_000 : duration >= 20 * 60 ? 5_000 : duration >= 10 * 60 ? 2_500 : 0;
  if (expectedMin > 0 && totalContentLength < expectedMin) {
    warnings.push({ message: `Generated notes are too thin (${totalContentLength} chars) for a ${Math.round(duration / 60)}min video; expected at least ${expectedMin}. The model likely produced boilerplate.`, severity: 'serious' });
  }
  return warnings;
}

async function synthesizeAudioOverview(videoId: string, fetched: VideoFetchResult, notes: YoutubeNotes, options: ProcessVideoOptions): Promise<string> {
  const script = await buildScript({ ...fetched, notes }, options.llm, { targetMinutes: options.targetMinutes ?? defaultOverviewMinutes({ videoType: notes.videoType, durationSec: fetched.meta.durationSec }) });
  const audioText = script.segments.map((segment) => segment.text).join('\n\n');
  const audioPath = path.join(youtubeArtifactsDir(videoId), `${videoId}.overview.mp3`);
  await mkdir(path.dirname(audioPath), { recursive: true });
  const result = await (options.tts ?? createTtsClient()).synthesize(audioText, audioPath);
  return result.outPath;
}

async function concatenateAudioSegments(videoId: string, audioSegmentPaths: string[]): Promise<string> {
  const extension = path.extname(audioSegmentPaths[0]) || '.audio';
  const outPath = path.join(youtubeArtifactsDir(videoId), `${videoId}.overview${extension}`);
  const buffers = await Promise.all(audioSegmentPaths.map((audioPath) => readFile(audioPath)));
  await writeFile(outPath, Buffer.concat(buffers));
  return outPath;
}
