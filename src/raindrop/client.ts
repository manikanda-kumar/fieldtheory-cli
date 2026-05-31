import type {
  RaindropApiResponse,
  RaindropCollectionsResponse,
} from './types.js';

const BASE_URL = 'https://api.raindrop.io/rest/v1';

function getToken(): string {
  const token = process.env.RAINDROP_TOKEN || process.env.RAINDROP_TEST_TOKEN;
  if (!token) {
    throw new Error('RAINDROP_TOKEN environment variable is not set.');
  }
  return token;
}

async function fetchWithRetry<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const attempts = 3;
  const baseDelayMs = 1_000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (response.status === 401) {
        throw new Error('Raindrop API returned 401. RAINDROP_TOKEN may be invalid or expired.');
      }

      if (response.status === 429) {
        if (attempt === attempts - 1) {
          throw new Error(`Raindrop API rate limited (429) after ${attempts} attempts.`);
        }
        const backoff = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * (baseDelayMs / 2));
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Raindrop API ${response.status}: ${body || response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
      // Re-throw non-retryable errors immediately
      if (
        error instanceof Error &&
        (error.message.includes('401') || error.message.includes('RAINDROP_TOKEN'))
      ) {
        throw error;
      }
      const backoff = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * (baseDelayMs / 2));
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw new Error('Unexpected end of fetchWithRetry');
}

export async function fetchCollections(): Promise<RaindropCollectionsResponse> {
  return fetchWithRetry<RaindropCollectionsResponse>(`${BASE_URL}/collections`);
}

export async function fetchRaindropsPage(
  collectionId: number = 0,
  page: number = 0,
  perPage: number = 50,
): Promise<RaindropApiResponse> {
  const url = `${BASE_URL}/raindrops/${collectionId}?page=${page}&perpage=${perPage}`;
  return fetchWithRetry<RaindropApiResponse>(url);
}
