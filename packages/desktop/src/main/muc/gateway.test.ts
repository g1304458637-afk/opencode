import { expect, test } from "bun:test"
import { validateCampusGateway } from "./gateway"

test("credential origins require HTTPS except explicit loopback development", () => {
  expect(validateCampusGateway("https://admin.wuxuexi.top", false)).toBe("https://admin.wuxuexi.top")
  for (const local of [true, false])
    expect(() => validateCampusGateway("http://admin.wuxuexi.top", local)).toThrow("HTTPS")
  expect(() => validateCampusGateway("http://localhost:8081", false)).toThrow("HTTPS")
  expect(validateCampusGateway("http://localhost:8081", true)).toBe("http://localhost:8081")
  for (const origin of ["https://user:pass@example.org", "https://example.org/path", "https://example.org?token=x"])
    expect(() => validateCampusGateway(origin, false)).toThrow()
})
