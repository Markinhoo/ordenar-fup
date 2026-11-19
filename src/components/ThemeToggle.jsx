export default function ThemeToggle({ theme, onToggle }) {
  const dark = theme === 'dark';
  return <button type="button" className="fup-theme-toggle" role="switch" aria-checked={dark}
    aria-label={dark ? 'Tema oscuro; cambiar a claro' : 'Tema claro; cambiar a oscuro'}
    title={dark ? 'Activar tema claro' : 'Activar tema oscuro'} onClick={onToggle}>
    <span aria-hidden="true">{dark ? '☾' : '☀'}</span><span>{dark ? 'Oscuro' : 'Claro'}</span>
  </button>;
}
