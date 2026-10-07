import { createMemo, createUniqueId, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { Icon } from "@opencode-ai/ui/icon"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { useLanguage } from "@/context/language"
import { useCampusProjects } from "@/context/campus-projects"

import { CampusDeleteDialog, type CampusDeleteRequest } from "./campus-delete-dialog"

export function CampusRecentTasks() {
  const language = useLanguage()
  const projects = useCampusProjects()
  const id = createUniqueId()
  const [state, setState] = createStore({
    limits: {} as Record<string, number>,
    removal: undefined as CampusDeleteRequest | undefined,
  })
  const directories = createMemo(() => projects.projects().map((project) => project.directory))
  const independent = createMemo(() => projects.sessions().filter((session) => !projects.projectFor(session)))
  const when = (time: number) => {
    const date = DateTime.fromMillis(time)
    const now = DateTime.local()
    if (date.hasSame(now, "day")) return language.t("home.sessions.group.today")
    if (date.hasSame(now.minus({ days: 1 }), "day")) return language.t("home.sessions.group.yesterday")
    return language.t("home.sessions.group.older")
  }
  const SessionRow = (props: { session: Session; recent?: boolean }) => (
    <div class="campus-session-row" data-active={projects.activeID() === props.session.id ? "true" : undefined}>
      <button
        class="campus-session-link"
        type="button"
        title={`${props.session.title}\n${props.session.directory}`}
        aria-current={projects.activeID() === props.session.id ? "page" : undefined}
        onClick={() => projects.open(props.session)}
      >
        <Icon name="bubble-5" size="small" />
        <span>
          <span class="campus-session-title">{props.session.title}</span>
          <Show when={props.recent}>
            <small>
              {projects.projects().find((p) => p.directory === projects.projectFor(props.session))?.name ??
                language.t("campus.projects.independent")}
            </small>
          </Show>
        </span>
        <small>{when(props.session.time.updated ?? props.session.time.created)}</small>
      </button>
      <DropdownMenu placement="bottom-end">
        <DropdownMenu.Trigger
          class="campus-session-more"
          aria-label={language.t("campus.projects.organize", { title: props.session.title })}
          disabled={!projects.ready() || projects.busy()}
        >
          <Icon name="dot-grid" size="small" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="campus-project-menu">
            <p class="campus-project-menu-note">{language.t("campus.projects.move")}</p>
            <DropdownMenu.Item onSelect={() => projects.assign(props.session, null)}>
              <DropdownMenu.ItemLabel>{language.t("campus.projects.independent")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <For each={projects.projects()}>
              {(project) => (
                <DropdownMenu.Item onSelect={() => projects.assign(props.session, project.directory)}>
                  <Icon name="folder" size="small" />
                  <DropdownMenu.ItemLabel>{project.name}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              )}
            </For>
            <p class="campus-project-menu-note">{language.t("campus.projects.moveHint")}</p>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              class="campus-delete-danger"
              onSelect={() =>
                setState("removal", { mode: "session", name: props.session.title, sessions: [{ ...props.session }] })
              }
            >
              <DropdownMenu.ItemLabel>{language.t("session.delete.button")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
  const SessionList = (props: { sessions: Session[]; group: string; recent?: boolean }) => (
    <>
      <For each={props.sessions.slice(0, state.limits[props.group] ?? 5).map((session) => session.id)}>
        {(id) => <SessionRow session={props.sessions.find((session) => session.id === id)!} recent={props.recent} />}
      </For>
      <Show when={props.sessions.length > (state.limits[props.group] ?? 5)}>
        <button
          class="campus-project-more"
          onClick={() => setState("limits", props.group, (value) => (value ?? 5) + 20)}
        >
          {language.t("campus.projects.more")}
        </button>
      </Show>
    </>
  )
  return (
    <>
      <Show when={state.removal}>
        {(request) => <CampusDeleteDialog request={request()} onClose={() => setState("removal", undefined)} />}
      </Show>
      <section class="campus-project-browser" aria-label={language.t("sidebar.nav.projectsAndSessions")}>
        <div class="campus-project-tabs" role="tablist" aria-label={language.t("campus.projects.view")}>
          <For each={["projects", "recent"] as const}>
            {(view) => (
              <button
                type="button"
                role="tab"
                id={`${id}-${view}`}
                aria-controls={`${id}-panel`}
                aria-selected={projects.view() === view}
                tabIndex={projects.view() === view ? 0 : -1}
                disabled={!projects.ready() || projects.busy()}
                onClick={() => projects.setView(view)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
                  event.preventDefault()
                  const next =
                    event.key === "Home"
                      ? "projects"
                      : event.key === "End"
                        ? "recent"
                        : view === "projects"
                          ? "recent"
                          : "projects"
                  projects.setView(next)
                  document.getElementById(`${id}-${next}`)?.focus()
                }}
              >
                {language.t(view === "projects" ? "home.projects" : "campus.projects.recent")}
              </button>
            )}
          </For>
        </div>
        <div
          class="campus-project-scroll"
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${projects.view()}`}
        >
          <Show when={projects.loading()}>
            <p class="campus-project-empty" role="status">
              {language.t("common.loading")}
            </p>
          </Show>
          <Show when={projects.error()}>
            <p class="campus-project-empty" role="status">
              {language.t("campus.start.recent.error")}
            </p>
            <button class="campus-project-more" onClick={() => void projects.retry()}>
              {language.t("campus.projects.retry")}
            </button>
          </Show>
          <Show
            when={projects.view() === "projects"}
            fallback={
              <section aria-label={language.t("campus.start.recent")}>
                <SessionList sessions={projects.sessions()} group="recent" recent />
                <Show when={!projects.loading() && !projects.error() && !projects.sessions().length}>
                  <p class="campus-project-empty">{language.t("campus.start.recent.empty")}</p>
                </Show>
              </section>
            }
          >
            <For each={directories()}>
              {(directory) => {
                const project = {
                  directory,
                  get name() {
                    return projects.projects().find((item) => item.directory === directory)?.name ?? directory
                  },
                  get sessions() {
                    return projects.sessions().filter((session) => projects.projectFor(session) === directory)
                  },
                }
                const groupID = createUniqueId()
                return (
                  <section class="campus-project-group" aria-label={project.name}>
                    <div class="campus-project-heading">
                      <button
                        class="campus-project-toggle"
                        title={project.directory}
                        aria-expanded={!projects.collapsed(project.directory)}
                        aria-controls={groupID}
                        onClick={() => projects.toggle(project.directory)}
                      >
                        <Icon name="folder" size="normal" />
                        <span>{project.name}</span>
                        <Icon
                          name={projects.collapsed(project.directory) ? "chevron-right" : "chevron-down"}
                          size="small"
                        />
                      </button>
                      <button
                        class="campus-project-create"
                        title={language.t("campus.projects.new", { name: project.name })}
                        aria-label={language.t("campus.projects.new", { name: project.name })}
                        onClick={() => projects.create(project.directory)}
                      >
                        <Icon name="plus-small" size="normal" />
                      </button>
                      <DropdownMenu placement="bottom-end">
                        <DropdownMenu.Trigger
                          class="campus-project-create"
                          disabled={!projects.ready() || projects.busy()}
                          aria-label={language.t("campus.delete.menu", { name: project.name })}
                        >
                          <Icon name="dot-grid" size="small" />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content>
                            <DropdownMenu.Item
                              onSelect={() =>
                                setState("removal", {
                                  mode: "remove",
                                  name: project.name,
                                  directory,
                                  sessions: project.sessions.map((s) => ({ ...s })),
                                })
                              }
                            >
                              <DropdownMenu.ItemLabel>{language.t("campus.delete.remove")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              class="campus-delete-danger"
                              onSelect={() =>
                                setState("removal", {
                                  mode: "project",
                                  name: project.name,
                                  directory,
                                  sessions: project.sessions.map((s) => ({ ...s })),
                                })
                              }
                            >
                              <DropdownMenu.ItemLabel>{language.t("campus.delete.project")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </div>
                    <div id={groupID} hidden={projects.collapsed(project.directory)} class="campus-project-children">
                      <SessionList sessions={project.sessions} group={project.directory} />
                      <Show when={!project.sessions.length && !projects.loading() && !projects.error()}>
                        <button class="campus-project-more" onClick={() => projects.create(project.directory)}>
                          {language.t("campus.projects.empty")}
                        </button>
                      </Show>
                    </div>
                  </section>
                )
              }}
            </For>
            <Show when={!directories().length && !projects.loading() && !projects.error()}>
              <p class="campus-project-empty">{language.t("campus.projects.addHint")}</p>
            </Show>
            <section class="campus-independent" aria-label={language.t("campus.projects.independent")}>
              <h2>{language.t("campus.projects.independent")}</h2>
              <SessionList sessions={independent()} group="independent" />
              <Show when={!independent().length && !projects.loading() && !projects.error()}>
                <p class="campus-project-empty">{language.t("campus.projects.independentEmpty")}</p>
              </Show>
            </section>
          </Show>
        </div>
      </section>
    </>
  )
}
