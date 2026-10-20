/** Controlled subject facets derived only from explicit source tags, not URL hosts or format types. */
const TOPIC_TAGS: Record<string, string[]> = {
  'ai/agents': ['agents', 'agent', 'harnesses', 'skills', 'orchestration', 'multi-agent'],
  'ai/coding-agents': ['coding-agents', 'claude-code', 'codex', 'amp', 'cursor', 'aider'],
  'ai/context-prompting': ['prompting', 'prompt-engineering', 'context-engineering', 'context'],
  'ai/evals': ['evals', 'evaluation', 'evaluations', 'benchmarks'],
  'ai/models': ['llm', 'llms', 'openai', 'anthropic', 'google-ai', 'deepseek', 'deep-seek', 'open-models'],
  'ai/inference-infra': ['inference', 'serving', 'gpu', 'gpus', 'kv-cache', 'vllm'],
  'ai/rag-retrieval': ['rag', 'search', 'retrieval', 'embeddings', 'vector-search'],
  'ai/mcp-tooling': ['mcp', 'model-context-protocol'],
  'ai/ml-research': ['ml', 'machine-learning', 'interpretability', 'training', 'deep-learning'],
  'eng/devtools': ['dev-tools', 'devtools', 'git', 'cli', 'open-source', 'developer-tools'],
  'eng/architecture': ['architecture', 'systemdesign', 'system-design', 'distributed-systems'],
  'eng/backend': ['backend', 'api', 'apis', 'spring', 'django', 'fastapi'],
  'eng/frontend-mobile': ['frontend', 'mobile', 'flutter', 'design-ux', 'css', 'react', 'design', 'data-viz'],
  'eng/data': ['database', 'databases', 'data-structures', 'sql', 'postgres', 'postgresql'],
  'eng/infra-devops': ['devops', 'cloud', 'infra', 'infrastructure', 'networking', 'k8s', 'kubernetes', 'docker'],
  'eng/reliability': ['observability', 'testing', 'quality', 'sre', 'reliability'],
  'eng/security': ['security', 'cybersecurity', 'privacy'],
  'eng/languages': ['rust', 'typescript', 'haskell', 'java', 'python', 'golang', 'javascript'],
  'craft/career-leadership': ['career', 'leadership', 'management', 'engineering-manager'],
  'craft/productivity-learning': ['productivity', 'learning', 'tips', 'writing', 'self-improvement', 'personal-growth', 'motivation'],
  'biz/startups-product': ['startup', 'startups', 'product', 'business'],
  'biz/investing-finance': ['investing', 'personal-finance', 'finance', 'crypto', 'economics'],
  'life/health': ['health', 'parenting', 'fitness'],
  'life/culture-ideas': ['books', 'wisdom', 'philosophy', 'history', 'politics', 'culture', 'entertainment', 'music', 'travel', 'sports', 'humor'],
  'life/india': ['india'],
  'hw/robotics-iot': ['hardware', 'esp32', 'robotics', 'iot', 'energy'],
};

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

const TOPIC_BY_TAG = new Map(Object.entries(TOPIC_TAGS)
  .flatMap(([topic, tags]) => [topic, ...tags].map((tag) => [tag, topic] as const)));

export function topicsFromTags(tags: string[]): string[] {
  return [...new Set(tags.flatMap((tag) => {
    const topic = TOPIC_BY_TAG.get(normalizeTag(tag));
    return topic ? [topic] : [];
  }))].sort();
}
