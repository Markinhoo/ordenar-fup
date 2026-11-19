export default function ThemeToggle({ theme, onToggle }) {
  const dark = theme === 'dark';
  return <button type="button" className="themeSwitch" role="switch" aria-checked={dark}
    aria-label={dark ? 'Tema oscuro; cambiar a claro' : 'Tema claro; cambiar a oscuro'}
    title={dark ? 'Activar tema claro' : 'Activar tema oscuro'} onClick={onToggle}>
    <span className="themeSwitchStars" aria-hidden="true" />
    <span className="themeSwitchClouds" aria-hidden="true" />
    <span className="themeSwitchThumb" aria-hidden="true" />
  </button>;
}
