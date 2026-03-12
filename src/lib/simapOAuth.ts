const SIMAP_AUTH_URL =
  'https://www.simap.ch/auth/realms/simap/protocol/openid-connect/auth';
const SIMAP_CLIENT_ID = 'bidpilot-tenders';
const SIMAP_SCOPES = 'openid profile email';

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array.buffer);
}

async function generatePKCE(): Promise<{
  code_verifier: string;
  code_challenge: string;
}> {
  const code_verifier = generateRandomString(32);
  const encoder = new TextEncoder();
  const data = encoder.encode(code_verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const code_challenge = base64UrlEncode(digest);
  return { code_verifier, code_challenge };
}

export async function startSIMAPAuth(): Promise<void> {
  const { code_verifier, code_challenge } = await generatePKCE();
  const state = generateRandomString(16);

  // Store PKCE verifier and state for the callback
  sessionStorage.setItem('simap_pkce_verifier', code_verifier);
  sessionStorage.setItem('simap_oauth_state', state);

  const redirectUri = `${window.location.origin}/simap/callback`;

  const params = new URLSearchParams({
    client_id: SIMAP_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SIMAP_SCOPES,
    code_challenge,
    code_challenge_method: 'S256',
    state,
  });

  window.location.href = `${SIMAP_AUTH_URL}?${params.toString()}`;
}

export function getSIMAPCallbackData(): {
  code: string | null;
  state: string | null;
  error: string | null;
  code_verifier: string | null;
  stored_state: string | null;
  redirect_uri: string;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    code_verifier: sessionStorage.getItem('simap_pkce_verifier'),
    stored_state: sessionStorage.getItem('simap_oauth_state'),
    redirect_uri: `${window.location.origin}/simap/callback`,
  };
}

export function clearSIMAPSession(): void {
  sessionStorage.removeItem('simap_pkce_verifier');
  sessionStorage.removeItem('simap_oauth_state');
}
