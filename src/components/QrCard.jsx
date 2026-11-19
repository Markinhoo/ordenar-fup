import { useEffect, useRef } from 'react';
import { drawQr, downloadQr } from '../lib/qr';
import { qnaLabel } from '../lib/qna';

export default function QrCard({ worker, qna }) {
  const canvas = useRef(null);
  useEffect(() => {
    const url = new URL('/', location.href);
    url.searchParams.set('invite', worker.token);
    drawQr(canvas.current, url.href);
  }, [worker.token]);
  const filename = `${worker.name.replace(/[^\w\- ]/g, '').trim() || 'persona'}_${qnaLabel(qna)}_QR.png`;
  return <div className="worker-qr">
    <canvas ref={canvas} role="img" aria-label={`QR de ${worker.name}`} />
    <div><strong>{worker.name}</strong><small>{worker.email}</small><small>{worker.target} archivos físicos asignados</small>
      <button type="button" onClick={() => downloadQr(canvas.current, filename)}>Descargar QR</button></div>
  </div>;
}
