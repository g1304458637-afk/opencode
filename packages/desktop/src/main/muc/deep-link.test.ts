import { describe, expect, test } from "bun:test"
import { parseMucUrl, parseCampusUrl } from "./deep-link"

describe("MUC Harness: parseMucUrl", () => {
  test("accepts valid connect link", () => {
    const link = parseMucUrl("muc://connect?code=AbCdEf123456_-0987654321")
    expect(link).toEqual({ kind: "connect", code: "AbCdEf123456_-0987654321" })
  })

  test("rejects non-muc protocol", () => {
    expect(parseMucUrl("opencode://connect?code=AbCdEf123456_-0987654321")).toBeNull()
    expect(parseMucUrl("https://admin.wuxuexi.top/muc")).toBeNull()
  })

  test("rejects unknown host", () => {
    expect(parseMucUrl("muc://login?code=AbCdEf123456_-0987654321")).toBeNull()
  })

  test("rejects missing or malformed code", () => {
    expect(parseMucUrl("muc://connect")).toBeNull()
    expect(parseMucUrl("muc://connect?code=")).toBeNull()
    expect(parseMucUrl("muc://connect?code=short")).toBeNull()
    expect(parseMucUrl("muc://connect?code=has%20space12345678")).toBeNull()
  })

  test("rejects key smuggling attempts", () => {
    expect(parseMucUrl("muc://connect?code=AbCdEf123456_-0987654321&key=sk-real")).toBeNull()
    expect(parseMucUrl("muc://connect?api_key=sk-real")).toBeNull()
  })

  test("rejects garbage input", () => {
    expect(parseMucUrl("not a url")).toBeNull()
    expect(parseMucUrl("")).toBeNull()
  })
})

test("campus protocols reject the other brand", () => {
  const code = "campus_code_123456789"
  expect(parseCampusUrl(`hubu://connect?code=${code}`, "hubu")).toEqual({ kind: "connect", code })
  expect(parseCampusUrl(`muc://connect?code=${code}`, "hubu")).toBeNull()
  expect(parseCampusUrl(`hubu://connect?code=${code}`, "muc")).toBeNull()
})

for (const brand of ["muc", "hubu"]) {
  test(`accepts Windows Shell normalized ${brand} link`, () => {
    const code = "campus_code_123456789"
    expect(parseCampusUrl(`${brand}://connect/?code=${code}`, brand)).toEqual({ kind: "connect", code })
  })
}
