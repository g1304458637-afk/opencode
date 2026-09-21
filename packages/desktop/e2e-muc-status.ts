// MUCODE 真 Electron UI E2E（Final Frontend CLOSURE）——裸 CDP 实现，零新依赖。
// 前置：后端 8090（Pro/Basic 订阅 + 重置卡 + usage>0）、
// `MUC_GATEWAY_URL=… MUC_CDP_PORT=9333 bun run dev` 已启动。
// 流程：CDP 连接 → 签 connect code → mucConnect → reload → 展开悬浮球面板
// → 断言 Wallet/Subscription/ResetCard → 点击使用 → 确认 → IPC → Gateway →
// Reset backend → AVAILABLE QUOTA 动画到 100% → 面板回归 0% → 卡 -1。
// 每一步截图存 e2e/artifacts/。
import { mkdirSync, writeFileSync } from "node:fs"

const GATEWAY = process.env.MUC_GATEWAY_URL ?? "http://127.0.0.1:8090"
const ART = new URL("./e2e/artifacts/", import.meta.url).pathname
mkdirSync(ART, { recursive: true })

const log = (m: string) => console.log(`[e2e] ${m}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class CDP {
  ws: WebSocket
  id = 0
  pending = new Map<number, (v: any) => void>()

  constructor(url: string) {
    this.ws = new WebSocket(url)
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error("ws error"))
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string)
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message))
          else p.resolve(msg.result)
        }
      }
    })
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 20000)
    })
  }

  async eval<T = any>(expr: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) {
      throw new Error("page eval error: " + JSON.stringify(res.exceptionDetails).slice(0, 300))
    }
    return res.result.value as T
  }

  async screenshot(name: string) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" })
    writeFileSync(`${ART}${name}.png`, Buffer.from(data, "base64"))
    log(`screenshot: ${name}.png`)
  }
}

async function mintConnectCode(): Promise<string> {
  const login = await fetch(`${GATEWAY}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "pricing-user@test.local", password: "User#2026" }),
  }).then((r) => r.json() as Promise<{ data: { access_token: string } }>)
  const res = await fetch(`${GATEWAY}/api/v1/muc/connect-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.data.access_token}` },
    body: "{}",
  }).then((r) => r.json() as Promise<{ data: { code: string } }>)
  return res.data.code
}

async function main() {
  const targets = await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json() as Promise<any[]>)
  const target = targets.find((t) => t.type === "page" && t.url.includes("5173"))
  if (!target) throw new Error("app page target not found")
  const cdp = new CDP(target.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send("Page.enable")
  log(`attached: ${target.url}`)

  // ── 连接账户 ──
  const code = await mintConnectCode()
  const connectState = await cdp.eval(
    `window.api.mucConnect(${JSON.stringify(code)}).then(r => ({ ok: r.ok }))`,
  )
  log(`connect: ${JSON.stringify(connectState)}`)

  // ── 刷新：gate ready → 主界面 + 悬浮球挂载 ──
  await cdp.send("Page.reload")
  await sleep(3000)
  await cdp.screenshot("01-app-connected")

  // ── 展开悬浮球面板（完整 pointer 序列；<4px 位移判定为点击）──
  const ballReady = await cdp.eval(`!!document.querySelector('button.muc-status-scope')`)
  if (!ballReady) throw new Error("floating ball not mounted")
  await cdp.eval(`(() => {
    const b = document.querySelector('button.muc-status-scope');
    const r = b.getBoundingClientRect();
    const o = { bubbles: true, pointerId: 7, isPrimary: true, clientX: r.x + 20, clientY: r.y + 20 };
    b.dispatchEvent(new PointerEvent('pointerdown', o));
    b.dispatchEvent(new PointerEvent('pointerup', o));
    return true;
  })()`)
  await sleep(900)
  await cdp.screenshot("02-panel-open")

  const before = await cdp.eval(`(() => {
    const ball = document.querySelector('button.muc-status-scope')?.innerText ?? ''
    const panels = [...document.querySelectorAll('div')].filter(d => d.className?.includes?.('w-[280px]'))
    const panel = panels[0]?.innerText ?? ''
    const usage = panel.match(/(\\d+)%/)
    const cards = panel.match(/重置卡 ×(\\d+)/)
    return {
      ball,
      usagePercent: usage ? Number(usage[1]) : null,
      cards: cards ? Number(cards[1]) : null,
      hasTier: /BASIC|PRO|MAX/i.test(panel),
      hasWallet: panel.includes('钱包余额'),
      hasPayg: panel.includes('继续使用'),
      panelText: panel.slice(0, 400),
    }
  })()`)
  writeFileSync(`${ART}before.json`, JSON.stringify(before, null, 2))
  log(
    `before: ${JSON.stringify({
      usage: before.usagePercent,
      cards: before.cards,
      tier: before.hasTier,
      wallet: before.hasWallet,
      payg: before.hasPayg,
    })}`,
  )
  if (!before.hasWallet) throw new Error("wallet block missing")
  if (!before.hasTier) throw new Error("tier badge missing")
  if (!before.hasPayg) throw new Error("payg fallback missing")
  if (!before.usagePercent) throw new Error("usage must be >0 for reset test")
  if (!before.cards) throw new Error("reset cards must be >0 for reset test")

  // ── 使用 → 确认（IPC → Gateway → Reset backend）──
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '使用')?.click()`)
  await sleep(500)
  await cdp.screenshot("03-reset-confirm")
  await cdp.eval(`[...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '确认使用')?.click()`)
  log("reset confirmed — waiting for backend + animation…")

  // ── 成功动画：额度已恢复 + AVAILABLE QUOTA → 100% ──
  let animText = ""
  for (let i = 0; i < 20; i++) {
    await sleep(400)
    animText = await cdp.eval(`(() => {
      const overlays = [...document.querySelectorAll('div')].filter(d => d.textContent?.includes('AVAILABLE QUOTA'))
      return overlays.at(-1)?.innerText ?? ''
    })()`)
    if (animText.includes("100%")) break
  }
  await cdp.screenshot("04-reset-anim")
  log(`anim: ${animText.replace(/\n/g, " | ").slice(0, 160)}`)
  if (!animText.includes("100%")) throw new Error("animation did not reach 100%")
  if (!animText.includes("剩余")) throw new Error("animation missing remaining-cards line")

  // ── 动画结束回归面板：本周 0% + 卡 -1 ──
  await sleep(2800)
  const after = await cdp.eval(`(() => {
    const panels = [...document.querySelectorAll('div')].filter(d => d.className?.includes?.('w-[280px]'))
    const panel = panels[0]?.innerText ?? ''
    const usage = panel.match(/(\\d+)%/)
    const cards = panel.match(/重置卡 ×(\\d+)/)
    return { usagePercent: usage ? Number(usage[1]) : null, cards: cards ? Number(cards[1]) : null }
  })()`)
  await cdp.screenshot("05-after-reset")
  log(`after: usage=${after.usagePercent}% cards=${after.cards}`)

  // 服务端复核：面板刷新的数据源 /v1/usage 合同
  const verify = await cdp.eval(`(async () => {
    const res = await window.api.mucGetUsage()
    return res.ok ? { usage: res.usage.subscriptionStatus?.weeklyUsagePercent, cards: res.usage.resetCardsAvailable } : null
  })()`)
  log(`server verify: ${JSON.stringify(verify)}`)

  const verdict = {
    before: { usage: before.usagePercent, cards: before.cards },
    after: { usage: after.usagePercent, cards: after.cards },
    server: verify,
    animationReached100: animText.includes("100%"),
    verdict:
      after.usagePercent === 0 && after.cards === before.cards - 1 && verify?.usage === 0 ? "PASS" : "FAIL",
  }
  writeFileSync(`${ART}result.json`, JSON.stringify(verdict, null, 2))
  if (verdict.verdict !== "PASS") throw new Error("E2E FAILED: " + JSON.stringify(verdict))
  log("VERDICT: PASS ✅")
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[e2e] FAIL:", err.message ?? err)
    process.exit(1)
  })
