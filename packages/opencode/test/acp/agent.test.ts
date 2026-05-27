import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event } from "@opencode-ai/sdk/v2"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const pollUntil = async <T>(
  check: () => T | undefined | false | Promise<T | undefined | false>,
  message: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<T> => {
  const timeoutMs = opts?.timeoutMs ?? 2000
  const intervalMs = opts?.intervalMs ?? 5
  const started = Date.now()
  while (true) {
    const v = await check()
    if (v !== undefined && v !== null && v !== false) return v as T
    if (Date.now() - started > timeoutMs) throw new Error(message)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]
type RequestPermissionResult = Awaited<ReturnType<AgentSideConnection["requestPermission"]>>
type GlobalEventEnvelope = {
  directory?: string
  payload?: Event
}

function createEventStream() {
  const queue: GlobalEventEnvelope[] = []
  const waiters: Array<(value: GlobalEventEnvelope | undefined) => void> = []
  const state = { closed: false }

  const push = (event: GlobalEventEnvelope) => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    queue.push(event)
  }

  const close = () => {
    state.closed = true
    for (const waiter of waiters.splice(0)) {
      waiter(undefined)
    }
  }

  const stream = async function* (signal?: AbortSignal) {
    while (true) {
      if (signal?.aborted) return
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (state.closed) return
      const value = await new Promise<GlobalEventEnvelope | undefined>((resolve) => {
        waiters.push(resolve)
        if (!signal) return
        signal.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  return { controller: { push, close } satisfies { push: typeof push; close: typeof close }, stream }
}

function createFakeAgent(opts?: { defaultModel?: { providerID: string; modelID: string } }) {
  const sessionUpdates: SessionUpdateParams[] = []
  let sessionPromptCalled = 0
  let sessionAbortCalled = 0
  let sessionListCalled = 0
  let sessionCommandCalled = 0
  let sessionSummarizeCalled = 0
  let configGetCalled = 0

  const connection = {
    async sessionUpdate(params: SessionUpdateParams) {
      sessionUpdates.push(params)
    },
    async requestPermission(_params: RequestPermissionParams): Promise<RequestPermissionResult> {
      return { outcome: { outcome: "selected", optionId: "once" } } as RequestPermissionResult
    },
  } as unknown as AgentSideConnection

  const { controller, stream } = createEventStream()

  const sdk: Record<string, any> = {
    global: {
      event: async (opts_?: { signal?: AbortSignal }) => {
        return { stream: stream(opts_?.signal) }
      },
    },
    session: {
      create: async (_params?: any) => ({
        data: {
          id: "ses_new",
          time: { created: new Date().toISOString() },
        },
      }),
      get: async (_params?: any) => ({
        data: {
          id: "ses_1",
          time: { created: new Date().toISOString() },
        },
      }),
      messages: async () => ({ data: [] }),
      message: async (params?: any) => ({
        data: {
          info: { role: "assistant" },
          parts: [{ id: params?.messageID ? `${params.messageID}_part` : "part_1", type: "text", text: "" }],
        },
      }),
      prompt: async (_params?: any) => {
        sessionPromptCalled++
        return {
          data: {
            info: {
              role: "assistant",
              tokens: { input: 10, output: 20, reasoning: 0, cache: {} },
              cost: 0.001,
            },
          },
        }
      },
      abort: async (_params?: any) => {
        sessionAbortCalled++
        return { data: true }
      },
      list: async (params?: any) => {
        sessionListCalled++
        return {
          data: [
            {
              id: "ses_1",
              directory: params?.directory ?? "/tmp",
              title: "Test Session 1",
              time: { updated: Date.now() },
            },
            {
              id: "ses_2",
              directory: params?.directory ?? "/tmp",
              title: "Test Session 2",
              time: { updated: Date.now() - 10000 },
            },
          ],
        }
      },
      command: async (_params?: any) => {
        sessionCommandCalled++
        return {
          data: {
            info: {
              role: "assistant",
              tokens: { input: 5, output: 10, reasoning: 0, cache: {} },
              cost: 0.001,
            },
          },
        }
      },
      summarize: async (_params?: any) => {
        sessionSummarizeCalled++
        return { data: true }
      },
      fork: async (_params?: any) => ({
        data: {
          id: "ses_forked",
          time: { created: new Date().toISOString() },
        },
      }),
    },
    permission: {
      reply: async (_params?: any) => ({ data: true }),
      respond: async (_params?: any) => ({ data: true }),
    },
    config: {
      providers: async (_params?: any) => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "opencode",
              models: {
                "big-pickle": { id: "big-pickle", name: "big-pickle", providerID: "opencode" },
              },
            },
            {
              id: "anthropic",
              name: "Anthropic",
              models: {
                "claude-sonnet-4": { id: "claude-sonnet-4", name: "claude-sonnet-4", providerID: "anthropic" },
              },
            },
          ],
        },
      }),
      get: async (_params?: any) => {
        configGetCalled++
        return {
          data: { model: "opencode/big-pickle" },
        }
      },
    },
    app: {
      agents: async () => ({
        data: [
          { name: "code", description: "Code mode", mode: "agent" },
          { name: "ask", description: "Ask mode", mode: "agent" },
        ],
      }),
    },
    command: {
      list: async () => ({
        data: [
          { name: "test", description: "A test command" },
        ],
      }),
    },
    mcp: {
      add: async () => ({ data: true }),
    },
  }

  const agent = new ACP.Agent(connection, {
    sdk,
    ...(opts?.defaultModel !== undefined
      ? { defaultModel: opts.defaultModel }
      : {}),
  } as any)

  const stop = () => {
    controller.close()
    ;(agent as any).eventAbort.abort()
  }

  return {
    agent,
    controller,
    sessionUpdates,
    sessionPromptCalled: () => sessionPromptCalled,
    sessionAbortCalled: () => sessionAbortCalled,
    sessionListCalled: () => sessionListCalled,
    sessionCommandCalled: () => sessionCommandCalled,
    sessionSummarizeCalled: () => sessionSummarizeCalled,
    configGetCalled: () => configGetCalled,
    stop,
    sdk,
    connection,
  }
}

describe("acp.agent critical workflows", () => {
  test("manages session lifecycle: newSession → prompt → closeSession", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionPromptCalled, sessionAbortCalled, stop } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })
        const cwd = "/tmp/opencode-acp-test"

        // Step 1: Create a new session
        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)
        expect(newSession.sessionId).toBeTruthy()
        expect(newSession.models).toBeDefined()
        expect(newSession.models.currentModelId).toBe("opencode/big-pickle")
        expect(newSession.configOptions).toBeDefined()

        const sessionId = newSession.sessionId

        // Step 2: Prompt the session
        const promptResult = await agent.prompt({
          sessionId,
          prompt: [{ type: "text" as const, text: "Hello, what can you do?" }],
        })
        expect(promptResult.stopReason).toBe("end_turn")
        expect(sessionPromptCalled()).toBe(1)

        // Step 3: Close the session
        const closeResult = await agent.closeSession({ sessionId })
        expect(closeResult).toEqual({})
        expect(sessionAbortCalled()).toBe(1)

        stop()
      },
    })
  })

  test("cancels an active prompt", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionAbortCalled, stop } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })
        const cwd = "/tmp/opencode-acp-test"

        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)
        const sessionId = newSession.sessionId

        // Cancel an active session
        await agent.cancel({ sessionId })

        expect(sessionAbortCalled()).toBe(1)

        stop()
      },
    })
  })

  test("lists sessions and resolves pagination cursor", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionListCalled, stop } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })
        const cwd = "/tmp/opencode-acp-test"

        // Create a session so sessionManager has state
        await agent.newSession({ cwd, mcpServers: [] } as any)

        // List sessions
        const result = await agent.listSessions({ cwd } as any)
        expect(result.sessions).toBeDefined()
        expect(result.sessions.length).toBeGreaterThanOrEqual(1)
        expect(sessionListCalled()).toBe(1)

        // Verify session shape
        const firstSession = result.sessions[0]
        expect(firstSession.sessionId).toBeTruthy()
        expect(firstSession.cwd).toBeTruthy()
        expect(firstSession.title).toBeTruthy()
        expect(firstSession.updatedAt).toBeTruthy()

        stop()
      },
    })
  })

  test("resolves model via lastUsedModel fallback when no defaultModel configured", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        // Create a fake agent WITHOUT defaultModel to exercise the fallback chain
        const { agent, stop, sdk } = createFakeAgent()

        // Override config.get to return undefined model so it falls through to lastUsedModel
        sdk.config.get = async () => ({ data: {} })

        // Override session.list to return a session with a model we can resolve
        sdk.session.list = async () => ({
          data: [
            {
              id: "ses_recent",
              directory: "/tmp",
              title: "Recent Session",
              time: { updated: Date.now() },
            },
          ],
        })

        // Override session.messages to return a message with a user who used a known model
        sdk.session.messages = async () => ({
          data: [
            {
              info: {
                role: "user",
                sessionID: "ses_recent",
                model: { providerID: "opencode", modelID: "big-pickle" },
              },
              parts: [{ type: "text", text: "hello" }],
            },
          ],
        })

        const cwd = "/tmp/opencode-acp-test"
        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)

        // Should have fallen through to lastUsedModel → opencode/big-pickle
        expect(newSession.sessionId).toBeTruthy()
        expect(newSession.models).toBeDefined()
        expect(newSession.models.currentModelId).toContain("opencode")
        expect(newSession.models.currentModelId).toContain("big-pickle")

        stop()
      },
    })
  })

  test("routes /command prompts through session command API", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionCommandCalled, stop } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })
        const cwd = "/tmp/opencode-acp-test"

        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)
        const sessionId = newSession.sessionId

        // Prompt with a command that exists in the mock (command.list returns "test")
        const result = await agent.prompt({
          sessionId,
          prompt: [{ type: "text" as const, text: "/test some args" }],
        })

        expect(result.stopReason).toBe("end_turn")
        expect(sessionCommandCalled()).toBe(1)

        stop()
      },
    })
  })

  test("routes /compact command through session summarize API", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionSummarizeCalled, stop } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })
        const cwd = "/tmp/opencode-acp-test"

        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)
        const sessionId = newSession.sessionId

        // Prompt with /compact
        const result = await agent.prompt({
          sessionId,
          prompt: [{ type: "text" as const, text: "/compact" }],
        })

        expect(result.stopReason).toBe("end_turn")
        expect(sessionSummarizeCalled()).toBe(1)

        stop()
      },
    })
  })

  test("setSessionMode validates against available modes", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })
        const cwd = "/tmp/opencode-acp-test"

        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)
        const sessionId = newSession.sessionId

        // Should succeed for a known mode
        await agent.setSessionMode({ sessionId, modeId: "code" })

        // Should throw for an unknown mode
        await expect(
          agent.setSessionMode({ sessionId, modeId: "nonexistent-mode" }),
        ).rejects.toThrow("Agent not found")

        stop()
      },
    })
  })

  test("setSessionConfigOption handles model, effort, and mode config", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop, sdk } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })

        // Add a model with variants so effort config works
        sdk.config.providers = async () => ({
          data: {
            providers: [
              {
                id: "opencode",
                name: "opencode",
                models: {
                  "big-pickle": {
                    id: "big-pickle",
                    name: "big-pickle",
                    providerID: "opencode",
                    variants: { high: {}, low: {} },
                  },
                },
              },
            ],
          },
        })

        const cwd = "/tmp/opencode-acp-test"
        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)
        const sessionId = newSession.sessionId

        // Set model config
        const modelResult = await agent.setSessionConfigOption({
          sessionId,
          configId: "model",
          value: "opencode/big-pickle",
        })
        expect(modelResult.configOptions).toBeDefined()

        // Set effort config
        const effortResult = await agent.setSessionConfigOption({
          sessionId,
          configId: "effort",
          value: "high",
        })
        expect(effortResult.configOptions).toBeDefined()

        // Set mode config
        const modeResult = await agent.setSessionConfigOption({
          sessionId,
          configId: "mode",
          value: "code",
        })
        expect(modeResult.configOptions).toBeDefined()

        // Invalid effort should throw
        await expect(
          agent.setSessionConfigOption({
            sessionId,
            configId: "effort",
            value: "nonexistent-effort",
          }),
        ).rejects.toThrow()

        // Invalid configId should throw
        await expect(
          agent.setSessionConfigOption({
            sessionId,
            configId: "invalid_option",
            value: "something",
          }),
        ).rejects.toThrow()

        stop()
      },
    })
  })

  test("unstable_setSessionModel updates connection with new config options", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })
        const cwd = "/tmp/opencode-acp-test"

        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)
        const sessionId = newSession.sessionId

        const result = await agent.unstable_setSessionModel({
          sessionId,
          modelId: "opencode/big-pickle",
        })
        expect(result._meta).toBeDefined()
        expect(result._meta.opencode).toBeDefined()
        expect(result._meta.opencode.modelId).toBe("opencode/big-pickle")

        stop()
      },
    })
  })

  test("resumeSession loads existing session state", async () => {
    await using tmp = await tmpdir()
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const { agent, stop } = createFakeAgent({
          defaultModel: { providerID: "opencode", modelID: "big-pickle" },
        })
        const cwd = "/tmp/opencode-acp-test"

        // First create a session so sessionManager has the mapping
        const newSession = await agent.newSession({ cwd, mcpServers: [] } as any)
        const sessionId = newSession.sessionId

        // Resume it
        const resumeResult = await agent.resumeSession({ sessionId, cwd, mcpServers: [] } as any)
        expect(resumeResult.models).toBeDefined()
        expect(resumeResult.configOptions).toBeDefined()

        stop()
      },
    })
  })
})
