import { useEffect, useRef } from 'react';
import { drawQr, downloadQr } from '../lib/qr';
import { qnaLabel } from '../lib/qna';

export default function QrCard({ worker, qna, batchId }) {
  const canvas = useRef(null);
  useEffect(() => {
    const url = new URL('/', location.href);
    url.searchParams.set('b', batchId);
    url.searchParams.set('w', worker.id);
    drawQr(canvas.current, url.href);
  }, [batchId, worker.id]);
  const filename = `${worker.name.replace(/[^\w\- ]/g, '').trim() || 'persona'}_${qnaLabel(qna)}_QR.png`;
  return <div className="worker-qr">
    <canvas ref={canvas} role="img" aria-label={`QR de ${worker.name}`} />
    <div><strong>{worker.name}</strong><small>{worker.target} hojas asignadas</small>
      <button type="button" onClick={() => downloadQr(canvas.current, filename)}>Descargar QR</button></div>
  </div>;
}
