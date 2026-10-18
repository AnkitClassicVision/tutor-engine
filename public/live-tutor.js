(() => {
  const root = document.querySelector('[data-live-tutor]'); if (!root) return
  const get = name => root.querySelector(`[data-live-${name}]`)
  const check = get('check'), start = get('start'), end = get('end'), preview = get('preview'), video = get('video'), audio = get('audio'), status = get('status'), mute = get('mute'), camera = get('camera-off'), caption = get('caption'), level = get('level')
  let stream, peer, channel, controller, audioContext, interval, deadline, connectionDeadline, meterFrame, version = 0, checking = false, cameraPending = false
  let images = [], pendingImages = new Set()
  function stop(message = 'Camera and microphone are off.') {
    version++; clearInterval(interval); clearTimeout(deadline); clearTimeout(connectionDeadline); cancelAnimationFrame(meterFrame)
    controller?.abort(); controller = null
    channel?.close(); channel = null; peer?.close(); peer = null
    stream?.getTracks().forEach(t => t.stop()); stream = null
    video.srcObject = null; audio.pause(); audio.srcObject = null
    audioContext?.close().catch(() => {}); audioContext = null
    preview.hidden = true; end.disabled = true; check.disabled = false; start.disabled = root.dataset.available !== 'true'
    mute.textContent = 'Mute microphone'; mute.setAttribute('aria-pressed', 'false')
    camera.textContent = 'Turn camera off'; camera.setAttribute('aria-pressed', 'false'); camera.disabled = false
    level.value = 0; status.textContent = message; caption.textContent = ''; checking = false; cameraPending = false; images = []; pendingImages.clear()
  }
  function watchTrack(track, generation) { track.addEventListener('ended', () => { if (generation === version) stop('A device disconnected. Camera and microphone are off.') }) }
  function monitor(generation) {
    if (!stream.getAudioTracks().length) return
    audioContext = new AudioContext(); const analyser = audioContext.createAnalyser(); analyser.fftSize = 256
    audioContext.createMediaStreamSource(stream).connect(analyser)
    const values = new Uint8Array(analyser.fftSize)
    function update() { if (generation !== version) return; analyser.getByteTimeDomainData(values); level.value = Math.min(1, Math.sqrt(values.reduce((s,v) => s + ((v-128)/128)**2, 0) / values.length) * 4); meterFrame = requestAnimationFrame(update) }
    update()
  }
  function sendFrame() {
    if (!channel || channel.readyState !== 'open' || channel.bufferedAmount > 256000 || pendingImages.size >= 3 || camera.getAttribute('aria-pressed') === 'true' || !video.videoWidth || !stream?.getVideoTracks().some(t => t.readyState === 'live')) return
    const canvas = document.createElement('canvas'), scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    const id = `camera_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`; pendingImages.add(id)
    channel.send(JSON.stringify({ type: 'conversation.item.create', item: { id, type: 'message', role: 'user', content: [{ type: 'input_image', image_url: canvas.toDataURL('image/jpeg', .7) }] } }))
  }
  async function begin(deviceOnly) {
    stop(); checking = deviceOnly
    if (!navigator.mediaDevices?.getUserMedia || (!deviceOnly && !window.RTCPeerConnection)) { status.textContent = 'Live devices are unavailable in this browser. You can still type and save photos in Schoolwork.'; return }
    const generation = version
    check.disabled = true; start.disabled = true; end.disabled = false; end.textContent = deviceOnly ? 'Stop device check' : 'End conversation'
    status.textContent = 'Allow camera and microphone access. You can cancel with the stop button.'
    deadline = setTimeout(() => stop('Device access timed out. Check browser permissions and try again.'), 30000)
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } })
      if (generation !== version || document.hidden) { next.getTracks().forEach(t => t.stop()); return }
      stream = next; preview.hidden = false; video.srcObject = stream; video.scrollIntoView({ block: 'nearest' }); await video.play()
      if (generation !== version) return
      stream.getTracks().forEach(t => watchTrack(t, generation))
      monitor(generation); clearTimeout(deadline); deadline = setTimeout(() => stop('Five minutes finished. Camera and microphone are off.'), 300000)
      if (deviceOnly) { status.textContent = 'Device check: camera and microphone are on. Nothing is sent to an AI tutor.'; return }
      status.textContent = 'Connecting to your AI tutor…'; controller = new AbortController()
      connectionDeadline = setTimeout(() => stop('The live connection timed out. Camera and microphone are off.'), 30000)
      const connection = peer = new RTCPeerConnection()
      connection.ontrack = e => { if (generation !== version) return; audio.srcObject = e.streams[0] || new MediaStream([e.track]); audio.play().catch(() => { if (generation === version) stop('Audio playback was blocked. Start again and allow audio playback.') }) }
      connection.onconnectionstatechange = () => { if (generation === version && ['failed','disconnected','closed'].includes(connection.connectionState)) stop('The live connection ended. Camera and microphone are off.') }
      stream.getAudioTracks().forEach(t => connection.addTrack(t, stream))
      const events = channel = connection.createDataChannel('oai-events')
      events.onopen = () => { if (generation !== version) return; clearTimeout(connectionDeadline); status.textContent = 'Live tutor is connected. Camera images and your voice are shared with OpenAI.'; sendFrame(); interval = setInterval(() => { try { sendFrame() } catch { stop('Camera sharing stopped. Start the conversation again.') } }, 3000); events.send(JSON.stringify({ type: 'response.create' })) }
      events.onclose = () => { if (generation === version) stop('The live connection ended. Camera and microphone are off.') }
      events.onmessage = e => {
        if (generation !== version) return
        let event; try { event = JSON.parse(e.data) } catch { return }
        if (event.type === 'error') { stop('The AI tutor reported a connection problem. A parent can check the AI connection.'); return }
        if (['conversation.item.created','conversation.item.added'].includes(event.type) && pendingImages.delete(event.item?.id)) { images.push(event.item.id); if (images.length > 3) events.send(JSON.stringify({ type: 'conversation.item.delete', item_id: images.shift() })) }
        if (event.type === 'response.output_audio_transcript.done') caption.textContent = String(event.transcript || '').slice(0, 2000)
      }
      const offer = await connection.createOffer(); await connection.setLocalDescription(offer)
      if (generation !== version) return
      const response = await fetch(root.dataset.connectUrl, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csrf: document.querySelector('#csrf-store').value, sdp: offer.sdp }) })
      if (generation !== version) return
      if (!response.ok) throw new Error('connection')
      const result = await response.json(); if (generation !== version) return
      await connection.setRemoteDescription({ type: 'answer', sdp: result.sdp })
    } catch (error) { if (generation === version) stop(error.name === 'NotAllowedError' ? 'Camera or microphone permission was denied. Check browser settings and try again.' : 'Could not start. Check devices and the AI connection, then try again. Your saved work is still here.') }
  }
  check.addEventListener('click', () => begin(true))
  start.addEventListener('click', () => { if (root.dataset.available === 'true') begin(false) })
  end.addEventListener('click', () => stop())
  mute.addEventListener('click', () => { if (!stream) return; const muted = mute.getAttribute('aria-pressed') !== 'true'; stream.getAudioTracks().forEach(t => { t.enabled = !muted }); mute.setAttribute('aria-pressed', String(muted)); mute.textContent = muted ? 'Unmute microphone' : 'Mute microphone'; status.textContent = muted ? 'Microphone muted.' : checking ? 'Device check microphone is on. Nothing is sent to an AI tutor.' : 'Microphone is on and shared with your AI tutor.' })
  camera.addEventListener('click', async () => {
    if (!stream || cameraPending) return
    if (camera.getAttribute('aria-pressed') !== 'true') { stream.getVideoTracks().forEach(t => { t.stop(); stream.removeTrack(t) }); camera.setAttribute('aria-pressed', 'true'); camera.textContent = 'Turn camera on'; status.textContent = 'Camera is off. Voice can continue.'; return }
    const generation = version; cameraPending = true; camera.disabled = true
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (generation !== version || document.hidden) { next.getTracks().forEach(t => t.stop()); return }
      next.getVideoTracks().forEach(t => { stream.addTrack(t); watchTrack(t, generation) }); video.srcObject = stream; await video.play()
      if (generation !== version) return
      camera.setAttribute('aria-pressed', 'false'); camera.textContent = 'Turn camera off'; status.textContent = checking ? 'Device check camera is on. Nothing is sent to an AI tutor.' : 'Camera is on and shared with your AI tutor.'
    } catch { if (generation === version) status.textContent = 'Could not turn the camera on. Voice can continue.' }
    finally { if (generation === version) { cameraPending = false; camera.disabled = false } }
  })
  addEventListener('pagehide', () => stop())
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop('Conversation stopped while this page was hidden. Camera and microphone are off.') })
})()
