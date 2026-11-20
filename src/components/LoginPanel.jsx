import { useState } from 'react';
import { accounts, login } from '../lib/api';
import BrandedLoader from './BrandedLoader';

export default function LoginPanel({ onLogin }) {
  const [recovery, setRecovery] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const invite = new URLSearchParams(location.search).has('invite');

  async function signIn(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { const session = await login(username, password); setPassword(''); onLogin(session); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function loadQuestion() {
    setBusy(true); setMessage('');
    try { const result = await accounts('question', { username: recoveryUsername }, true);
      setQuestion(result.question || 'No hay pregunta configurada para esta cuenta. Pide ayuda a la encargada.'); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function recover(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await accounts('recover', { username: recoveryUsername, answer, password: newPassword }, true);
      setUsername(recoveryUsername.trim()); setAnswer(''); setNewPassword(''); setRecovery(false);
      setMessage('Contraseña actualizada. Ya puedes entrar.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <main className="auth-panel"><div className="auth-card login-card">
    <div className="login-logo"><img src="/nomina-seed.png" alt="Revisión de Nómina SEED, Gobierno del Estado de Durango" /></div>
    {recovery && <><h1>Recuperar acceso</h1><p className="login-description">Responde tu pregunta de respaldo para crear una contraseña nueva.</p></>}
    {invite && !recovery && <p className="login-invite">Entra con la cuenta que la encargada creó para ti.</p>}
    {!recovery ? <><form className="login-form" onSubmit={signIn}>
      <label>Nombre de usuario<span className="login-field"><span aria-hidden="true">●</span><input autoComplete="username" placeholder="Tu usuario" value={username} onChange={(event) => setUsername(event.target.value)} required /></span></label>
      <label>Contraseña<span className="login-field"><span aria-hidden="true">●</span><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Tu contraseña" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="password-toggle" type="button" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button></span></label>
      <button className="primary" disabled={busy}>Entrar</button>
    </form><button className="text-button" type="button" onClick={() => { setRecovery(true); setRecoveryUsername(username); setMessage(''); }}>Olvidé mi contraseña</button></>
      : <form className="login-form" onSubmit={recover}>
        <label>Nombre de usuario<span className="login-field"><input autoComplete="username" value={recoveryUsername} onChange={(event) => setRecoveryUsername(event.target.value)} required /></span></label>
        <button type="button" onClick={loadQuestion} disabled={busy}>Ver pregunta de respaldo</button>
        {question && <p className="recovery-question">{question}</p>}
        <label>Respuesta de respaldo<span className="login-field"><input type="password" autoComplete="off" minLength="8" value={answer} onChange={(event) => setAnswer(event.target.value)} required /></span></label>
        <label>Nueva contraseña<span className="login-field"><input type="password" autoComplete="new-password" minLength="8" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></span></label>
        <button className="primary" disabled={busy}>Restablecer contraseña</button>
        <button type="button" className="text-button" onClick={() => { setRecovery(false); setMessage(''); }}>Volver al acceso</button>
      </form>}
    <p className={`message${message ? ' error' : ''}`} role="status">{message}</p>
  </div>{busy && <BrandedLoader message={recovery ? 'Procesando solicitud…' : 'Iniciando sesión…'} />}</main>;
}
