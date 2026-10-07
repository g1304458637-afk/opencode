import { resolveBrand } from "@opencode-ai/brand"
import { createMemo, onCleanup, startTransition } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useGlobal } from "./global"
import { useLayout } from "./layout"
import { ServerConnection, useServer } from "./server"
import { useTabs } from "./tabs"
import { loadHomeSessionIndex, type HomeSessionEvents } from "./global-sync/home-session-index"
import { compareSessionRecent } from "./global-sync/session-trim"
import { Persist, persisted } from "@/utils/persist"
import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import { pathKey } from "@/utils/path-key"
import { campusProjectFor, type CampusProject } from "@/components/campus/campus-project-groups"

import { campusDeleteTree, runCampusDelete, type CampusDeleteSession } from "@/components/campus/campus-delete"

import { CAMPUS_PROJECT_OPENED } from "@/components/campus/campus-project-events"

type Preferences = {
  view: "projects" | "recent"
  servers: Record<
    string,
    {
      assigned: Record<string, string | null>
      collapsed: Record<string, boolean>
      hidden?: Record<string, boolean>
    }
  >
}

export const { use: useCampusProjects, provider: CampusProjectsProvider } = createSimpleContext({
  name: "CampusProjects",
  gate: false,
  init: () => {
    const global = useGlobal()
    const server = useServer()
    const tabs = useTabs()
    const layout = useLayout()
    const [preferences, setPreferences, , ready] = persisted(
      Persist.global("campus.projects.v1"),
      createStore<Preferences>({ view: "projects", servers: {} }),
    )
    const reopened = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        !event.detail ||
        typeof event.detail.server !== "string" ||
        typeof event.detail.directory !== "string"
      )
        return
      const target = event.detail.server
      if (!preferences.servers[target]) return
      const directory = pathKey(event.detail.directory)
      setPreferences("servers", target, "hidden", (value) => ({ ...value, [directory]: false }))
      setPreferences("servers", target, "collapsed", directory, false)
    }
    window.addEventListener(CAMPUS_PROJECT_OPENED, reopened)
    onCleanup(() => window.removeEventListener(CAMPUS_PROJECT_OPENED, reopened))
    const ctx = createMemo(() => (server.current ? global.ensureServerCtx(server.current) : undefined))
    const key = () => (server.current ? ServerConnection.key(server.current) : "offline")
    const [operation, setOperation] = createStore({
      busy: false,
      deleted: {} as Record<string, Record<string, boolean>>,
    })
    const cache = () => ctx()?.sync.homeSessions
    const fallbackQueryClient = useQueryClient()
    // The shell has its own provider; observe the cache that receives server events.
    const queryClient = () => cache()?.queryClient ?? fallbackQueryClient
    const events = useQuery(
      () => ({
        queryKey: cache()?.eventsKey ?? ["campus-recent-events", "offline"],
        queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
        initialData: { sequence: 0, entries: [] } satisfies HomeSessionEvents,
        enabled: false,
      }),
      queryClient,
    )
    const index = useQuery(
      () => ({
        queryKey: cache()?.indexKey ?? ["campus-recent-index", "offline"],
        enabled: resolveBrand().id === "hubu" && !!ctx(),
        queryFn: async ({ signal }) => {
          const current = ctx()
          if (!current) return { sessions: [], eventSequence: 0 }
          const sequence = current.sync.homeSessions.eventSequence()
          const result = await loadHomeSessionIndex(
            (input, options) => current.sdk.client.v2.session.list(input, options),
            sequence,
            signal,
          )
          current.sync.homeSessions.complete(sequence)
          return result
        },
        retry: false,
        staleTime: 30_000,
      }),
      queryClient,
    )
    const sessions = createMemo(() =>
      [...(cache()?.sessions(index.data, events.data) ?? [])]
        .filter((s) => !operation.deleted[key()]?.[s.id])
        .sort(compareSessionRecent),
    )
    const assigned = () => preferences.servers[key()]?.assigned ?? {}
    const allProjects = createMemo(() => {
      const current = ctx()
      if (!current) return []
      const named = current.sync.data.project
      const entries = [
        ...current.projects.list().map((p) => ({ directory: p.worktree, name: p.name })),
        ...named.filter((p) => p.id !== "global").map((p) => ({ directory: p.worktree, name: p.name })),
        ...Object.values(assigned()).flatMap((directory) => (directory ? [{ directory, name: undefined }] : [])),
        ...sessions().map((s) => ({ directory: s.directory, name: undefined })),
      ]
      const seen = new Set<string>()
      return entries.flatMap((entry): CampusProject[] => {
        const directory = pathKey(entry.directory)
        const leaf = directory.split("/").at(-1) ?? directory
        // The desktop onboarding scratch folder and filesystem roots remain independent chats.
        if (!directory || directory === "/" || /^[A-Za-z]:\/$/.test(directory) || leaf === "Default Project") return []
        if (seen.has(directory)) return []
        // A session in a repository subdirectory belongs to that repository unless explicitly opened separately.
        if (
          !entry.name &&
          named.some(
            (p) =>
              p.id !== "global" && pathKey(p.worktree) !== directory && directory.startsWith(`${pathKey(p.worktree)}/`),
          )
        )
          return []
        seen.add(directory)
        return [{ directory, name: entry.name || named.find((p) => pathKey(p.worktree) === directory)?.name || leaf }]
      })
    })
    const hidden = (directory: string) => preferences.servers[key()]?.hidden?.[pathKey(directory)] === true
    const projects = createMemo(() => allProjects().filter((p) => !hidden(p.directory)))
    const membership = createMemo(
      () => new Map(sessions().map((session) => [session.id, campusProjectFor(session, allProjects(), assigned())])),
    )
    const projectFor = (session: Pick<Session, "id" | "directory">) => {
      const directory = membership().has(session.id)
        ? membership().get(session.id)
        : campusProjectFor(session, allProjects(), assigned())
      return directory && !hidden(directory) ? directory : undefined
    }
    const activeID = () => {
      const route = layout.route()
      return route.type === "session" && (!route.server || route.server === key()) ? route.sessionId : undefined
    }
    const active = createMemo(() => sessions().find((s) => s.id === activeID()))
    const activeProject = createMemo(() => {
      const session = active()
      return session ? projects().find((p) => p.directory === projectFor(session)) : undefined
    })
    const ensurePreferences = () => {
      if (!preferences.servers[key()]) setPreferences("servers", key(), { assigned: {}, collapsed: {} })
    }
    const hide = (directory: string, target = key(), current = ctx()) => {
      if (!current) return
      if (!preferences.servers[target]) setPreferences("servers", target, { assigned: {}, collapsed: {} })
      setPreferences("servers", target, "hidden", (value) => ({ ...value, [pathKey(directory)]: true }))
      for (const project of current.projects.list()) {
        if (pathKey(project.worktree) === pathKey(directory)) current.projects.close(project.worktree)
      }
    }
    const prepareDelete = async (
      roots: CampusDeleteSession[],
      current = ctx(),
      target = server.current && ServerConnection.key(server.current),
    ) => {
      if (!current || !target) throw new Error("Server unavailable")
      const list = async () => {
        const sessions: CampusDeleteSession[] = []
        const seen = new Set<string>()
        let cursor: string | undefined
        for (;;) {
          const response = await current.sdk.client.v2.session.list(
            { limit: 5000, order: "desc", cursor },
            { throwOnError: true },
          )
          if (!response.data) throw new Error("Session index unavailable")
          sessions.push(
            ...response.data.data.map((s) => ({
              id: s.id,
              parentID: s.parentID,
              title: s.title,
              directory: s.location.directory,
            })),
          )
          const next = response.data.cursor.next
          if (!next) return sessions
          if (seen.has(next)) throw new Error("Repeated session cursor")
          seen.add(next)
          cursor = next
        }
      }
      const snapshot = await list()
      const confirmed = [
        ...new Map(
          roots
            .flatMap((root) => {
              const tree = campusDeleteTree(root.id, snapshot)
              return tree.length ? tree : [root]
            })
            .map((s) => [s.id, s]),
        ).values(),
      ]
      return {
        confirmed,
        async execute(pending: CampusDeleteSession[]) {
          if (operation.busy) throw new Error("Deletion in progress")
          setOperation("busy", true)
          try {
            const live = await list()
            const running = new Set<string>()
            if ((await current.sdk.protocol) === "v1") {
              for (const directory of new Set(confirmed.map((s) => s.directory))) {
                const response = await current.sdk
                  .createClient({ directory })
                  .session.status(undefined, { throwOnError: true })
                if (!response.data) throw new Error("Session status unavailable")
                for (const [id, status] of Object.entries(response.data)) if (status.type !== "idle") running.add(id)
              }
            } else {
              for (const id of Object.keys(await current.sdk.api.session.active())) running.add(id)
            }
            const removed = new Set<string>()
            const result = await runCampusDelete({
              roots: pending,
              confirmed,
              current: live,
              running,
              remove: async (session) => {
                await current.sdk.api.session.remove({ sessionID: session.id, directory: session.directory })
                if (campusDeleteTree(session.id, await list()).length) throw new Error("Session deletion not confirmed")
              },
              removed: (sessions) => {
                for (const session of sessions) {
                  removed.add(session.id)
                  setOperation("deleted", target, (ids) => ({ ...ids, [session.id]: true }))
                  current.sync.homeSessions.remove(session.id)
                  const [, setStore] = current.sync.child(session.directory, { bootstrap: false })
                  setStore("session", (items) => items.filter((s) => s.id !== session.id))
                  current.sync.session.apply({ type: "session.deleted", properties: { sessionID: session.id } })
                  if (preferences.servers[target])
                    setPreferences(
                      "servers",
                      target,
                      "assigned",
                      produce((value) => {
                        delete value[session.id]
                      }),
                    )
                }
              },
            })
            const active = layout.route()
            const wasCurrent =
              active.type === "session" && (!active.server || active.server === target) && removed.has(active.sessionId)
            const remaining = tabs.store.filter(
              (tab) => !(tab.type === "session" && tab.server === target && removed.has(tab.sessionId)),
            )
            tabs.removeSessions({ server: target, directory: pending[0]?.directory ?? "", sessionIDs: [...removed] })
            if (wasCurrent) {
              const next = remaining.at(-1)
              if (next) tabs.select(next)
              else await tabs.newDraft({ server: target, directory: pending[0]?.directory })
            }
            for (const directory of new Set(confirmed.filter((s) => removed.has(s.id)).map((s) => s.directory))) {
              notifySessionTabsRemoved({
                server: target,
                directory,
                sessionIDs: confirmed.filter((s) => s.directory === directory && removed.has(s.id)).map((s) => s.id),
              })
            }
            return result
          } finally {
            setOperation("busy", false)
          }
        },
        hideProject(directory: string) {
          // New chats arriving after confirmation are preserved as independent chats.
          hide(directory, target, current)
        },
      }
    }
    return {
      busy: () => operation.busy,
      prepareDelete,
      captureDeletion() {
        const current = ctx()
        const target = server.current && ServerConnection.key(server.current)
        return (roots: CampusDeleteSession[]) => prepareDelete(roots, current, target)
      },
      projectRemoval(directory: string) {
        const target = key()
        const current = ctx()
        return () => hide(directory, target, current)
      },
      restoreProject(directory: string) {
        ensurePreferences()
        setPreferences("servers", key(), "hidden", (value) => ({ ...value, [pathKey(directory)]: false }))
        setPreferences("servers", key(), "collapsed", pathKey(directory), false)
      },
      sessions,
      projects,
      projectFor,
      activeID,
      activeProject,
      active,
      ready,
      loading: () => index.isLoading,
      error: () => index.isError,
      retry: () => index.refetch(),
      view: () => preferences.view,
      setView: (view: Preferences["view"]) => setPreferences("view", view),
      collapsed: (directory: string) =>
        preferences.servers[key()]?.collapsed[directory] ??
        !ctx()
          ?.projects.list()
          .some((project) => pathKey(project.worktree) === directory && project.expanded),
      toggle(directory: string) {
        if (!ready()) return
        const collapsed =
          preferences.servers[key()]?.collapsed[directory] ??
          !ctx()
            ?.projects.list()
            .some((project) => pathKey(project.worktree) === directory && project.expanded)
        ensurePreferences()
        setPreferences("servers", key(), "collapsed", directory, !collapsed)
      },
      assign(session: Session, directory: string | null) {
        if (!ready()) return
        ensurePreferences()
        // Organization metadata only. Never change a conversation's execution directory.
        setPreferences("servers", key(), "assigned", session.id, directory)
      },
      open(session: Session) {
        const current = ctx()
        const conn = server.current
        if (!current || !conn) return
        current.projects.open(session.directory)
        current.projects.touch(session.directory)
        void startTransition(() =>
          tabs.select(tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })),
        )
      },
      create(directory: string) {
        const current = ctx()
        const conn = server.current
        if (!current || !conn) return
        current.projects.open(directory)
        current.projects.touch(directory)
        void tabs.newDraft({ server: ServerConnection.key(conn), directory })
      },
    }
  },
})
