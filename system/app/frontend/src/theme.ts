export type Theme = 'day' | 'night';
export function initialTheme(): Theme {
  try { return localStorage.getItem('evidence-theme') === 'night' ? 'night' : 'day'; }
  catch { return 'day'; }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  try { localStorage.setItem('evidence-theme', theme); } catch { /* Preferences are optional when browser storage is restricted. */ }
}
