import { useEffect, useRef, useState } from 'react';
import { rpc } from '../lib/api';
import { readDocumentFields } from '../lib/ocr';

export default function ScanModal({ batch, mode, photo, onClose, onRefresh, onMessage }) {
  const videoRef = useRef(null);
  const guideRef = useRef(null);
  const modalRef = useRef(null);
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
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
  useEffect(() => () => {
    if (document.fullscreenElement === modalRef.current) {
      screen.orientation?.unlock?.();
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  async function expandCamera() {
    if (!modalRef.current?.requestFullscreen) {
      setStatus('Gira el celular a horizontal. Si el giro está bloqueado, actívalo en los ajustes del teléfono.');
      return;
    }
    try {
      await modalRef.current.requestFullscreen();
      if (screen.orientation?.lock) {
        await screen.orientation.lock('landscape');
        setStatus('Coloca las tres filas dentro de la guía y pulsa Leer recuadro.');
      } else setStatus('Gira el celular a horizontal para ampliar la cámara.');
    } catch {
      setStatus('Gira el celular a horizontal. Si el giro está bloqueado, actívalo en los ajustes del teléfono.');
    }
  }

  async function readImage(image) {
    if (reading || !batch || batch.isAdmin) return;
    setReading(true); setResult(null); setStatus('Leyendo procedencia, nivel, folio y fecha…');
    try {
      const parsed = await readDocumentFields(image, batch.records);
      if (!parsed.procedencia || !parsed.nivel || !parsed.folio || !parsed.documentDate) {
        const missing = [['procedencia', parsed.procedencia], ['nivel', parsed.nivel], ['folio', parsed.folio], ['fecha', parsed.documentDate]]
          .filter(([, value]) => !value).map(([field]) => field);
        setStatus(`No se leyó: ${missing.join(', ')}. Acerca el recuadro completo y vuelve a intentar.`);
        onMessage(`Lectura incompleta. Texto detectado: ${String(parsed.raw).trim().slice(0, 160) || 'ninguno'}`, true);
        return;
      }
      if (!batch.records.some((record) => String(record.folio).match(/^\d+/)?.[0] === parsed.folio)) {
        setStatus(`El folio ${parsed.folio} no está en este lote. Comprueba el recuadro o avisa a la encargada.`);
        return;
      }
      setResult(parsed); setStatus('Compara estos datos con el documento físico y confirma si son correctos.');
    } catch (error) { setStatus(error.message); onMessage(error.message, true); }
    finally { setReading(false); }
  }

  function capture() {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video?.videoWidth || !guide) { setStatus('Espera a que aparezca la imagen.'); return; }
    const frame = video.getBoundingClientRect();
    const target = guide.getBoundingClientRect();
    const scale = Math.max(frame.width / video.videoWidth, frame.height / video.videoHeight);
    const drawnWidth = video.videoWidth * scale;
    const drawnHeight = video.videoHeight * scale;
    const offsetX = (frame.width - drawnWidth) / 2;
    const offsetY = (frame.height - drawnHeight) / 2;
    const padX = target.width * .02;
    const padY = target.height * .06;
    const left = Math.max(0, (target.left - frame.left - offsetX - padX) / scale);
    const top = Math.max(0, (target.top - frame.top - offsetY - padY) / scale);
    const right = Math.min(video.videoWidth, (target.right - frame.left - offsetX + padX) / scale);
    const bottom = Math.min(video.videoHeight, (target.bottom - frame.top - offsetY + padY) / scale);
    const width = right - left;
    const height = bottom - top;
    if (width < 1 || height < 1) { setStatus('No se pudo encuadrar el documento. Gira el celular e intenta de nuevo.'); return; }
    const canvas = document.createElement('canvas'); canvas.width = Math.round(width * 2); canvas.height = Math.round(height * 2);
    canvas.getContext('2d').drawImage(video, left, top, width, height, 0, 0, canvas.width, canvas.height);
    readImage(canvas);
  }

  async function save() {
    if (!result || saving) return;
    setSaving(true);
    try {
      const saved = await rpc('v2_scan_document', { p_batch_id: batch.id, p_folio: result.folio,
        p_procedencia: result.procedencia, p_nivel: result.nivel, p_document_date: result.documentDate });
      onMessage(saved.status === 'new' ? `Folio ${saved.folio} revisado por ${saved.checkedBy}.`
        : `Folio ${saved.folio} revisado nuevamente por ${saved.checkedBy}. Ambas revisiones quedan en la bitácora.`);
      setResult(null); setStatus('Guardado. Coloca el siguiente documento y lee el recuadro.');
      await onRefresh();
      if (mode === 'photo') onClose();
    } catch (error) { setStatus(error.message); onMessage(error.message, true); }
    finally { setSaving(false); }
  }

  if (!mode) return null;
  return <div ref={modalRef} className="scan-modal" role="dialog" aria-modal="true" aria-label="Escanear recuadro del documento" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`scan-card${result ? ' has-result' : ''}`}><div className="scan-heading"><strong>Escanear recuadro completo</strong><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      {mode === 'camera' && <><div className="scan-orientation"><span>Gira el celular a horizontal para ampliar el recuadro.</span><button type="button" onClick={expandCamera}>Pantalla completa horizontal</button></div><div className="video-wrap"><video ref={videoRef} autoPlay playsInline muted /><div ref={guideRef} className="scan-guide" aria-label="Guía para las tres filas del recuadro" /></div></>}
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
