export const rewardFxIntensities = ["Low", "Medium", "High", "MAX"] as const
export const rewardFxPresets = {
  Low: { particles: 48, bloom: 0.65, shockwave: 0.65, impact: 1 },
  Medium: { particles: 80, bloom: 1, shockwave: 1, impact: 2 },
  High: { particles: 128, bloom: 1.4, shockwave: 1.25, impact: 3 },
  MAX: { particles: 160, bloom: 1.9, shockwave: 1.6, impact: 4 },
} as const
export type RewardFxIntensity = keyof typeof rewardFxPresets
export type RewardFxOptions = {
  intensity: RewardFxIntensity
  particles: number
  bloom: number
  shockwave: number
  impact: number
}
// Approved local review preset: MAX at half speed.
export const defaultRewardPlaybackSpeed = 0.5
export const defaultRewardFx: RewardFxOptions = { intensity: "MAX", ...rewardFxPresets.MAX }

/** One bounded canvas, analytic particles, cached glow sprites; no per-particle signals or RAF. */
export function createRewardPainter(
  canvas: HTMLCanvasElement,
  kind: "FULL_RESET" | "RESET_CARD_GRANTED" | "RESET_CARD_USED",
  center: { x: number; y: number; dx: number; dy: number; ax: number; ay: number },
  orb: { x: number; y: number },
) {
  const reset = kind === "FULL_RESET"
  const used = kind === "RESET_CARD_USED"
  const width = innerWidth,
    height = innerHeight
  const dpr = Math.min(devicePixelRatio || 1, 1.25, 1800 / width)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const context = canvas.getContext("2d")
  if (!context) return { draw: () => {}, dispose: () => {} }
  context.scale(dpr, dpr)
  const sprite = document.createElement("canvas")
  sprite.width = sprite.height = 128
  const glow = sprite.getContext("2d")!
  const gradient = glow.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, "#fffdf5")
  gradient.addColorStop(0.08, "#fff3cded")
  gradient.addColorStop(0.25, "#e7b35465")
  gradient.addColorStop(1, "#bc7d2800")
  glow.fillStyle = gradient
  glow.fillRect(0, 0, 128, 128)
  const ringSprite = document.createElement("canvas")
  ringSprite.width = ringSprite.height = 256
  const ringContext = ringSprite.getContext("2d")!
  const ringGradient = ringContext.createRadialGradient(128, 128, 0, 128, 128, 128)
  ringGradient.addColorStop(0, "#ffdf9a00")
  ringGradient.addColorStop(0.68, "#ffdf9a00")
  ringGradient.addColorStop(0.7, "#d5a55322")
  ringGradient.addColorStop(0.724, "#f9dd9c66")
  ringGradient.addColorStop(0.737, "#fff5d5ed")
  ringGradient.addColorStop(0.75, "#fff1b866")
  ringGradient.addColorStop(0.8, "#d8a84918")
  ringGradient.addColorStop(1, "#d8a84900")
  ringContext.fillStyle = ringGradient
  ringContext.fillRect(0, 0, 256, 256)
  const particles = Array.from({ length: 160 }, (_, i) => ({
    angle: i * 2.399963,
    seed: (Math.sin(i * 127.1 + 31.7) * 43758.5453) % 1,
    radius: 1 + (i % 5) * 0.55,
    color: ["#fff4d7", "#f4cb83", "#d9eafa", "#c5bdde", "#e8ad50"][i % 5],
  }))
  const clamp = (n: number) => Math.max(0, Math.min(1, n))
  const bloom = (x: number, y: number, size: number, alpha: number) => {
    context.globalAlpha = clamp(alpha)
    context.drawImage(sprite, x - size / 2, y - size / 2, size, size)
  }
  const draw = (time: number, fx: RewardFxOptions, low: boolean) => {
    context.clearRect(0, 0, width, height)
    context.globalCompositeOperation = "lighter"
    if (used) {
      const count = Math.floor(Math.min(fx.particles, 96) * (low ? 0.5 : 1))
      canvas.dataset.particles = String(count)
      const sourceX = center.x + center.dx
      const sourceY = center.y + center.dy
      const approach = clamp(time / 250)
      const charge = clamp((time - 250) / 400)
      const activation = clamp((time - 690) / 110)
      const restore = clamp((time - 800) / 650)
      const settle = clamp((time - 1450) / 500)
      if (time < 650) {
        const cardX = sourceX + (center.x - sourceX) * (1 - (1 - approach) ** 3)
        const cardY = sourceY + (center.y - sourceY) * (1 - (1 - approach) ** 3)
        bloom(cardX, cardY, (170 + charge * 160) * fx.bloom, 0.22 + charge * 0.3)
        for (let i = 0; i < count; i++) {
          const p = particles[i]
          const radius = 36 + Math.abs(p.seed) * 170
          const inward = (charge + (i % 9) / 9) % 1
          const distance = radius * (1 - inward) ** 1.4
          const angle = p.angle + charge * 0.34
          const x = cardX + Math.cos(angle) * distance
          const y = cardY + Math.sin(angle) * distance * 0.64
          context.globalAlpha = clamp((0.2 + charge * 0.7) * (1 - inward * 0.55))
          context.strokeStyle = p.color
          context.lineWidth = i % 6 === 0 ? 1.7 : 0.8
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x + Math.cos(angle) * 10, y + Math.sin(angle) * 6)
          context.stroke()
          if (i % 8 === 0) bloom(x, y, 12, context.globalAlpha * 0.6)
        }
      }
      if (time >= 650 && time < 900) {
        // Hold the fully charged card for 40 internal ms before the activation beat.
        const ignition = time < 690 ? 0 : Math.sin(activation * Math.PI * 0.5)
        bloom(center.x, center.y, (260 + ignition * 430) * fx.bloom, 0.3 + ignition * 0.48)
        if (time >= 760) {
          const age = (time - 760) / 140
          const rw = 110 + age * Math.min(width * 1.35, 1500)
          const rh = 70 + age * Math.min(height * 1.05, 900)
          context.globalAlpha = clamp((1 - age) * fx.shockwave * 0.72)
          context.drawImage(ringSprite, center.x - rw / 2, center.y - rh / 2, rw, rh)
        }
      }
      if (time >= 800 && time < 1450) {
        const eased = restore * restore * (3 - 2 * restore)
        const headX = center.x + (orb.x - center.x) * eased
        const headY = center.y + (orb.y - center.y) * eased
        bloom(headX, headY, (100 + 110 * (1 - restore)) * fx.bloom, 0.55 * (1 - restore * 0.35))
        for (let i = 0; i < count; i++) {
          const p = particles[i]
          const delay = (i % 12) / 24
          const progress = clamp((restore - delay) / (1 - delay))
          if (!progress) continue
          const bend = Math.sin(progress * Math.PI) * (24 + Math.abs(p.seed) * 42) * (i % 2 ? 1 : -1)
          const x = center.x + (orb.x - center.x) * progress + Math.cos(p.angle) * 20 * (1 - progress)
          const y = center.y + (orb.y - center.y) * progress + bend + Math.sin(p.angle) * 14 * (1 - progress)
          context.globalAlpha = clamp(Math.sin(progress * Math.PI) * 0.75)
          context.strokeStyle = p.color
          context.lineWidth = p.radius * 0.65
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x - (orb.x - center.x) * 0.025, y - (orb.y - center.y) * 0.025)
          context.stroke()
          if (i % 9 === 0) bloom(x, y, 16, context.globalAlpha * 0.55)
        }
        bloom(orb.x, orb.y, 250 * fx.bloom, restore * 0.58)
      }
      if (time >= 1450 && time < 2100) {
        const afterglow = time < 1950 ? 1 - settle * 0.62 : ((2100 - time) / 150) * 0.38
        bloom(orb.x, orb.y, 180 * fx.bloom, afterglow * 0.42)
        if (time < 1950) {
          const size = 85 + settle * 175
          context.globalAlpha = (1 - settle) * 0.38
          context.drawImage(ringSprite, orb.x - size / 2, orb.y - size / 2, size, size)
        }
      }
      context.globalAlpha = 1
      context.globalCompositeOperation = "source-over"
      return
    }
    const count = Math.floor(
      Math.min(reset ? fx.particles : Math.round(fx.particles * 0.75), reset ? 160 : 120) * (low ? 0.5 : 1),
    )
    const orbital = !reset && time > 620 && time < 1460 ? Math.min(24, Math.floor(count / 4)) : 0
    canvas.dataset.particles = String(count)
    const hit = reset ? 1150 : 1100
    const burst = (time - hit) / 1000
    const convergence = clamp((time - 100) / (reset ? 640 : 440))
    if (time < (reset ? 900 : 650)) {
      const energy = Math.sin(Math.PI * convergence)
      bloom(center.x, center.y, (reset ? 520 : 340) * fx.bloom, energy * 0.65)
      for (let i = 0; i < count; i++) {
        const p = particles[i],
          r = Math.abs(p.seed)
        const distance = Math.hypot(width, height) * (0.35 + r * 0.4) * (1 - convergence) ** 1.7
        const a = p.angle + convergence * 0.12
        const x = center.x + Math.cos(a) * distance,
          y = center.y + Math.sin(a) * distance * 0.65
        context.strokeStyle = p.color
        context.globalAlpha = clamp(energy * (0.3 + r * 0.7))
        context.lineWidth = i % 7 === 0 ? 2 : 0.8
        context.beginPath()
        context.moveTo(x, y)
        context.lineTo(x + Math.cos(a) * (18 + r * 120) * energy, y + Math.sin(a) * (18 + r * 120) * energy * 0.65)
        context.stroke()
        if (i % 4 === 0) bloom(x, y, 12 + r * 12, energy * 0.7)
      }
    }
    if (reset && time >= 480 && time < 1700) {
      const age = (time - 480) / 1000
      bloom(orb.x, orb.y, 260 * fx.bloom, Math.sin(clamp(age) * Math.PI) * 0.8)
      for (let ring = 0; ring < 4; ring++) {
        const life = age - ring * 0.12
        if (life < 0) continue
        context.globalAlpha = clamp((1 - life / 0.85) * 0.8)
        context.strokeStyle = ring % 2 ? "#f1c980" : "#fff3d6"
        context.lineWidth = 2
        context.beginPath()
        context.arc(orb.x, orb.y, 38 + life * 210, 0, Math.PI * 2)
        context.stroke()
      }
    }
    if (burst >= 0 && burst < 1.5) {
      const fade = clamp(1 - burst / 1.4)
      bloom(center.x, center.y, (reset ? 1200 : 880) * fx.bloom, Math.exp(-burst * 7) * 0.95)
      // Rays and three expanding shock fronts share the same impact time.
      for (let ray = 0; ray < (low ? 16 : 36); ray++) {
        const a = (ray * Math.PI) / 18
        const inner = 30 + burst * 170
        const outer = inner + (reset ? 500 : 340) * Math.exp(-burst * 2.4)
        context.globalAlpha = Math.exp(-burst * 4) * 0.46
        context.strokeStyle = ray % 4 ? "#e8c48b" : "#dbf4ff"
        context.lineWidth = ray % 4 === 0 ? 3 : 1
        context.beginPath()
        context.moveTo(center.x + Math.cos(a) * inner, center.y + Math.sin(a) * inner * 0.66)
        context.lineTo(center.x + Math.cos(a) * outer, center.y + Math.sin(a) * outer * 0.66)
        context.stroke()
      }
      for (let ring = 0; ring < 3; ring++) {
        const age = burst - ring * 0.075
        if (age < 0 || age > 0.7) continue
        context.globalAlpha = clamp((1 - age / 0.7) * 0.85)
        const rw = (70 + age * width * 2.3) / 0.74
        const rh = (36 + age * height * 1.9) / 0.74
        context.globalAlpha *= Math.min(1, fx.shockwave * 0.75)
        context.drawImage(ringSprite, center.x - rw / 2, center.y - rh / 2, rw, rh)
      }
      for (let i = 0; i < count - orbital; i++) {
        const p = particles[i],
          r = Math.abs(p.seed),
          velocity = (reset ? 1300 : 1150) * (0.35 + r)
        const travel = (reset ? 90 : 155) + (velocity * (1 - Math.exp(-burst * 2.5))) / 2.5
        const x = center.x + Math.cos(p.angle) * travel
        const y = center.y + Math.sin(p.angle) * travel * 0.72 + burst * burst * (70 + r * 45)
        context.globalAlpha = fade * (0.4 + r * 0.6)
        context.strokeStyle = p.color
        context.fillStyle = p.color
        context.lineWidth = p.radius * 0.65
        if (i % 3 === 0) {
          const trail = (16 + r * 75) * Math.exp(-burst * 3)
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x - Math.cos(p.angle) * trail, y - Math.sin(p.angle) * trail * 0.72)
          context.stroke()
        } else {
          context.save()
          context.translate(x, y)
          context.rotate(p.angle + burst)
          context.fillRect(-p.radius, -p.radius / 2, p.radius * 2.8, p.radius)
          context.restore()
        }
        if (i % 6 === 0) bloom(x, y, 24 + r * 18, fade * 0.85)
      }
    }
    if (!reset && time >= 450 && time < 790) {
      const age = (time - 450) / 340
      bloom(center.x, center.y, 700 * fx.bloom, (1 - age) * 0.7)
      context.globalAlpha = 1 - age
      const size = 150 + age * 650
      context.drawImage(ringSprite, center.x - size / 2, center.y - size * 0.3, size, size * 0.6)
    }
    // Orbiting asset sparks provide depth during the ownership beat.
    if (!reset && time > 620 && time < 1460) {
      for (let i = 0; i < orbital; i++) {
        const a = i * 2.399 + time / 1100
        bloom(center.x + Math.cos(a) * 250, center.y + Math.sin(a) * 120, i % 3 ? 9 : 18, 0.5)
      }
    }
    if (!reset && time >= 1450 && time < 2000) {
      const progress = clamp((time - 1450) / 550)
      const point = (p: number) => {
        if (p < 0.58) {
          const a = clamp((p - 0.18) / 0.4) ** 2
          return { x: center.x + center.ax * a, y: center.y + center.ay * a }
        }
        const a = clamp((p - 0.58) / 0.42) ** 2
        return {
          x: center.x + center.ax + (center.dx - center.ax) * a,
          y: center.y + center.ay + (center.dy - center.ay) * a,
        }
      }
      for (let segment = 0; segment < 12; segment++) {
        const p = progress - segment * 0.02
        if (p <= 0.18) continue
        const head = point(p),
          tail = point(p - 0.02)
        context.globalAlpha = (1 - segment / 12) * 0.7 * clamp((1 - progress) * 8)
        context.strokeStyle = segment < 3 ? "#fff5d5" : "#d8ac62"
        context.lineWidth = (12 - segment) * 1.4
        context.lineCap = "round"
        context.beginPath()
        context.moveTo(head.x, head.y)
        context.lineTo(tail.x, tail.y)
        context.stroke()
      }
      context.lineCap = "butt"
    }
    context.globalAlpha = 1
    context.globalCompositeOperation = "source-over"
  }
  return {
    draw,
    dispose: () => {
      context.clearRect(0, 0, width, height)
      canvas.width = canvas.height = 0
      sprite.width = sprite.height = 0
      ringSprite.width = ringSprite.height = 0
    },
  }
}
