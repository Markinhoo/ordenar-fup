import { useEffect, useRef, useState } from 'react';
import { rpc } from '../lib/api';
import { getDocumentWorker, parseScanText } from '../lib/ocr';

export default function ScanModal({ batch, mode, photo, onClose, onRefresh, onMessage }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [result, setResult] = useState(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('Alinea todo el recuadro dentro de la guía.');

  useEffect(() => {
    if (mode !== 'camera') return;
    let active = true;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { onMessage('Este navegador no permite cámara en vivo. Usa «Tomar foto del recuadro».', true); onClose(); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('Alinea las tres filas del recuadro dentro de la guía.');
      } catch (error) {
        onMessage(error?.name === 'NotAllowedError' ? 'La cámara no tiene permiso. Actívalo o usa «Tomar foto del recuadro».'
          : 'No se pudo abrir la cámara. Usa «Tomar foto del recuadro».', true);
        onClose();
      }
    }
    start();
    return () => { active = false; videoRef.current?.pause(); if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  }, [mode]);

  useEffect(() => { if (mode === 'photo' && photo) readImage(photo); }, [mode, photo]);
  useEffect(() => { setResult(null); }, [mode, photo]);

  async function readImage(image) {
    if (reading || !batch || batch.isAdmin) return;
    setReading(true); setResult(null); setStatus('Leyendo procedencia, nivel, folio y fecha…');
    try {
      const worker = await getDocumentWorker();
      const { data } = await worker.recognize(image);
      const parsed = parseScanText(data.text, batch.records);
      if (data.confidence < 40 || !parsed.procedencia || !parsed.nivel || !parsed.folio || !parsed.documentDate) {
        setStatus('No se leyeron claramente las cuatro partes del recuadro. Acerca la cámara, mejora la luz y vuelve a intentar.');
        onMessage(`Lectura incompleta. Texto detectado: ${String(data.text).trim().slice(0, 160) || 'ninguno'}`, true);
        return;
      }
      setResult(parsed); setStatus('Compara estos datos con el documento físico y confirma si son correctos.');
    } catch (error) { setStatus(error.message); onMessage(error.message, true); }
    finally { setReading(false); }
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth) { setStatus('Espera a que aparezca la imagen.'); return; }
    const width = video.videoWidth * .84;
    const height = Math.min(video.videoHeight * .45, width / 3.4);
    const canvas = document.createElement('canvas'); canvas.width = Math.round(width * 2); canvas.height = Math.round(height * 2);
    canvas.getContext('2d').drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2,
      width, height, 0, 0, canvas.width, canvas.height);
    readImage(canvas);
  }

  async function save() {
    if (!result || saving) return;
    setSaving(true);
    try {
      const saved = await rpc('v2_scan_document', { p_batch_id: batch.id, p_folio: result.folio,
        p_procedencia: result.procedencia, p_nivel: result.nivel, p_document_date: result.documentDate });
      onMessage(saved.status === 'new' ? `Folio ${saved.folio} registrado por escaneo.`
        : `El folio ${saved.folio} ya estaba registrado por ${saved.checkedBy}. El nuevo intento quedó en la bitácora.`);
      setResult(null); setStatus('Guardado. Coloca el siguiente documento y lee el recuadro.');
      await onRefresh();
      if (mode === 'photo') onClose();
    } catch (error) { setStatus(error.message); onMessage(error.message, true); }
    finally { setSaving(false); }
  }

  if (!mode) return null;
  return <div className="scan-modal" role="dialog" aria-modal="true" aria-label="Escanear recuadro del documento" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="scan-card"><div className="scan-heading"><strong>Escanear recuadro completo</strong><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      {mode === 'camera' && <div className="video-wrap"><video ref={videoRef} autoPlay playsInline muted /><div className="scan-guide">PROCEDENCIA · NIVEL · No. DE DOCUMENTO · FECHA</div></div>}
      <p role="status">{status}</p>
      {mode === 'camera' && <button className="primary" type="button" onClick={capture} disabled={reading || saving}>Leer recuadro</button>}
      {result && <div id="scanResult"><dl>
        <div><dt>Procedencia</dt><dd>{result.procedencia}</dd></div><div><dt>Nivel</dt><dd>{result.nivel}</dd></div>
        <div><dt>No. de documento</dt><dd>{result.folio}</dd></div><div><dt>Fecha</dt><dd>{result.documentDate}</dd></div>
      </dl><button className="primary" type="button" onClick={save} disabled={saving}>Confirmar y guardar escaneo</button>
        <button type="button" onClick={() => { setResult(null); setStatus('Vuelve a leer el recuadro.'); }}>Volver a leer</button></div>}
    </div>
  </div>;
}
