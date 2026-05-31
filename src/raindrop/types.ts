export interface RaindropCollection {
  _id: number;
  title: string;
  parent?: { $id: number } | null;
  access?: { for: number; level: number };
}

export interface RaindropHighlight {
  _id: string;
  text: string;
  color?: string;
  note?: string;
  created?: string;
}

export interface RaindropMediaItem {
  type: string;
  link: string;
}

export interface RaindropBookmark {
  _id: number;
  link: string;
  title: string;
  excerpt?: string;
  note?: string;
  highlights?: RaindropHighlight[];
  tags?: string[];
  collection?: RaindropCollection | { $id: number };
  created: string;
  lastUpdate?: string;
  type?: string;
  cover?: string;
  media?: RaindropMediaItem[];
  domain?: string;
  important?: boolean;
}

export interface RaindropApiResponse {
  result: boolean;
  count?: number;
  items: RaindropBookmark[];
}

export interface RaindropCollectionsResponse {
  result: boolean;
  items: RaindropCollection[];
}

export interface RaindropRecord {
  id: number;
  url: string;
  title: string;
  excerpt?: string;
  note?: string;
  highlights?: RaindropHighlight[];
  tags?: string[];
  collectionId?: number;
  collectionName?: string;
  collectionPath?: string[];
  createdAt: string;
  updatedAt?: string;
  type?: string;
  cover?: string;
  domain?: string;
  important?: boolean;
  mediaCount?: number;
  links?: string[];
  syncedAt: string;
}

export interface RaindropMeta {
  lastSyncedAt?: string;
  totalCount?: number;
  syncedCount?: number;
  collectionsSyncedAt?: string;
  collectionMap?: Record<number, { title: string; path?: string[] }>;
}

export interface RaindropBackfillState {
  lastPageFetched?: number;
  perPage?: number;
  completed?: boolean;
  completedAt?: string;
}
