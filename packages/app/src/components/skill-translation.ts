import type { Selectable, TranslationSource } from "@opencode-ai/schema/skill-library"

const pending: Array<() => Promise<void>> = []
let running = 0

// Shared by lists, pickers and details so several open views do not multiply model calls.
export function scheduleTranslation<T>(work: () => Promise<T>, current: () => boolean = () => true): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push(async () => {
      try {
        if (!current()) throw new Error("TRANSLATION_CANCELLED")
        resolve(await work())
      } catch (error) {
        reject(error)
      }
    })
    drain()
  })
}

function drain() {
  while (running < 2 && pending.length) {
    const work = pending.shift()!
    running++
    void work().finally(() => {
      running--
      drain()
    })
  }
}

export function translationSource(item: Selectable): TranslationSource {
  if (!item.contentHash) throw new Error("HASH_MISMATCH")
  if (item.managed && item.revision)
    return { type: "revision", reference: { skillId: item.id, revision: item.revision, contentHash: item.contentHash } }
  return { type: "discovered", id: item.id, contentHash: item.contentHash }
}

export function translationError(cause: unknown): "model" | "changed" | "network" | "invalid" | "failed" {
  const text = cause instanceof Error ? cause.message : JSON.stringify(cause)
  if (/MODEL_UNAVAILABLE|No supported configured model/i.test(text)) return "model"
  if (/HASH_MISMATCH|NOT_FOUND|no longer available/i.test(text)) return "changed"
  if (/fetch|network|timeout|connection|timed out/i.test(text)) return "network"
  if (/generateObject|InvalidProviderOutput|schema|decode|JSON|translated SKILL/i.test(text)) return "invalid"
  return "failed"
}
