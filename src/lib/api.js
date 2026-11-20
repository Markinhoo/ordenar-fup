export const sessionKey = 'ordenar-fup:auth-session';
export const lastBatchKey = 'ordenar-fup:last-v2-batch';
const config = window.FUP_SUPABASE;

export function readSession() {
  try { return JSON.parse(localStorage.getItem(sessionKey) || 'null'); }
  catch { return null; }
}

export function saveSession(data) {
  if (!data?.access_token || !data?.refresh_token) throw new Error('Respuesta de sesión inválida');
  const session = { access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    username: data.username || readSession()?.username || '' };
  localStorage.setItem(sessionKey, JSON.stringify(session));
  return session;
}

async function authRequest(path, body, token = config.key) {
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: 'POST', cache: 'no-store', headers: { apikey: config.key,
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.message || data.error_description || `Error ${response.status}`);
  return data;
}

export async function login(username, password) {
  return saveSession(await accounts('login', { username: username.trim(), password }, true));
}

export async function logout() {
  const session = readSession();
  localStorage.removeItem(sessionKey);
  if (session?.access_token) authRequest('logout', {}, session.access_token).catch(() => {});
}

async function accessToken() {
  const session = readSession();
  if (!session) throw new Error('Inicia sesión primero.');
  if (session.expires_at > Date.now() + 60000) return session.access_token;
  try { return saveSession(await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })).access_token; }
  catch { localStorage.removeItem(sessionKey); throw new Error('La sesión terminó. Entra de nuevo.'); }
}

export async function rpc(name, params = {}) {
  const token = await accessToken();
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', cache: 'no-store', headers: { apikey: config.key,
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Profile': 'fup-sep' },
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Error ${response.status}`);
  return data;
}

export async function accounts(action, params = {}, publicRequest = false) {
  const token = publicRequest ? config.key : await accessToken();
  const response = await fetch(`${config.url}/functions/v1/fup-accounts`, {
    method: 'POST', cache: 'no-store', headers: { apikey: config.key,
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

export async function isAdmin() { return (await rpc('v2_my_role')).isAdmin === true; }

export async function sharedRpc(name, params) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST', cache: 'no-store', headers: { apikey: config.key,
      Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', 'Content-Profile': 'fup-sep' },
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || `Error ${response.status}`);
  return data;
}
