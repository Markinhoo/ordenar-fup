import qrcode from 'qrcode-generator';
import { downloadBlob } from './download';

export function drawQr(canvas, link) {
  if (!canvas) return;
  const code = qrcode(0, 'M');
  code.addData(link);
  code.make();
  const modules = code.getModuleCount(), scale = 6, margin = 4;
  canvas.width = canvas.height = (modules + margin * 2) * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) {
    if (code.isDark(row, col)) ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
  }
}

export function downloadQr(canvas, filename) {
  canvas?.toBlob((blob) => { if (blob) downloadBlob(blob, filename); }, 'image/png');
}
