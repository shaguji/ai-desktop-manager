/**
 * Alarm ringtone.
 *
 * Synthesised with Web Audio instead of shipping an mp3: no asset to load, no
 * extra package weight, and it can repeat forever without an <audio loop> gap.
 * The desktop window runs with autoplayPolicy = 'no-user-gesture-required', so
 * the context is allowed to start without a click first — which matters
 * because an alarm fires while nobody is touching the computer.
 */

let ctx: AudioContext | null = null;
let timer: number | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Two short "di-di" beeps, 880 Hz, gently enveloped so they never click. */
function beep() {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + 0.01;
  for (let i = 0; i < 2; i++) {
    const at = t0 + i * 0.26;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, at);
    // A second, slightly detuned voice gives the beep some body on laptop
    // speakers, which roll off hard above ~1 kHz.
    const osc2 = c.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(0.22, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(c.destination);
    osc.start(at);
    osc2.start(at);
    osc.stop(at + 0.22);
    osc2.stop(at + 0.22);
  }
}

/** Start the repeating ringtone. Safe to call twice (no double timer). */
export function startRingtone(): void {
  if (timer !== null) return;
  beep();
  timer = window.setInterval(beep, 3000);
}

export function stopRingtone(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

export function isRingingSound(): boolean {
  return timer !== null;
}
