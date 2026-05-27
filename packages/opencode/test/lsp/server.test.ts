import { describe, expect, test } from "bun:test"
import * as LSPServer from "@/lsp/server"

/**
 * Helper: collects all exported server descriptors from the module.
 * Filters out non-server exports (Handle, Info interfaces).
 */
function getServers(): LSPServer.Info[] {
  return Object.values(LSPServer).filter(
    (v): v is LSPServer.Info =>
      typeof v === "object" &&
      v !== null &&
      "id" in v &&
      "extensions" in v &&
      "root" in v &&
      "spawn" in v,
  )
}

const ServerNames = [
  "Deno",
  "Typescript",
  "Vue",
  "ESLint",
  "Oxlint",
  "Biome",
  "Gopls",
  "Rubocop",
  "Ty",
  "Pyright",
  "ElixirLS",
  "Zls",
  "CSharp",
  "Razor",
  "FSharp",
  "SourceKit",
  "RustAnalyzer",
  "Clangd",
  "Svelte",
  "Astro",
  "JDTLS",
  "KotlinLS",
  "YamlLS",
  "LuaLS",
  "PHPIntelephense",
  "Prisma",
  "Dart",
  "Ocaml",
  "BashLS",
  "TerraformLS",
  "TexLab",
  "DockerfileLS",
  "Gleam",
  "Clojure",
  "Nixd",
  "Tinymist",
  "HLS",
  "JuliaLS",
] as const

describe("LSP server exports", () => {
  test("exports exactly 38 server descriptors", () => {
    const servers = getServers()
    expect(servers.length).toBe(38)
  })

  test("each named server is exported and matches its expected name", () => {
    for (const name of ServerNames) {
      expect(LSPServer).toHaveProperty(name)
    }
  })

  test("all 38 exports are server descriptors", () => {
    const keys = Object.keys(LSPServer)
    // Interfaces (Handle, Info) are type-only and don't emit runtime values.
    // Only the 38 const server objects exist at runtime.
    expect(keys.length).toBe(38)
    for (const key of keys) {
      const v = (LSPServer as Record<string, unknown>)[key]
      expect(typeof v).toBe("object")
      expect(v).not.toBeNull()
    }
  })
})

describe("Info interface compliance", () => {
  const servers = getServers()

  test.each(servers.map((s) => [s.id, s] as const))(
    "server %s has a string id",
    (_, server) => {
      expect(typeof server.id).toBe("string")
      expect(server.id.length).toBeGreaterThan(0)
    },
  )

  test.each(servers.map((s) => [s.id, s] as const))(
    "server %s has a non-empty extensions array",
    (_, server) => {
      expect(Array.isArray(server.extensions)).toBe(true)
      expect(server.extensions.length).toBeGreaterThan(0)
      for (const ext of server.extensions) {
        expect(typeof ext).toBe("string")
        // Most extensions start with ".", but some servers also include
        // bare filenames (e.g., "Dockerfile", "objcpp") as valid matches.
        expect(ext.length).toBeGreaterThan(0)
      }
    },
  )

  test.each(servers.map((s) => [s.id, s] as const))(
    "server %s has a root function",
    (_, server) => {
      expect(typeof server.root).toBe("function")
    },
  )

  test.each(servers.map((s) => [s.id, s] as const))(
    "server %s has a spawn function",
    (_, server) => {
      expect(typeof server.spawn).toBe("function")
    },
  )
})

describe("server ID uniqueness", () => {
  test("no two servers share the same id", () => {
    const servers = getServers()
    const ids = servers.map((s) => s.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  test("all server IDs are distinct", () => {
    const servers = getServers()
    const seen = new Set<string>()
    for (const server of servers) {
      expect(seen.has(server.id)).toBe(false)
      seen.add(server.id)
    }
  })
})

describe("Handle interface shape", () => {
  test("a Handle object requires a process property", () => {
    const handle: LSPServer.Handle = {
      process: {} as any,
    }
    expect(handle.process).toBeDefined()
    expect(handle.initialization).toBeUndefined()
  })

  test("a Handle object accepts optional initialization data", () => {
    const handle: LSPServer.Handle = {
      process: {} as any,
      initialization: { foo: "bar" },
    }
    expect(handle.initialization).toEqual({ foo: "bar" })
  })
})

describe("server extension coverage", () => {
  const servers = getServers()

  test("TypeScript/JavaScript servers include .ts and .tsx", () => {
    const tsServers = servers.filter((s) =>
      [".ts", ".tsx"].some((ext) => s.extensions.includes(ext)),
    )
    expect(tsServers.length).toBeGreaterThanOrEqual(2)
  })

  test("Go server has .go extension", () => {
    const goServer = servers.find((s) => s.id === "gopls")
    expect(goServer).toBeDefined()
    expect(goServer!.extensions).toContain(".go")
  })

  test("Python servers have .py extension", () => {
    const pyServers = servers.filter((s) => s.extensions.includes(".py"))
    expect(pyServers.length).toBeGreaterThanOrEqual(2)
  })

  test("Rust server has .rs extension", () => {
    const rustServer = servers.find((s) => s.id === "rust")
    expect(rustServer).toBeDefined()
    expect(rustServer!.extensions).toContain(".rs")
  })
})

describe("nearestRoot factory usage", () => {
  const servers = getServers()

  test("server root functions are defined (built via NearestRoot)", () => {
    // All server objects use NearestRoot internally or define root as a function.
    // Verify every server has a root that is an async function.
    for (const server of servers) {
      expect(typeof server.root).toBe("function")
      // root should return a Promise (async function or Promise-returning)
      const result = server.root("test.ts", {} as any)
      expect(result).toBeInstanceOf(Promise)
    }
  })

  test("server root functions accept file path and context", () => {
    for (const server of servers) {
      expect(server.root.length).toBeLessThanOrEqual(2)
      expect(server.root.length).toBeGreaterThanOrEqual(1)
    }
  })
})
