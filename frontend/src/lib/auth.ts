// frontend/src/lib/auth.ts
const TOKEN_KEY = "pgba_access_token";
const REFRESH_KEY = "pgba_refresh_token";

export function isLoggedIn(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function saveTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  window.location.reload();
}
