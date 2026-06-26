import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractLinkPreviewFromHtml } from '../src/web/link-preview.js';

test('extractLinkPreviewFromHtml reads OpenGraph metadata', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Agents Paper">
    <meta property="og:description" content="A short summary">
    <meta property="og:image" content="https://example.com/cover.jpg">
    <meta property="og:site_name" content="Example">
  </head><body></body></html>`;
  const preview = extractLinkPreviewFromHtml(html);
  assert.equal(preview.title, 'Agents Paper');
  assert.equal(preview.description, 'A short summary');
  assert.equal(preview.image, 'https://example.com/cover.jpg');
  assert.equal(preview.siteName, 'Example');
});