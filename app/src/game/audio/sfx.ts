/** Procedurally generated sound effects via Web Audio API. */

type SfxName =
  | 'click'
  | 'match_start'
  | 'match_found'
  | 'entrance'
  | 'ready'
  | 'fight'
  | 'punch_whiff'
  | 'punch_hit'
  | 'kick_whiff'
  | 'kick_hit'
  | 'jump'
  | 'land'
  | 'hurt'
  | 'knockdown'
  | 'exit'

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null

const SETTINGS_KEY = 'pvp-audio-settings'

interface AudioSettings {
  volume: number
  enabled: boolean
}

let settings: AudioSettings = { volume: 0.7, enabled: true }
try {
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (raw) settings = { ...settings, ...JSON.parse(raw) }
} catch {
  // ignore
}

export function getAudioSettings(): AudioSettings {
  return { ...settings }
}

export function setAudioSettings(next: Partial<AudioSettings>) {
  settings = { ...settings, ...next }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  if (masterGain && ctx) {
    masterGain.gain.setValueAtTime(settings.enabled ? settings.volume : 0, ctx.currentTime)
  }
}

/** Must be called from a user gesture before sounds can play. */
export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    return
  }
  try {
    ctx = new AudioContext()
    masterGain = ctx.createGain()
    masterGain.gain.value = settings.enabled ? settings.volume : 0
    masterGain.connect(ctx.destination)
  } catch {
    ctx = null
  }
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function tone(freq: number, dur: number, type: OscillatorType, vol = 0.5, slideTo?: number) {
  if (!ctx || !masterGain) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, ctx.currentTime)
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur)
  gain.gain.setValueAtTime(vol, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
  osc.connect(gain).connect(masterGain)
  osc.start()
  osc.stop(ctx.currentTime + dur)
}

function noise(dur: number, vol = 0.5, lowpass = 4000) {
  if (!ctx || !masterGain) return
  const buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = lowpass
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(vol, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
  src.connect(filter).connect(gain).connect(masterGain)
  src.start()
}

export function playSfx(name: SfxName) {
  if (!ctx || !settings.enabled) return
  // small random pitch/volume variation to avoid mechanical repetition
  const v = rand(0.85, 1.15)
  switch (name) {
    case 'click':
      tone(700 * v, 0.06, 'square', 0.15)
      break
    case 'match_start':
      tone(440 * v, 0.12, 'sine', 0.3, 660)
      break
    case 'match_found':
      tone(523, 0.1, 'sine', 0.35)
      setTimeout(() => tone(784, 0.18, 'sine', 0.35), 110)
      break
    case 'entrance':
      tone(200, 0.4, 'sawtooth', 0.2, 400)
      break
    case 'ready':
      tone(600, 0.25, 'square', 0.3)
      break
    case 'fight':
      tone(300, 0.35, 'sawtooth', 0.4, 900)
      noise(0.2, 0.2, 2500)
      break
    case 'punch_whiff':
      noise(0.08, 0.25 * v, 3000)
      break
    case 'punch_hit':
      tone(150 * v, 0.09, 'square', 0.5, 60)
      noise(0.09, 0.5 * v, 1800)
      break
    case 'kick_whiff':
      noise(0.14, 0.3 * v, 2200)
      break
    case 'kick_hit':
      tone(100 * v, 0.14, 'square', 0.6, 40)
      noise(0.14, 0.6 * v, 1200)
      break
    case 'jump':
      tone(300 * v, 0.15, 'sine', 0.25, 550)
      break
    case 'land':
      noise(0.1, 0.3 * v, 800)
      break
    case 'hurt':
      tone(220 * v, 0.12, 'sawtooth', 0.3, 110)
      break
    case 'knockdown':
      tone(180, 0.3, 'sawtooth', 0.5, 50)
      noise(0.3, 0.5, 700)
      break
    case 'exit':
      tone(500, 0.2, 'sine', 0.3, 250)
      break
  }
}
