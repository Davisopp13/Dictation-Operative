export const workspacePages = [
  { value: 'capture', label: 'Capture' },
  { value: 'clipboard', label: 'Clipboard' },
  { value: 'compose', label: 'Compose' },
] as const;

export type WorkspacePage = (typeof workspacePages)[number]['value'];
type Browser = Pick<Window, 'localStorage' | 'sessionStorage' | 'performance'>;

export function isWorkspacePage(value: unknown): value is WorkspacePage {
  return workspacePages.some((page) => page.value === value);
}

const startKey = (account: string) => `do-start-page:${account}`;
const currentKey = (account: string) => `do-current-page:${account}`;

export function readWorkspaceNavigation(
  account: string,
  browser: Browser = window,
) {
  let startPage: WorkspacePage = 'capture';
  try {
    const saved = browser.localStorage.getItem(startKey(account));
    if (isWorkspacePage(saved)) startPage = saved;
  } catch {
    // Browsing still works when storage is unavailable.
  }
  let view = startPage;
  try {
    const navigation = browser.performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    // A new visit uses the start page, even if the browser copied another
    // tab's session storage. Reload and history restoration keep this tab.
    if (navigation?.type === 'reload' || navigation?.type === 'back_forward') {
      const saved = browser.sessionStorage.getItem(currentKey(account));
      if (isWorkspacePage(saved)) view = saved;
    }
  } catch {
    // Fall back to the chosen start page if session storage is blocked.
  }
  return { startPage, view };
}

export function rememberWorkspacePage(
  account: string,
  page: WorkspacePage,
  browser: Browser = window,
) {
  try {
    browser.sessionStorage.setItem(currentKey(account), page);
  } catch {
    // A storage restriction must not prevent switching tabs.
  }
}

export function saveStartPage(
  account: string,
  page: WorkspacePage,
  browser: Browser = window,
) {
  try {
    browser.localStorage.setItem(startKey(account), page);
  } catch {
    throw new Error(
      'Could not save your start page. Allow site storage and try again.',
    );
  }
}
