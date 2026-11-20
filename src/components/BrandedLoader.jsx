export default function BrandedLoader({ message = 'Cargando tu cuenta…' }) {
  return <div className="branded-loader" role="status" aria-live="polite">
    <div className="branded-loader-content">
      <div className="branded-loader-logo"><img src="/nomina-seed.png" alt="" /></div>
      <strong>Ordenar FUP</strong><span>{message}</span>
      <div className="branded-loader-track"><i /></div>
    </div>
  </div>;
}
