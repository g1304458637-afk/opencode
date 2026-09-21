import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type ResetCardResult =
  | { ok: true; operationId: string; weeklyPeriodEndsAt: string }
  | { ok: false; error: string }

type Attempt = { key: string; createdAt: number; prepared?: boolean; result?: Extract<ResetCardResult, { ok: true }> }

/** Persist before sending. An uncertain response and a restart reuse the same logical operation. */
export class ResetCardClient {
  private flights = new Map<string, Promise<ResetCardResult>>()

  constructor(
    private directory: string,
    private path: string,
    private request: typeof fetch = fetch,
  ) {}

  reset(gateway: string, apiKey: string, subscriptionID: number): Promise<ResetCardResult> {
    const file = this.file(gateway, apiKey, subscriptionID)
    const existing = this.flights.get(file)
    if (existing) return existing
    const flight = this.send(file, gateway, apiKey, subscriptionID).finally(() => this.flights.delete(file))
    this.flights.set(file, flight)
    return flight
  }

  acknowledge(gateway: string, apiKey: string, subscriptionID: number, operationId: string) {
    const file = this.file(gateway, apiKey, subscriptionID)
    const attempt = this.read(file)
    if (attempt?.result?.operationId === operationId) rmSync(file, { force: true })
  }

  private file(gateway: string, apiKey: string, id: number) {
    const scope = createHash("sha256")
      .update(JSON.stringify([gateway, apiKey, id]))
      .digest("hex")
    const file = join(this.directory, `${scope}.json`)
    // Origin hardening must retain pending operations written by the previous release.
    if (gateway === "https://admin.wuxuexi.top") {
      const legacyScope = createHash("sha256")
        .update(JSON.stringify(["http://admin.wuxuexi.top", apiKey, id]))
        .digest("hex")
      const legacyFile = join(this.directory, `${legacyScope}.json`)
      if (existsSync(legacyFile) && existsSync(file))
        throw new Error("Conflicting reset journals require reconciliation")
      if (existsSync(legacyFile)) renameSync(legacyFile, file)
    }
    return file
  }

  private read(file: string): Attempt | null {
    try {
      const value: Attempt = JSON.parse(readFileSync(file, "utf8"))
      if (!value.key || !Number.isFinite(value.createdAt)) throw new Error("Invalid reset journal")
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      // Corrupt/unreadable journals cannot safely become a new chargeable attempt.
      throw error
    }
  }

  private write(file: string, attempt: Attempt) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(attempt), { mode: 0o600, flush: true })
    renameSync(temporary, file)
  }

  private async reconcile(gateway: string, apiKey: string, id: number, attempt: Attempt) {
    try {
      const response = await this.request(`${gateway.replace(/\/+$/, "")}${this.path}/${id}/reconcile`, {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${apiKey}`, "Idempotency-Key": attempt.key },
        signal: AbortSignal.timeout(10_000),
      })
      const body = await response.json().catch(() => null)
      const payload = body?.data ?? body
      if (!response.ok) return null
      if (payload?.status === "cancelled") return { status: "cancelled" as const }
      if (
        payload?.status === "succeeded" &&
        typeof payload.weekly_period_ends_at === "string" &&
        Number.isFinite(Date.parse(payload.weekly_period_ends_at))
      ) {
        return { status: "succeeded" as const, weekly_period_ends_at: payload.weekly_period_ends_at as string }
      }
      return null
    } catch {
      return null
    }
  }

  private async send(file: string, gateway: string, apiKey: string, id: number): Promise<ResetCardResult> {
    try {
      const attempt = this.read(file) ?? { key: `reset-v2-${randomUUID()}`, createdAt: Date.now() }
      if (attempt.result) return attempt.result
      // Never blindly replay beyond the server's idempotency retention period.
      if (Date.now() - attempt.createdAt > 23 * 60 * 60 * 1000) {
        const reconciled = await this.reconcile(gateway, apiKey, id, attempt)
        if (!reconciled) return { ok: false, error: "reconciliation_required" }
        if (reconciled.status === "succeeded") {
          const result = {
            ok: true as const,
            operationId: attempt.key,
            weeklyPeriodEndsAt: reconciled.weekly_period_ends_at,
          }
          this.write(file, { ...attempt, result })
          return result
        }
        // Only a server cancellation fence allows a new spendable operation.
        renameSync(file, `${file}.${Date.now()}.resolved`)
        return this.send(file, gateway, apiKey, id)
      }
      this.write(file, attempt)
      if (attempt.key.startsWith("reset-v2-") && !attempt.prepared) {
        const prepared = await this.request(`${gateway.replace(/\/+$/, "")}${this.path}/${id}/prepare`, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: `Bearer ${apiKey}`, "Idempotency-Key": attempt.key },
          signal: AbortSignal.timeout(10_000),
        })
        const body = await prepared.json().catch(() => null)
        if (!prepared.ok || !["pending", "succeeded"].includes((body?.data ?? body)?.status))
          return { ok: false, error: "reconciliation_required" }
        attempt.prepared = true
        this.write(file, attempt)
      }
      const response = await this.request(`${gateway.replace(/\/+$/, "")}${this.path}/${id}`, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      })
      const body = await response.json().catch(() => null)
      const payload = body?.data ?? body
      if (
        !response.ok ||
        typeof payload?.weekly_period_ends_at !== "string" ||
        !Number.isFinite(Date.parse(payload.weekly_period_ends_at))
      ) {
        return { ok: false, error: String(body?.reason ?? payload?.reason ?? "unavailable") }
      }
      const result = {
        ok: true as const,
        operationId: attempt.key,
        weeklyPeriodEndsAt: payload.weekly_period_ends_at as string,
      }
      this.write(file, { ...attempt, result })
      return result
    } catch {
      return { ok: false, error: "network" }
    }
  }
}
