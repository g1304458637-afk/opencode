import type { ServerConnection } from "@/context/server"

export const CAMPUS_PROJECT_OPENED = "kcode:project-opened"
export function notifyCampusProjectOpened(server: ServerConnection.Key, directory: string) {
  window.dispatchEvent(new CustomEvent(CAMPUS_PROJECT_OPENED, { detail: { server, directory } }))
}
