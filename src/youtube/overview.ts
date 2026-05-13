import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { OpenRouterClient } from '../llm/openrouter-client.js';
import { createTtsClient, type TtsClient } from '../llm/tts-client.js';
import { youtubeArtifactsDir, youtubeLibraryDir } from '../paths.js';
import { upsertYoutubeVideosAsSources, type YoutubeSourceVideoInput } from '../canonical-bookmarks-db.js';
import { fetchVideo as fetchVideoDefault, NoTranscriptError, type VideoFetchResult } from './fetch.js';
import { generateNotes, renderNotesMarkdown } from './notes.js';
import { buildScript } from './script.js';
import { detectSlides } from './slides.js';
import { assembleVideo as assembleVideoDefault, type AssembleVideoInput } from './video-assemble.js';
import { loadYoutubeState, markVideo, shouldProcess, updateYoutubeState } from './state.js';

export type OverviewMode = 'none' | 'audio' | 'video';

export interface ProcessVideoOptions {
  overview: OverviewMode;
  force?: boolean;
  llm: Pick<OpenRouterClient, 'chat'> & Partial<Pick<OpenRouterClient, 'chatVision'>>;
  tts?: TtsClient;
  targetMinutes?: number;
  slideConfidence?: number;
  indexCanonical?: boolean;
  assembleVideo?: (input: AssembleVideoInput) => Promise<{ outPath: string; durationSec: number }>;
  fetchVideo?: (videoId: string, options: { wantFrames?: boolean }) => Promise<VideoFetchResult>;
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
  try {
    fetched = await fetchVideo(videoId, { wantFrames: options.overview === 'video' });
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
  const notesPath = path.join(youtubeLibraryDir(), `${videoId}.md`);
  let notesMarkdown = renderNotesMarkdown(videoId, fetched.meta, notes);
  const artifacts: Record<string, string | undefined> = { notesPath };
  let status: 'done' | 'partial' = 'done';

  if (options.overview === 'audio') {
    try {
      const audioPath = await synthesizeAudioOverview(videoId, fetched, options);
      artifacts.audioPath = audioPath;
      notesMarkdown += `\n## Audio overview\n\n- ${audioPath}\n`;
    } catch {
      artifacts.audioOverview = 'failed';
      status = 'partial';
    }
  }

  if (options.overview === 'video') {
    const frames = fetched.frames ?? [];
    if (!options.llm.chatVision || !frames.length) {
      artifacts.videoOverview = 'skipped-not-slides';
    } else {
      const slideDecision = await detectSlides(frames, { chatVision: options.llm.chatVision }, { confidenceThreshold: options.slideConfidence });
      if (!slideDecision.isSlideHeavy) {
        artifacts.videoOverview = 'skipped-not-slides';
      } else {
        const artifactDir = youtubeArtifactsDir(videoId);
        const audioSegmentPaths: string[] = [];
        try {
          const script = await buildScript({ ...fetched, slides: slideDecision.slides }, options.llm, { targetMinutes: options.targetMinutes ?? 12 });
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
        } catch {
          try {
            const audioPath = audioSegmentPaths.length
              ? await concatenateAudioSegments(videoId, audioSegmentPaths)
              : await synthesizeAudioOverview(videoId, fetched, options);
            artifacts.audioPath = audioPath;
            artifacts.videoOverview = 'failed-degraded-to-audio';
            notesMarkdown += `\n## Audio overview\n\n- ${audioPath}\n\nVideo assembly failed, so FieldTheory kept an audio overview instead.\n`;
          } catch {
            artifacts.videoOverview = 'failed';
          }
          status = 'partial';
        }
      }
    }
  }

  await mkdir(path.dirname(notesPath), { recursive: true });
  await writeFile(notesPath, notesMarkdown, 'utf8');
  const canonicalSource: YoutubeSourceVideoInput = {
    videoId,
    title: fetched.meta.title,
    tldr: notes.tldr,
    topics: notes.topics,
    published: fetched.meta.publishDate ?? null,
  };
  if (options.indexCanonical !== false) await upsertYoutubeVideosAsSources([canonicalSource]);

  await updateYoutubeState((latest) => {
    markVideo(latest, videoId, {
      status,
      contentHash: fetched.contentHash,
      title: fetched.meta.title,
      channel: fetched.meta.channel,
      durationSec: fetched.meta.durationSec,
      artifacts,
    });
  });

  return { videoId, status, processed: true, notesPath, audioPath: artifacts.audioPath, videoPath: artifacts.videoPath, canonicalSource };
}

async function synthesizeAudioOverview(videoId: string, fetched: VideoFetchResult, options: ProcessVideoOptions): Promise<string> {
  const script = await buildScript(fetched, options.llm, { targetMinutes: options.targetMinutes ?? 12 });
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
