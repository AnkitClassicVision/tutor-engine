// Shared job progress watcher: event stream first, polling fallback, and a guard so a late poll never
// overwrites a finished state. Used by the job page and the planner drawer.
window.watchJob = function watchJob(id, options) {
  const onStatus = options.onStatus || (() => {}), onConnection = options.onConnection || (() => {})
  let lastMessage = Date.now(), finished = false, stream, poll
  function render(status) {
    if (finished) return
    lastMessage = Date.now(); onConnection('')
    const terminal = ['succeeded', 'failed', 'cancelled'].includes(status.status)
    if (terminal) { finished = true; stream?.close(); clearInterval(poll); clearInterval(watchdog) }
    onStatus(status, terminal)
  }
  async function fetchStatus() {
    try { const response = await fetch(`/jobs/${id}/status`); if (!response.ok) throw new Error(); render(await response.json()) }
    catch { if (!finished) onConnection('Connection paused. Your work is saved. We’ll check again.') }
  }
  function fallback() { stream?.close(); if (!poll && !finished) poll = setInterval(fetchStatus, 2000) }
  if ('EventSource' in window) {
    stream = new EventSource(`/jobs/${id}/events`)
    stream.addEventListener('status', event => { try { render(JSON.parse(event.data)) } catch { fallback() } })
    stream.onerror = fallback
  } else fallback()
  fetchStatus()
  const watchdog = setInterval(() => {
    if (!finished && Date.now() - lastMessage > 7000) { onConnection('Checking the connection. Your work is saved.'); fallback() }
  }, 1000)
  const close = () => { finished = true; stream?.close(); clearInterval(poll); clearInterval(watchdog) }
  addEventListener('pagehide', close, { once: true })
  return { close }
}
