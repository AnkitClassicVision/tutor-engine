import type { Page } from '@playwright/test'
export async function devices(page: Page, simulatedPlayback = false) {
  await page.addInitScript((simulatedPlayback) => {
    const state = { calls: [] as any[], stops: 0, deny: false, pending: false, resolve: null as any }
    ;(window as any).__camera = state
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async (constraints: any) => {
      state.calls.push(constraints)
      if (state.deny) throw new DOMException('Synthetic denial', 'NotAllowedError')
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240
      const context = canvas.getContext('2d')!; context.fillStyle = '#e2eee8'; context.fillRect(0,0,320,240); context.fillStyle = '#174c43'; context.font = '20px sans-serif'; context.fillText('Synthetic page',30,90)
      const stream = simulatedPlayback ? new MediaStream() : canvas.captureStream(10)
      if (simulatedPlayback) {
        const tracks = [] as any[]
        for (const kind of ['video', ...(constraints.audio ? ['audio'] : [])]) tracks.push({ kind, enabled: true, readyState: 'live', addEventListener() {}, stop() { if (this.readyState === 'live') { state.stops++; this.readyState = 'ended' } } })
        Object.defineProperties(stream, {
          getTracks: { value: () => [...tracks] }, getVideoTracks: { value: () => tracks.filter(t => t.kind === 'video') }, getAudioTracks: { value: () => tracks.filter(t => t.kind === 'audio') },
          addTrack: { value: (track: any) => tracks.push(track) }, removeTrack: { value: (track: any) => tracks.splice(tracks.indexOf(track), 1) },
        })
        ;(window as any).__deviceStream = stream
      }
      // Headless WebKit cannot play a canvas-backed capture stream on this host.
      // Keep device lifecycle real, but model decoded frames for its UI contract test.
      if (simulatedPlayback) {
        Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', { configurable: true, get() { return this._syntheticStream }, set(value) { this._syntheticStream = value } })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 320 })
        Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 240 })
        HTMLVideoElement.prototype.play = async () => {}
        const draw = CanvasRenderingContext2D.prototype.drawImage
        CanvasRenderingContext2D.prototype.drawImage = function(source: any, ...args: any[]) { return (draw as any).call(this, source instanceof HTMLVideoElement ? canvas : source, ...args) }
      }
      const frames = simulatedPlayback ? undefined : setInterval(() => { context.fillStyle = '#e2eee8'; context.fillRect(0,0,320,240); context.fillStyle = '#174c43'; context.fillText('Synthetic page',30,90) }, 100)
      if (!simulatedPlayback) for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { state.stops++; clearInterval(frames); stop() } }
      if (state.pending) await new Promise(resolve => { state.resolve = resolve })
      return stream
    } } })
    ;(window as any).__voice = []
    class Recognition {
      onstart: any; onresult: any; onerror: any; onend: any; aborted = false
      constructor() { (window as any).__voice.push(this) }
      start() { this.onstart?.() }
      abort() { this.aborted = true; this.onend?.() }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition, configurable: true })
    ;(window as any).__spoken = []
    Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u: any) => (window as any).__spoken.push(u.text), cancel: () => {} }, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(public text: string) {} }, configurable: true })
  }, simulatedPlayback)
}
