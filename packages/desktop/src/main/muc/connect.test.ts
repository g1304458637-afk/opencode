import { expect, test } from "bun:test"
import { exchangeMucCode } from "./connect"

test("exchange accepts only the requested gateway origin", async () => {
  let mismatch = false
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      return Response.json({
        data: {
          api_key: "test-only-key",
          gateway: mismatch ? "https://different.example" : new URL(request.url).origin,
          brand: "muc",
          audience: "muc:desktop",
        },
      })
    },
  })
  try {
    const origin = `http://127.0.0.1:${server.port}`
    expect((await exchangeMucCode(origin, "test-code", "test-device")).gateway).toBe(origin)
    mismatch = true
    await expect(exchangeMucCode(origin, "test-code", "test-device")).rejects.toThrow("gateway identity mismatch")
    await expect(exchangeMucCode("http://admin.wuxuexi.top", "test-code", "test-device")).rejects.toThrow("HTTPS")
  } finally {
    await server.stop(true)
  }
})
