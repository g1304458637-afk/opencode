import { Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"

const lakeVideo =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260826_124724_bc041163-d651-425f-aea3-2acc1efc2c96.mp4"

export function NewSessionBackground() {
  // Start without a source so reduced-motion users never download the video.
  const [state, setState] = createStore({ reduced: true, failed: false })

  onMount(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setState("reduced", preference.matches)
    update()
    preference.addEventListener("change", update)
    onCleanup(() => preference.removeEventListener("change", update))
  })

  return (
    <div class="campus-new-session__background" aria-hidden="true">
      <Show when={!state.reduced && !state.failed}>
        <LakeVideo onError={() => setState("failed", true)} />
      </Show>
    </div>
  )
}

function LakeVideo(props: { onError: () => void }) {
  let video!: HTMLVideoElement
  let disposed = false
  const play = () => {
    void video.play().catch((error: unknown) => {
      if (disposed || (error instanceof DOMException && error.name === "AbortError")) return
      props.onError()
    })
  }

  onMount(() => {
    const visibility = () => (document.hidden ? video.pause() : play())
    visibility()
    document.addEventListener("visibilitychange", visibility)
    onCleanup(() => document.removeEventListener("visibilitychange", visibility))
  })

  onCleanup(() => {
    disposed = true
    video.pause()
    video.removeAttribute("src")
    video.load()
  })

  return (
    <video
      ref={video}
      src={lakeVideo}
      autoplay
      muted
      loop
      playsinline
      preload="metadata"
      onError={() => !disposed && props.onError()}
      onPlaying={(event) => event.currentTarget.setAttribute("data-playing", "true")}
    />
  )
}
