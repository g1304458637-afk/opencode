import { createSignal } from "solid-js"
const preference = () => {
  try {
    return localStorage.getItem("campus.reward.sound") === "true"
  } catch {
    return false
  }
}
export const [rewardSoundEnabled, updateRewardSound] = createSignal(preference())
export function setRewardSoundEnabled(value: boolean) {
  updateRewardSound(value)
  try {
    localStorage.setItem("campus.reward.sound", String(value))
  } catch {}
}

/** Short synthesized rise, low impact and crystal shimmer; no downloads or permanent audio loop. */
export function playRewardSound(reset: boolean, speed: number) {
  if (!rewardSoundEnabled()) return () => {}
  const context = new AudioContext()
  const master = context.createGain()
  master.gain.value = 0.16
  const limiter = context.createDynamicsCompressor()
  master.connect(limiter)
  limiter.connect(context.destination)
  const nodes: OscillatorNode[] = []
  const gains: GainNode[] = []
  let closed = false
  const stop = () => {
    if (closed) return
    closed = true
    nodes.forEach((node) => {
      node.onended = null
      node.stop()
      node.disconnect()
    })
    gains.forEach((node) => node.disconnect())
    master.disconnect()
    limiter.disconnect()
    void context.close()
  }
  const tone = (at: number, duration: number, from: number, to: number, volume: number, wave: OscillatorType) => {
    const node = context.createOscillator(),
      gain = context.createGain()
    const start = context.currentTime + at / speed,
      end = start + duration / speed
    node.type = wave
    node.frequency.setValueAtTime(from, start)
    node.frequency.exponentialRampToValueAtTime(to, end)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.05 / speed)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    node.connect(gain)
    gain.connect(master)
    node.start(start)
    node.stop(end)
    nodes.push(node)
    gains.push(gain)
    return node
  }
  tone(0.06, 0.8, 48, 190, 0.5, "sine")
  tone(0.22, 0.7, 140, 720, 0.13, "triangle")
  tone(reset ? 1.15 : 0.45, 0.45, 90, 30, 0.9, "sine")
  tone(reset ? 1.15 : 1.1, 0.45, 1500, 900, 0.13, "sine")
  tone(1.45, 0.6, 2200, 1400, 0.045, "sine").onended = stop
  void context.resume().catch(stop)
  return stop
}
