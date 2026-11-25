import { useEffect, useRef, useState } from 'react';
import { rpc } from '../lib/api';
import { readDocumentFields } from '../lib/ocr';

export default function ScanModal({ batch, mode, photo, standalone = false, onClose, onRefresh, onMessage }) {
  const videoRef = useRef(null);
  const guideRef = useRef(null);
  const modalRef = useRef(null);
  const streamRef = useRef(null);
  const busyRef = useRef(false);
  const seenFolioRef = useRef('');
  const candidateRef = useRef({ signature: '', count: 0 });
  const signalTimerRef = useRef(null);
  const fieldsRef = useRef({ folio: '', values: {} });
  const [signal, setSignal] = useState('scanning');
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
  useEffect(() => () => clearTimeout(signalTimerRef.current), []);
  useEffect(() => {
    if (mode !== 'camera') return;
    const timer = setInterval(async () => {
      if (busyRef.current || !streamRef.current || document.hidden) return;
      const image = capture();
      if (!image) return;
      busyRef.current = true;
      setStatus('Leyendo procedencia, nivel, folio y fecha…');
      try {
        const parsed = await readDocumentFields(image, batch.records);
        if (!parsed.folio) { fieldsRef.current = { folio: '', values: {} }; setStatus('Acerca el folio a la guía y mantén firme el documento.'); return; }
        if (fieldsRef.current.folio !== parsed.folio) fieldsRef.current = { folio: parsed.folio, values: {} };
        const accumulated = fieldsRef.current;
        for (const field of ['procedencia', 'documentDate']) {
          if (parsed[field]) accumulated.values[field] = parsed[field];
          else parsed[field] = accumulated.values[field] || '';
        }
        if (!parsed.procedencia || !parsed.nivel || !parsed.folio || !parsed.documentDate) {
          const missing = [['procedencia', parsed.procedencia], ['nivel', parsed.nivel], ['folio', parsed.folio], ['fecha', parsed.documentDate]]
            .filter(([, value]) => !value).map(([field]) => field);
          setStatus(`Folio ${parsed.folio} detectado. Leyendo ${missing.join(', ')}; mantén el documento en la guía.`);
          candidateRef.current = { signature: '', count: 0 }; return;
        }
        const signature = [parsed.folio, parsed.nivel, parsed.documentDate].join('|');
        candidateRef.current = candidateRef.current.signature === signature
          ? { signature, count: candidateRef.current.count + 1 } : { signature, count: 1 };
        if (candidateRef.current.count < 2) { setStatus('Confirmando la lectura del recuadro…'); return; }
        if (parsed.folio === seenFolioRef.current) { setStatus(`Documento ya escaneado: ${parsed.folio}`); return; }
        const record = batch.records.find((item) => String(item.folio).match(/^\d+/)?.[0] === parsed.folio);
        if (!record) { setSignal('error'); setStatus(`Folio ${parsed.folio} no está en este lote.`); return; }
        seenFolioRef.current = parsed.folio;
        if (record.checkedAt) {
          setSignal('duplicate'); setStatus(`Documento ya escaneado: ${parsed.folio}`);
          clearTimeout(signalTimerRef.current);
          signalTimerRef.current = setTimeout(() => setSignal('scanning'), 2000);
          return;
        }
        const saved = await rpc('v2_scan_document', { p_batch_id: batch.id, p_folio: parsed.folio,
          p_procedencia: parsed.procedencia, p_nivel: parsed.nivel, p_document_date: parsed.documentDate });
        if (saved.status === 'already') {
          setSignal('duplicate'); setStatus(`Documento ya escaneado: ${saved.folio}`);
        } else {
          setSignal('success'); setStatus(`✓ Folio ${saved.folio} registrado. Coloca el siguiente documento.`);
        }
        clearTimeout(signalTimerRef.current);
        signalTimerRef.current = setTimeout(() => setSignal('scanning'), 2000);
        await onRefresh();
      } catch (error) { setSignal('error'); setStatus(error.message); seenFolioRef.current = ''; }
      finally { busyRef.current = false; }
    }, 1600);
    return () => clearInterval(timer);
  }, [mode, batch]);
  useEffect(() => () => {
    if (document.fullscreenElement === modalRef.current) {
      screen.orientation?.unlock?.();
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (mode !== 'camera' || !standalone) return;
    const frame = requestAnimationFrame(() => {
      modalRef.current?.requestFullscreen?.()
        .then(() => screen.orientation?.lock?.('landscape-primary')?.catch?.(() => {}))
        .catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, standalone]);

  async function expandCamera() {
    if (!modalRef.current?.requestFullscreen) {
      setStatus('Gira el celular a horizontal. Si el giro está bloqueado, actívalo en los ajustes del teléfono.');
      return;
    }
    try {
      await modalRef.current.requestFullscreen();
      if (screen.orientation?.lock) {
        await screen.orientation.lock('landscape-primary');
        setStatus('Coloca las tres filas dentro de la guía. La lectura se hará automáticamente.');
      } else setStatus('Gira el celular a horizontal para ampliar la cámara.');
    } catch {
      setStatus('Gira el celular a horizontal. Si el giro está bloqueado, actívalo en los ajustes del teléfono.');
    }
  }

  async function readImage(image) {
    if (reading || !batch) return;
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
    if (!video?.videoWidth || !guide) return null;
    const frameWidth = video.clientWidth;
    const frameHeight = video.clientHeight;
    const targetWidth = guide.offsetWidth;
    const targetHeight = guide.offsetHeight;
    const transform = new DOMMatrixReadOnly(getComputedStyle(guide).transform);
    const targetLeft = guide.offsetLeft + transform.m41;
    const targetTop = guide.offsetTop + transform.m42;
    if (!frameWidth || !frameHeight || !targetWidth || !targetHeight) return null;
    const scale = Math.max(frameWidth / video.videoWidth, frameHeight / video.videoHeight);
    const drawnWidth = video.videoWidth * scale;
    const drawnHeight = video.videoHeight * scale;
    const offsetX = (frameWidth - drawnWidth) / 2;
    const offsetY = (frameHeight - drawnHeight) / 2;
    const padX = targetWidth * .04;
    const padY = targetHeight * .08;
    const left = Math.max(0, (targetLeft - offsetX - padX) / scale);
    const top = Math.max(0, (targetTop - offsetY - padY) / scale);
    const right = Math.min(video.videoWidth, (targetLeft + targetWidth - offsetX + padX) / scale);
    const bottom = Math.min(video.videoHeight, (targetTop + targetHeight - offsetY + padY) / scale);
    const width = right - left;
    const height = bottom - top;
    if (width < 1 || height < 1) return null;
    const canvas = document.createElement('canvas'); canvas.width = Math.round(width * 2); canvas.height = Math.round(height * 2);
    canvas.getContext('2d').drawImage(video, left, top, width, height, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function save() {
    if (!result || saving) return;
    setSaving(true);
    try {
      const saved = await rpc('v2_scan_document', { p_batch_id: batch.id, p_folio: result.folio,
        p_procedencia: result.procedencia, p_nivel: result.nivel, p_document_date: result.documentDate });
      onMessage(saved.status === 'new' ? `Folio ${saved.folio} revisado por ${saved.checkedBy}.`
        : `Documento ya escaneado: folio ${saved.folio}. Responsable: ${saved.checkedBy}.`);
      setResult(null); setStatus('Guardado. Coloca el siguiente documento y lee el recuadro.');
      await onRefresh();
      if (mode === 'photo') onClose();
    } catch (error) { setStatus(error.message); onMessage(error.message, true); }
    finally { setSaving(false); }
  }

  if (!mode) return null;
  return <div ref={modalRef} className={`scan-modal${standalone ? ' scan-standalone' : ''}`} role="dialog" aria-modal="true" aria-label="Escanear recuadro del documento" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`scan-card${result ? ' has-result' : ''}`}><div className="scan-heading"><strong>Escanear recuadro completo</strong><button type="button" aria-label="Cerrar" onClick={onClose}>×</button></div>
      {mode === 'camera' && <><div className="scan-orientation"><span>Gira el celular a horizontal para ampliar el recuadro.</span><button type="button" onClick={expandCamera}>Pantalla completa horizontal</button></div><div className="video-wrap"><video ref={videoRef} autoPlay playsInline muted /><div ref={guideRef} className={`scan-guide laser-${signal}`} aria-label="Guía para las tres filas del recuadro" />{signal === 'success' && <div className="scan-success" aria-label="Documento registrado">✓</div>}</div></>}
      <p role="status">{status}</p>
      {result && <div id="scanResult"><dl>
        <div><dt>Procedencia</dt><dd>{result.procedencia}</dd></div><div><dt>Nivel</dt><dd>{result.nivel}</dd></div>
        <div><dt>No. de documento</dt><dd>{result.folio}</dd></div><div><dt>Fecha</dt><dd>{result.documentDate}</dd></div>
      </dl><button className="primary" type="button" onClick={save} disabled={saving}>Confirmar y guardar escaneo</button>
        <button type="button" onClick={() => { setResult(null); setStatus('Vuelve a leer el recuadro.'); }}>Volver a leer</button></div>}
    </div>
  </div>;
}
