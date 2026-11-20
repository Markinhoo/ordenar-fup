import { useState } from 'react';
import { accounts } from '../lib/api';
import { useTheme } from '../lib/theme';
import ThemeToggle from '../components/ThemeToggle';
import '../styles/activate.css';

function readToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  return token;
}

export default function ActivatePage() {
  const [theme, toggleTheme] = useTheme();
  const [token] = useState(readToken);
  const [password, setPassword] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = /^[a-f0-9]{64}$/.test(token);

  async function activate(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await accounts('activate-admin', { token, password, question, answer }, true);
      setDone(true); setPassword(''); setAnswer(''); setMessage('Cuenta activada.'); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <div className="activate-page"><div className="activate-card">
    <div className="activate-top"><small>ORDENAR FUP · ACCESO INICIAL</small><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
    <h1>Activa la cuenta administradora</h1>
    <p>Usuario: <strong>nomina</strong>. Define tu contraseña y una pregunta que solo tú puedas responder. Este enlace vence en 24 horas y funciona una vez.</p>
    {valid && !done && <form onSubmit={activate}>
      <label>Contraseña<input type="password" autoComplete="new-password" minLength="8" maxLength="128" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      <label>Pregunta de respaldo<input minLength="10" maxLength="160" placeholder="Una pregunta que solo tú sepas responder" value={question} onChange={(event) => setQuestion(event.target.value)} required /></label>
      <label>Respuesta de respaldo<input type="password" autoComplete="off" minLength="1" maxLength="160" value={answer} onChange={(event) => setAnswer(event.target.value)} required /></label>
      <button disabled={busy}>Activar mi cuenta</button>
    </form>}
    <p className={done ? 'ok' : 'error'} role="status">{valid ? message : 'Enlace de activación inválido. Solicita uno nuevo a la persona encargada.'}</p>
    <a href="/">{done ? 'Iniciar sesión' : 'Volver al acceso'}</a>
  </div></div>;
}
