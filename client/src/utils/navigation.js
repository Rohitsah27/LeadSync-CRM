/** Full-page navigation to another site (the Facebook login). Kept separate so tests can replace it. */
export function redirectTo(url) {
  window.location.assign(url);
}
