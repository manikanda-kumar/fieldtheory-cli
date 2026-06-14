export interface GitHubRepositoryPayload {
  id: number;
  full_name: string;
  name: string;
  owner?: {
    login?: string;
    html_url?: string;
  };
  html_url: string;
  description?: string | null;
  homepage?: string | null;
  language?: string | null;
  topics?: string[];
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  archived?: boolean;
  fork?: boolean;
  default_branch?: string | null;
  pushed_at?: string | null;
  updated_at?: string | null;
}

export interface GitHubStarApiItem {
  starred_at?: string | null;
  repo?: GitHubRepositoryPayload;
}

export interface GitHubStarRecord {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  description: string | null;
  homepageUrl: string | null;
  language: string | null;
  topics: string[];
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  isArchived: boolean;
  isFork: boolean;
  defaultBranch: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  starredAt: string | null;
  syncedAt: string;
}

export interface GitHubStarsMeta {
  lastSyncAt: string;
  lastStarredAt: string | null;
  totalStars: number;
}
