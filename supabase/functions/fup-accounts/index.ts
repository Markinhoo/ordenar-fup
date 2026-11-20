// @ts-nocheck
// Deployed in Supabase, so the service-role key never leaves the Aria project.
const projectUrl = Deno.env.get('SUPABASE_URL') || '';
const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const origins = new Set(['https://ordenador-rfc.vercel.app', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:5175', 'http://127.0.0.1:5176', 'http://127.0.0.1:5177']);
const encoder = new TextEncoder();

function reply(data, status = 200, origin = '') {
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origins.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin',
  } });
}

async function supabase(path, method = 'GET', body, token = secretKey, profile = '') {
  const headers = { apikey: token === secretKey ? secretKey : publicKey,
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (profile) headers[method === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = profile;
  if (method === 'POST' && path.includes('/v3_accounts')) headers.Prefer = 'return=representation';
  const response = await fetch(`${projectUrl}${path}`, { method, headers,
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.msg || data?.message || `Supabase ${response.status}`);
  return data;
}

async function currentUser(request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || token === publicKey || token === secretKey) return null;
  try {
    const user = await supabase('/auth/v1/user', 'GET', undefined, token);
    return user?.id && user?.email ? { id: user.id, email: user.email.toLowerCase(), token } : null;
  } catch { return null; }
}

async function isAdmin(user) {
  const role = await supabase('/rest/v1/rpc/v2_my_role', 'POST', {}, user.token, 'fup-sep');
  return role?.isAdmin === true;
}

async function accountByUser(userId) {
  const rows = await supabase(`/rest/v1/v3_accounts?user_id=eq.${encodeURIComponent(userId)}&select=user_id,email,username,name,role,recovery_question`,
    'GET', undefined, secretKey, 'fup-sep');
  return rows?.[0] || null;
}

async function accountByUsername(username) {
  const rows = await supabase(`/rest/v1/v3_accounts?username=eq.${encodeURIComponent(username)}&select=user_id,email,username,name,role,recovery_question`,
    'GET', undefined, secretKey, 'fup-sep');
  return rows?.[0] || null;
}

function cleanUsername(value) { return String(value || '').trim().toLowerCase(); }
function validUsername(value) { return /^[a-z][a-z0-9._-]{2,31}$/.test(value); }
function validPassword(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 128; }
function normalizedAnswer(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('es'); }
function hex(bytes) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

async function answerHash(answer, salt) {
  const input = await crypto.subtle.importKey('raw', encoder.encode(`${normalizedAnswer(answer)}\0${secretKey}`),
    'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt),
    iterations: 180000, hash: 'SHA-256' }, input, 256));
}

function equalHash(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || '';
  if (origin && !origins.has(origin)) return reply({ error: 'Origen no permitido' }, 403, origin);
  if (request.method === 'OPTIONS') return reply({}, 204, origin);
  if (request.method !== 'POST') return reply({ error: 'Método no permitido' }, 405, origin);
  if (!projectUrl || !publicKey || !secretKey) return reply({ error: 'Servicio de cuentas no configurado' }, 503, origin);

  let input;
  try {
    const raw = await request.text();
    if (raw.length > 8000) return reply({ error: 'Solicitud demasiado grande' }, 413, origin);
    input = JSON.parse(raw);
  } catch { return reply({ error: 'Solicitud inválida' }, 400, origin); }

  try {
    if (input.action === 'login') {
      const username = cleanUsername(input.username);
      if (!validUsername(username) || typeof input.password !== 'string')
        return reply({ error: 'Usuario o contraseña incorrectos' }, 401, origin);
      const account = await accountByUsername(username);
      if (!account) return reply({ error: 'Usuario o contraseña incorrectos' }, 401, origin);
      try {
        const session = await supabase('/auth/v1/token?grant_type=password', 'POST',
          { email: account.email, password: input.password }, publicKey);
        return reply({ ...session, username }, 200, origin);
      } catch { return reply({ error: 'Usuario o contraseña incorrectos' }, 401, origin); }
    }

    if (input.action === 'question') {
      const username = cleanUsername(input.username);
      if (!validUsername(username)) return reply({ error: 'Escribe un nombre de usuario válido' }, 400, origin);
      const account = await accountByUsername(username);
      return reply({ question: account?.recovery_question || null }, 200, origin);
    }

    if (input.action === 'recover') {
      const username = cleanUsername(input.username);
      if (!validUsername(username) || normalizedAnswer(input.answer).length < 8 || !validPassword(input.password))
        return reply({ error: 'Completa usuario, respuesta y contraseña de al menos 8 caracteres' }, 400, origin);
      const account = await accountByUsername(username);
      const attempt = await supabase('/rest/v1/rpc/v3_take_recovery_attempt', 'POST',
        { p_email: account?.email || '' }, secretKey, 'fup-sep');
      if (attempt?.locked) return reply({ error: 'Demasiados intentos. Espera 30 minutos.' }, 429, origin);
      if (!attempt?.userId || !equalHash(await answerHash(input.answer, attempt.salt), attempt.hash))
        return reply({ error: 'Respuesta de respaldo incorrecta' }, 400, origin);
      await supabase(`/auth/v1/admin/users/${attempt.userId}`, 'PUT', { password: input.password });
      await supabase('/rest/v1/rpc/v3_clear_recovery_attempts', 'POST',
        { p_user_id: attempt.userId }, secretKey, 'fup-sep');
      return reply({ ok: true }, 200, origin);
    }

    if (input.action === 'activate-admin') {
      const token = String(input.token || '');
      const question = String(input.question || '').trim();
      const answer = normalizedAnswer(input.answer);
      if (!/^[a-f0-9]{64}$/.test(token) || !validPassword(input.password) ||
          question.length < 10 || question.length > 160 || answer.length < 8 || answer.length > 160)
        return reply({ error: 'Completa el enlace, contraseña y pregunta de respaldo' }, 400, origin);
      const userId = await supabase('/rest/v1/rpc/v4_consume_admin_activation', 'POST',
        { p_token: token }, secretKey, 'fup-sep');
      if (!userId) return reply({ error: 'El enlace ya se usó o venció' }, 403, origin);
      const account = await accountByUser(userId);
      if (!account || account.email !== 'nomina@fup.com')
        return reply({ error: 'Cuenta administradora no disponible' }, 403, origin);
      await supabase(`/auth/v1/admin/users/${userId}`, 'PUT', { password: input.password });
      const salt = crypto.randomUUID();
      await supabase(`/rest/v1/v3_accounts?user_id=eq.${encodeURIComponent(userId)}`, 'PATCH',
        { recovery_question: question, recovery_salt: salt, recovery_hash: await answerHash(answer, salt),
          recovery_attempts: 0, recovery_locked_until: null }, secretKey, 'fup-sep');
      return reply({ ok: true }, 200, origin);
    }

    const user = await currentUser(request);
    if (!user) return reply({ error: 'Inicia sesión' }, 401, origin);
    const admin = await isAdmin(user);

    if (input.action === 'profile') {
      const account = await accountByUser(user.id);
      if (!account) return reply({ error: 'La encargada debe crear tu cuenta' }, 403, origin);
      return reply({ id: account.user_id, username: account.username, name: account.name, role: account.role,
        question: account.recovery_question || '', recoverySet: !!account.recovery_question,
        isAdmin: admin }, 200, origin);
    }

    const account = await accountByUser(user.id);
    if (!account) return reply({ error: 'Cuenta sin autorización FUP' }, 403, origin);

    if (input.action === 'set-recovery') {
      const question = String(input.question || '').trim();
      const answer = normalizedAnswer(input.answer);
      if (question.length < 10 || question.length > 160 || answer.length < 8 || answer.length > 160)
        return reply({ error: 'Pregunta de 10 a 160 caracteres y respuesta de 8 a 160' }, 400, origin);
      const salt = crypto.randomUUID();
      await supabase(`/rest/v1/v3_accounts?user_id=eq.${encodeURIComponent(user.id)}`, 'PATCH',
        { recovery_question: question, recovery_salt: salt, recovery_hash: await answerHash(answer, salt),
          recovery_attempts: 0, recovery_locked_until: null }, secretKey, 'fup-sep');
      return reply({ ok: true }, 200, origin);
    }

    if (input.action === 'change-password') {
      if (!validPassword(input.password) || typeof input.currentPassword !== 'string')
        return reply({ error: 'Escribe la contraseña actual y una nueva de al menos 8 caracteres' }, 400, origin);
      let verified;
      try { verified = await supabase('/auth/v1/token?grant_type=password', 'POST',
        { email: user.email, password: input.currentPassword }, publicKey); }
      catch { return reply({ error: 'Contraseña actual incorrecta' }, 403, origin); }
      if (verified?.user?.id !== user.id) return reply({ error: 'Contraseña actual incorrecta' }, 403, origin);
      await supabase(`/auth/v1/admin/users/${user.id}`, 'PUT', { password: input.password });
      return reply({ ok: true }, 200, origin);
    }

    if (!admin) return reply({ error: 'Solo la cuenta administradora puede gestionar usuarios' }, 403, origin);

    if (input.action === 'list-users') {
      const rows = await supabase('/rest/v1/v3_accounts?select=user_id,username,name,role,recovery_question,created_at&order=created_at.asc',
        'GET', undefined, secretKey, 'fup-sep');
      return reply({ users: rows.map((row) => ({ id: row.user_id, username: row.username,
        name: row.name, role: row.role, recoverySet: !!row.recovery_question })) }, 200, origin);
    }

    if (input.action === 'create-user') {
      const username = cleanUsername(input.username);
      const name = String(input.name || username).trim();
      const role = String(input.role || 'operador');
      const question = String(input.question || '').trim();
      const answer = normalizedAnswer(input.answer);
      if (!validUsername(username) || name.length < 2 || name.length > 80 ||
        !validPassword(input.password) || !['administrador', 'operador'].includes(role) ||
        question.length < 10 || question.length > 160 || answer.length < 8 || answer.length > 160)
        return reply({ error: 'Completa usuario, nombre, rol, contraseña y pregunta de respaldo válidos' }, 400, origin);
      if (await accountByUsername(username)) return reply({ error: 'Ese nombre de usuario ya existe' }, 409, origin);
      const email = `${username}@users.ordenar-fup.invalid`;
      const salt = crypto.randomUUID();
      const created = await supabase('/auth/v1/admin/users', 'POST',
        { email, password: input.password, email_confirm: true, user_metadata: { name, username } });
      try { await supabase('/rest/v1/v3_accounts', 'POST',
        { user_id: created.id, email, username, name, role, recovery_question: question,
          recovery_salt: salt, recovery_hash: await answerHash(answer, salt) }, secretKey, 'fup-sep'); }
      catch (error) {
        await supabase(`/auth/v1/admin/users/${created.id}`, 'DELETE').catch(() => {});
        throw error;
      }
      return reply({ username, name, role }, 200, origin);
    }

    if (input.action === 'set-role') {
      const target = await accountByUser(String(input.userId || ''));
      const role = String(input.role || '');
      if (!target || !['administrador', 'operador'].includes(role)) return reply({ error: 'Usuario o rol inválido' }, 400, origin);
      if (target.user_id === user.id) return reply({ error: 'No puedes cambiar tu propio rol' }, 400, origin);
      await supabase(`/rest/v1/v3_accounts?user_id=eq.${encodeURIComponent(target.user_id)}`, 'PATCH',
        { role }, secretKey, 'fup-sep');
      return reply({ ok: true }, 200, origin);
    }

    if (input.action === 'update-user') {
      const target = await accountByUser(String(input.userId || ''));
      const username = cleanUsername(input.username);
      const name = String(input.name || '').trim();
      if (!target || !validUsername(username) || name.length < 2 || name.length > 80)
        return reply({ error: 'Usuario o nombre inválido' }, 400, origin);
      const taken = await accountByUsername(username);
      if (taken && taken.user_id !== target.user_id) return reply({ error: 'Ese nombre de usuario ya existe' }, 409, origin);
      await supabase(`/rest/v1/v3_accounts?user_id=eq.${encodeURIComponent(target.user_id)}`, 'PATCH',
        { username, name }, secretKey, 'fup-sep');
      return reply({ ok: true }, 200, origin);
    }

    if (input.action === 'set-user-password') {
      const target = await accountByUser(String(input.userId || ''));
      if (!target || !validPassword(input.password) || target.user_id === user.id)
        return reply({ error: 'Elige otra cuenta y una contraseña de al menos 8 caracteres' }, 400, origin);
      await supabase(`/auth/v1/admin/users/${target.user_id}`, 'PUT', { password: input.password });
      return reply({ ok: true }, 200, origin);
    }
    return reply({ error: 'Acción no reconocida' }, 400, origin);
  } catch (error) {
    console.error('fup-accounts error:', error?.message || error);
    return reply({ error: 'No se pudo completar la operación. Intenta de nuevo.' }, 500, origin);
  }
});
