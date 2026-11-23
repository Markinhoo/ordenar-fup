import { useEffect, useRef, useState } from 'react';
import { accounts } from '../lib/api';
import { drawQr } from '../lib/qr';

export default function PersonalQr({ batchId, name }) {
  const canvas = useRef(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await accounts('issue-device');
        if (active) { setToken(response.token); setError(''); }
      } catch (cause) { if (active) setError(cause.message); }
    }
    refresh();
    const timer = setInterval(refresh, 90000);
    return () => { active = false; clearInterval(timer); };
  }, [version]);

  useEffect(() => {
    if (!token || !canvas.current || !batchId) return;
    const url = new URL('/', location.href);
    url.searchParams.set('b', batchId);
    url.hash = `pair=${token}`;
    drawQr(canvas.current, url.href);
  }, [token, batchId]);

  return <div className="personal-qr"><h2>Tu QR de acceso al celular</h2>
    <p>{name ? `${name}, ya iniciaste sesión` : 'Ya iniciaste sesión'}. Escanea este QR con el celular para abrir este lote en tu cuenta, sin escribir de nuevo usuario y contraseña. Cada QR dura dos minutos y solo se puede usar una vez.</p>
    {error ? <p role="alert">{error}</p> : token ? <canvas ref={canvas} role="img" aria-label="QR personal temporal para abrir tu cuenta en el celular" /> : <p>Preparando QR…</p>}
    <button type="button" onClick={() => setVersion((current) => current + 1)}>Renovar QR</button>
  </div>;
}
