export type Theme = 'day' | 'night';
export function initialTheme(): Theme {
  try { return localStorage.getItem('evidence-theme') === 'night' ? 'night' : 'day'; }
  catch { return 'day'; }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'night' ? '#262522' : '#faf9f5');
  try { localStorage.setItem('evidence-theme', theme); } catch { /* Preferences are optional when browser storage is restricted. */ }
}
