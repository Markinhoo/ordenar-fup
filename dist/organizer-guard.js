const sessionKey = 'ordenar-fup:auth-session';
const config = window.FUP_SUPABASE;

async function showOrganizer() {
  let session;
  try { session = JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { session = null; }
  if (!session?.access_token || !session?.refresh_token) return location.replace('./control.html');

  try {
    if (session.expires_at <= Date.now() + 60000) {
      const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', cache: 'no-store',
        headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!response.ok) throw new Error('La sesión terminó');
      const refreshed = await response.json();
      session = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token,
        expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000,
        email: refreshed.user?.email || session.email };
      localStorage.setItem(sessionKey, JSON.stringify(session));
    }
    const response = await fetch(`${config.url}/rest/v1/rpc/v2_my_role`, {
      method: 'POST', cache: 'no-store',
      headers: { apikey: config.key, Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json', 'Content-Profile': 'fup-sep' },
      body: '{}',
    });
    if (!response.ok || !(await response.json()).isAdmin) return location.replace('./control.html');
    await import('./main.js');
    document.querySelector('.shell').hidden = false;
  } catch { location.replace('./control.html'); }
}

showOrganizer();
