/**
 * Editable configuration for the generated Field Theory library.
 *
 * `library/wiki.config.md` is the human-owned file that decides what the wiki is
 * for and how its pages should read. Page prompts inject the Purpose, Audience,
 * and Style rules sections, so retuning the wiki's voice is a text edit rather
 * than a code change. Everything else in `library/` is generated and safe to
 * delete; this file is not.
 */

import path from 'node:path';

import { libraryDir } from './paths.js';
import { pathExists, readMd, writeMd } from './fs.js';

/** Sections whose prose is injected into page-generation prompts. */
const GUIDANCE_SECTIONS = ['Purpose', 'Audience', 'Style rules'] as const;

const MAX_GUIDANCE_CHARS = 1200;

export function wikiConfigPath(): string {
  return path.join(libraryDir(), 'wiki.config.md');
}

export function defaultWikiConfig(today: string): string {
  return `---
tags: [ft/config]
last_updated: ${today}
---

# Field Theory Library Config

This file is yours to edit. Page generation reads the **Purpose**, **Audience**,
and **Style rules** sections below and follows them. Everything else under
\`library/\` is generated output.

## Purpose

A personal second brain over everything I actually consume — X bookmarks,
Raindrop saves, GitHub stars, YouTube talks, and local project work — so that a
future agent (or I) can recall what was already read, what it claimed, and how
it connects to current work.

## Audience

Me, and coding agents answering my questions in other repos. Assume a senior
engineer's background; skip introductions to well-known technology.

## Scope

In scope:

- Cross-source synthesis: what the material collectively claims about a topic.
- Concrete techniques, tools, failure modes, and numbers worth remembering.
- Contradictions between sources, stated plainly.

Out of scope:

- Restating a single link's title as if it were knowledge.
- Marketing language, hype framing, and engagement bait.
- Personal or private details about the people who wrote the sources.

## Source policy

- Every factual claim carries an inline source link.
- Distinguish what a source claims from your interpretation of it.
- Mark thin evidence as thin instead of smoothing it over.

## Page types

- \`sources/<source>.md\` — what one source stream contributes.
- \`categories/<category>.md\` — a durable subject area.
- \`domains/<domain>.md\` — a site or publisher's material.
- \`entities/<handle>.md\` — a recurring person or account.
- \`concepts/<concept>.md\` — an idea that spans sources.
- \`daily/<date>.md\` + \`.html\` — the daily learning review.

## Style rules

- Lead with the useful takeaway, not with context.
- Prefer specifics: names, numbers, commands, versions, tradeoffs.
- Group by idea, never by source or by date.
- Keep sections short and skimmable; no filler summary paragraphs.
- Link related pages with wikilinks so navigation stays possible.
- Say "unclear" when the sources disagree or do not say.

## Maintenance rules

- Regenerate pages with \`ft wiki --unified\`; never hand-edit generated pages
  you want to keep, because a rebuild overwrites them.
- \`index.md\` and \`index.html\` are navigation surfaces, rebuilt on every run.
- Record notable runs and failures in \`log.md\`.
`;
}

/** Create the config on first run; never overwrite an edited one. */
export async function ensureWikiConfig(today = new Date().toISOString().slice(0, 10)): Promise<{ path: string; created: boolean }> {
  const configPath = wikiConfigPath();
  if (await pathExists(configPath)) return { path: configPath, created: false };
  await writeMd(configPath, defaultWikiConfig(today));
  return { path: configPath, created: true };
}

/**
 * Pull the prompt-relevant sections out of a config file's markdown. Unknown
 * sections are ignored, so users can keep notes in the file without leaking
 * them into every page prompt.
 */
export function extractWikiGuidance(markdown: string): string {
  const body0 = `\n${markdown.replace(/^---\n[\s\S]*?\n---\n/, '')}`;
  const blocks: string[] = [];
  for (const section of GUIDANCE_SECTIONS) {
    // No `m` flag: `$` must mean end-of-input so a section runs to the next
    // heading or the end of the file, not to the end of its first line.
    const pattern = new RegExp(`\\n##\\s+${section}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
    const body = pattern.exec(body0)?.[1]?.trim();
    if (body) blocks.push(`${section}:\n${body}`);
  }
  const guidance = blocks.join('\n\n').trim();
  return guidance.length > MAX_GUIDANCE_CHARS ? `${guidance.slice(0, MAX_GUIDANCE_CHARS).trimEnd()}…` : guidance;
}

/** Guidance for prompt injection, or undefined when no config exists yet. */
export async function readWikiGuidance(): Promise<string | undefined> {
  const configPath = wikiConfigPath();
  if (!(await pathExists(configPath))) return undefined;
  try {
    return extractWikiGuidance(await readMd(configPath)) || undefined;
  } catch {
    return undefined;
  }
}
