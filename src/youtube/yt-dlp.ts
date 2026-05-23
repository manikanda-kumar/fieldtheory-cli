export interface YtDlpAccessOptions {
  cookiesFromBrowser?: string;
  cookiesFile?: string;
  impersonate?: string;
}

export function ytDlpAccessArgs(options: YtDlpAccessOptions | undefined): string[] {
  const args: string[] = [];
  if (options?.cookiesFromBrowser) args.push('--cookies-from-browser', options.cookiesFromBrowser);
  if (options?.cookiesFile) args.push('--cookies', options.cookiesFile);
  if (options?.impersonate) args.push('--impersonate', options.impersonate);
  return args;
}
