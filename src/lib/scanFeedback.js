let audio;
export async function enableScanSound() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return false;
  audio ||= new Audio();
  await audio.resume();
  return audio.state === 'running';
}
export function scanFeedback(kind, sound = true) {
  try { navigator.vibrate?.(kind === 'saved' ? [90] : [70, 60, 70]); } catch {}
  try {
  if (!sound || audio?.state !== 'running') return;
  const start = audio.currentTime;
  const notes = kind === 'saved' ? [880, 1175] : [330, 260];
  notes.forEach((frequency, index) => {
    const oscillator = audio.createOscillator(); const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.09, start + index * .14);
    gain.gain.exponentialRampToValueAtTime(.001, start + index * .14 + .12);
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.start(start + index * .14); oscillator.stop(start + index * .14 + .13);
  });
  } catch {}
}

