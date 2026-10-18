// Focused enhancements. Durable records and time limits remain on the server.
// Bring the selected topic into the map's own viewport without moving page focus.
const strengthMap = document.querySelector('[data-strength-map]')
const selectedStrength = strengthMap?.querySelector('[data-strength-node][aria-current]')
if (strengthMap && selectedStrength) {
  strengthMap.scrollLeft = Math.max(0, selectedStrength.offsetLeft - (strengthMap.clientWidth - selectedStrength.offsetWidth) / 2)
  strengthMap.scrollTop = Math.max(0, selectedStrength.offsetTop - 24)
}
const csrfValue = () => document.querySelector('#csrf-store')?.value || document.querySelector('[name=csrf]')?.value || ''
// A chosen option is saved as the draft too; radios keep their own values.
for (const radio of document.querySelectorAll('form.answer input[type=radio][name=answer]')) radio.addEventListener('change', () => {
  if (!radio.checked) return
  const form = radio.form
  fetch(form.action.replace(/\/answer$/, '/draft'), { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf: csrfValue(), itemId: form.querySelector('[name=itemId]').value, answer: radio.value }) }).catch(() => {})
})
const drafts = document.querySelectorAll('form.answer input[name=answer]:not([type=radio]), form[action$="/help"] textarea[name=message]')
for (const field of drafts) {
  const key = `draft:${location.pathname}:${field.form?.querySelector('[name=itemId]')?.value || ''}`
  const saved = sessionStorage.getItem(key)
  // A server-rendered matching answer confirms autosave. Submission alone
  // does not: a failed navigation must leave the browser's draft intact.
  if (saved !== null && saved === field.value) sessionStorage.removeItem(key)
  else if (saved !== null) field.value = saved
  let saving
  async function saveDraft() {
    if (!field.form?.classList.contains('answer')) return
    const url = field.form.action.replace(/\/answer$/, '/draft')
    try { await fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf: csrfValue(), itemId: field.form.querySelector('[name=itemId]').value, answer: field.value }) }) } catch { /* The browser draft remains available until reconnection. */ }
  }
  field.addEventListener('input', () => { sessionStorage.setItem(key, field.value); clearTimeout(saving); saving = setTimeout(saveDraft, 350) })
  field.addEventListener('blur', saveDraft)
  addEventListener('pagehide', saveDraft)
  if (!field.form?.classList.contains('answer')) field.form?.addEventListener('submit', () => sessionStorage.removeItem(key))
}
// Acknowledge in the same event frame, while preserving the clicked button's value.
document.querySelectorAll('form:not([data-fetch])').forEach(form => form.addEventListener('submit', () => {
  if (form.dataset.submitting) return
  form.dataset.submitting = 'true'
  form.setAttribute('aria-busy', 'true')
  let status = form.querySelector('[data-submit-status]')
  if (!status) { status = document.createElement('p'); status.dataset.submitStatus = ''; status.setAttribute('role', 'status'); form.append(status) }
  status.textContent = 'Saving your next step…'
  setTimeout(() => { delete form.dataset.submitting; form.removeAttribute('aria-busy'); status.textContent = '' }, 15000)
}))
const clock = document.querySelector('[data-session-deadline]')
if (clock) {
  const update = () => {
    const left = Math.max(0, Math.ceil((Date.parse(clock.dataset.sessionDeadline) - Date.now()) / 1000))
    clock.textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left · your work is saved as you go` : 'Time to stop. Your work is saved.'
    if (!left) { clearInterval(timer); location.reload() }
  }
  const timer = setInterval(update, 1000)
  // An ended mission has no answer form and should not reload repeatedly.
  if (!document.querySelector('form.answer')) clearInterval(timer)
  else update()
  addEventListener('pagehide', () => clearInterval(timer), { once: true })
}
const job = document.querySelector('[data-job]')
if (job) {
  const id = job.dataset.job, stage = job.querySelector('[data-job-stage]'), error = job.querySelector('[data-job-error]'), connection = job.querySelector('[data-job-connection]')
  let finished = false, started = Date.parse(job.dataset.created)
  function render(status, terminal) {
    if (stage.textContent !== status.stage) stage.textContent = status.stage; error.textContent = status.error || ''; job.dataset.jobState = status.status
    started = Date.parse(status.startedAt || status.createdAt)
    job.querySelector('form[action$="/cancel"]').hidden = terminal
    job.querySelector('form[action$="/retry"]').hidden = !['failed', 'cancelled'].includes(status.status)
    const destination = job.querySelector('[data-job-destination]')
    destination.replaceChildren()
    if (terminal) {
      finished = true
      // An untouched review card leaves with the wait; a half-typed answer is never taken away.
      const reviewForm = job.querySelector('[data-review-form]')
      if (reviewForm && !reviewForm.querySelector('[name=answer]').value.trim()) reviewForm.closest('.waiting-review').hidden = true
      let url = status.result?.location ? status.result.location : status.result?.file ? `/jobs/${id}/file` : status.result?.nextJobId ? `/jobs/${status.result.nextJobId}` : status.result?.materialId ? `/materials/${status.result.materialId}` : status.result?.questionId ? `/questions/${status.result.questionId}/help` : status.result?.sessionId ? `/session/${status.result.sessionId}${status.result.voice ? "?voice=1" : ""}` : status.result?.studentId ? `/students/${status.result.studentId}` : null
      if (!url && job.dataset.planner && status.result?.subject) url = `/students/${job.dataset.planner}/classes?talk=${encodeURIComponent(status.result.subject)}#learning-plan`
      if (!url) url = job.dataset.return
      if (url) { const a = document.createElement('a'); a.href = url; a.className = 'button'; a.textContent = status.status === 'succeeded' ? 'See your next step →' : 'Return to saved work →'; destination.append(a) }
    }
  }
  const watcher = window.watchJob(id, { onStatus: render, onConnection: text => { connection.textContent = text } })
  const elapsed = setInterval(() => {
    if (!finished) job.querySelector('[data-job-elapsed]').textContent = `${Math.max(0, Math.floor((Date.now() - started) / 1000))} seconds`
  }, 1000)
  addEventListener('pagehide', () => { watcher.close(); clearInterval(elapsed) }, { once: true })
}
for (const camera of document.querySelectorAll('[data-camera]')) {
  const inputs = camera.querySelectorAll('[data-pages]'), container = camera.querySelector('[data-page-previews]'), status = camera.querySelector('[data-upload-status]'), progress = camera.querySelector('[data-upload-progress]')
  let pages = [], saving = false, preparing = 0
  const schoolResult = camera.hasAttribute('data-school-result')
  async function read(file) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Choose a JPEG or PNG photo.')
    if (file.size > 15000000) throw new Error('Choose a photo smaller than 15 MB.')
    const original = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
    const url = URL.createObjectURL(file)
    const img = new Image(); img.src = url
    await img.decode()
    // Normalize large camera captures for predictable private storage and upload size.
    const scale = Math.min(1, 1800 / Math.max(img.width, img.height)), canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    const normalized = canvas.toDataURL('image/jpeg', .86)
    URL.revokeObjectURL(url)
    return { name: file.name, mime: 'image/jpeg', base64: normalized.split(',')[1], originalBase64: original.split(',')[1], originalMime: file.type, preview: normalized }
  }
  const device = camera.querySelector('[data-device-camera]')
  if (device) {
    const open = device.querySelector('[data-open-camera]'), live = device.querySelector('[data-live-camera]'), video = device.querySelector('[data-camera-video]')
    const capture = device.querySelector('[data-capture-photo]'), switcher = device.querySelector('[data-switch-camera]'), close = device.querySelector('[data-close-camera]'), note = device.querySelector('[data-camera-status]')
    let stream, generation = 0, facing = 'environment', capturedPage = null
    function stop() {
      generation++
      stream?.getTracks().forEach(track => track.stop()); stream = null
      video.srcObject = null; live.hidden = true; open.disabled = false; capture.disabled = true; switcher.disabled = true
    }
    async function start(index = null) {
      stop(); capturedPage = index === null ? null : pages[index]
      if (!navigator.mediaDevices?.getUserMedia) { note.textContent = 'Camera preview is unavailable here. Use the phone camera or choose images below.'; return }
      const version = generation
      live.hidden = false; open.disabled = true
      note.textContent = 'Allow camera access in your browser. Close camera to cancel.'
      try {
        const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1800 } }, audio: false })
        if (version !== generation || document.hidden) { next.getTracks().forEach(track => track.stop()); return }
        stream = next; video.srcObject = stream
        // Mobile Safari pauses off-screen video; bring the new preview into view.
        video.scrollIntoView({ block: 'nearest' }); await video.play()
        if (version !== generation) return
        capture.disabled = false; switcher.disabled = false
        note.textContent = 'Camera is on. Place your page in the preview, then capture.'
      } catch (error) {
        if (version !== generation) return
        stop()
        note.textContent = error.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in your browser settings, or choose an image.' : 'Could not open the camera. Check that it is connected and not in use, or choose an image.'
      }
    }
    open.addEventListener('click', () => start())
    close.addEventListener('click', () => { stop(); note.textContent = 'Camera is off. Your selected photos are still here.' })
    switcher.addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; start(capturedPage ? pages.indexOf(capturedPage) : null) })
    capture.addEventListener('click', async () => {
      if (!stream || saving || preparing || !video.videoWidth) { note.textContent = 'Wait for the camera preview before capturing.'; return }
      if (capturedPage === null && pages.length >= 12) { note.textContent = 'You can add up to twelve pages. Remove one before taking another picture.'; return }
      preparing++; capture.disabled = true
      try {
        const canvas = document.createElement('canvas'), scale = Math.min(1, 1800 / Math.max(video.videoWidth, video.videoHeight))
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        const preview = canvas.toDataURL('image/jpeg', .86), base64 = preview.split(',')[1]
        const page = { name: 'Camera picture.jpg', mime: 'image/jpeg', base64, originalBase64: base64, originalMime: 'image/jpeg', preview }
        if (capturedPage === null) pages.push(page); else { const index = pages.indexOf(capturedPage); if (index < 0) throw new Error('The page was removed.'); pages[index] = page }
        capturedPage = null; render(); stop()
        note.textContent = 'Picture captured. Check the preview before saving.'
      } catch { note.textContent = 'Could not capture this picture. Try again or choose an image.'; capture.disabled = false }
      finally { preparing-- }
    })
    camera.addEventListener('submit', () => { stop(); note.textContent = '' })
    addEventListener('pagehide', stop)
    document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); note.textContent = 'Camera is off. Open it again when you are ready.' } })
    device.retake = index => start(index)
  }
  function render() {
    container.replaceChildren()
    pages.forEach((page, i) => {
      const article = document.createElement('article'); article.className = 'page-preview'
      const image = document.createElement('img'); image.src = page.preview; image.alt = `Preview of page ${i + 1}`
      const caption = document.createElement('p'); caption.textContent = `Page ${i + 1} · ${page.name}`
      const actions = document.createElement('div'); actions.className = 'links'
      function button(text, action, disabled = false) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = text; b.disabled = disabled; b.addEventListener('click', action); actions.append(b) }
      button('Move up', () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; render() }, i === 0)
      button('Move down', () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; render() }, i === pages.length - 1)
      button('Remove', () => { pages.splice(i, 1); render() })
      button('Retake', () => {
        if (device && navigator.mediaDevices?.getUserMedia) { device.retake(i); return }
        const replacement = document.createElement('input'); replacement.type = 'file'; replacement.accept = 'image/jpeg,image/png'; replacement.setAttribute('capture', 'environment')
        replacement.addEventListener('change', async () => { if (!replacement.files[0]) return; try { pages[i] = await read(replacement.files[0]); render() } catch (e) { status.textContent = e.message } }); replacement.click()
      })
      const crop = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Crop page'; crop.append(summary)
      const controls = []
      for (const labelText of ['Left', 'Top', 'Right', 'Bottom']) {
        const label = document.createElement('label'); label.textContent = `${labelText} edge (%)`
        const field = document.createElement('input'); field.type = 'number'; field.min = '0'; field.max = '45'; field.value = '0'; label.append(field); crop.append(label); controls.push(field)
      }
      const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply crop'; apply.className = 'ghost'
      apply.addEventListener('click', async () => {
        const source = new Image(); source.src = `data:${page.originalMime};base64,${page.originalBase64}`; await source.decode()
        const [left, top, right, bottom] = controls.map(c => Math.max(0, Math.min(45, Number(c.value))) / 100)
        const canvas = document.createElement('canvas'); canvas.width = Math.round(source.width * (1 - left - right)); canvas.height = Math.round(source.height * (1 - top - bottom))
        canvas.getContext('2d').drawImage(source, source.width * left, source.height * top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
        page.preview = canvas.toDataURL('image/jpeg', .86); page.base64 = page.preview.split(',')[1]; render()
      }); crop.append(apply)
      article.append(image, caption, actions, crop); container.append(article)
    })
  }
  inputs.forEach(input => input.addEventListener('change', async () => {
    preparing++
    status.textContent = 'Preparing your previews…'
    try {
      for (const file of input.files) { if (pages.length >= 12) throw new Error('You can add up to twelve pages.'); pages.push(await read(file)); render() }
      status.textContent = 'Pages ready. Check the order before saving.'
    } catch (e) { status.textContent = e.message }
    input.value = ''; preparing--
  }))
  camera.addEventListener('submit', async event => {
    event.preventDefault()
    if (saving) return
    if (preparing) { status.textContent = 'Wait for your photo preview before saving.'; return }
    const formData = new FormData(camera), transcription = String(formData.get('transcription') || '')
    if (!schoolResult && !pages.length && !transcription.trim()) { status.textContent = 'Add a photo or type your page first.'; return }
    let submission = { csrf: csrfValue(), requestId: formData.get('requestId'), title: formData.get('title'), subject: formData.get('subject'), kind: formData.get('kind'), workState: formData.get('workState'), prepareForTest: camera.dataset.testSource === '1', pages: pages.length ? pages.map(p => ({ mime: p.mime, base64: p.base64, ...(p.base64 !== p.originalBase64 ? { originalBase64: p.originalBase64, originalMime: p.originalMime } : {}), transcription })) : schoolResult ? [] : [{ transcription }] }
    if (schoolResult) submission = { ...submission, date: formData.get('date'), earned: formData.get('earned'), possible: formData.get('possible'), notes: formData.get('notes') }
    saving = true
    const controls = [...camera.querySelectorAll('input, textarea, select, button')].filter(control => !control.disabled)
    controls.forEach(control => { control.disabled = true })
    const finish = () => { saving = false; controls.forEach(control => { control.disabled = false }); delete camera.dataset.submitting; camera.removeAttribute('aria-busy'); const generic = camera.querySelector('[data-submit-status]'); if (generic) generic.textContent = ''; progress.hidden = true }
    status.textContent = 'Saving your pages…'; progress.hidden = false
    if (camera.dataset.cloudUploads === '1' && pages.length) {
      try {
        const { put } = await import('/blob-client.js')
        const studentPath = new URL(camera.action).pathname.replace(/\/(materials|school-results)$/, '')
        async function sendPhoto(base64, mime) {
          const response = await fetch(`${studentPath}/upload-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf: csrfValue(), mime }) })
          if (!response.ok) throw new Error('Could not prepare a private upload. Your previews are saved here.')
          const ticket = await response.json()
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
          // Fetch uploads work across Safari, Firefox and Chromium. The SDK's
          // XHR progress transport is unreliable for Safari cross-origin PUTs.
          progress.removeAttribute('value')
          await put(ticket.pathname, new Blob([bytes], { type: mime }), { access: 'private', token: ticket.token, contentType: mime, abortSignal: AbortSignal.timeout(120000) })
          progress.value = 100
          const completed = await fetch(`${studentPath}/upload-complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf: csrfValue(), id: ticket.id }) })
          if (!completed.ok) throw new Error('Could not confirm your private photo. Your previews are still here.')
          return (await completed.json()).id
        }
        const saved = []
        for (const [index, p] of pages.entries()) {
          status.textContent = `Saving page ${index + 1} of ${pages.length}…`
          if (!p.uploadId || p.savedBase64 !== p.base64) { p.uploadId = await sendPhoto(p.base64, p.mime); p.savedBase64 = p.base64 }
          if (!p.originalUploadId) p.originalUploadId = p.base64 === p.originalBase64 ? p.uploadId : await sendPhoto(p.originalBase64, p.originalMime)
          saved.push({ uploadId: p.uploadId, originalUploadId: p.originalUploadId, transcription })
        }
        submission.pages = saved
        status.textContent = 'Finishing your saved pages…'
      } catch (e) { finish(); status.textContent = e.message || 'Connection paused. Your previews are still here.'; return }
    }
    const xhr = new XMLHttpRequest(); xhr.open('POST', camera.action); xhr.setRequestHeader('Content-Type', 'application/json'); xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = event => { if (event.lengthComputable) { progress.value = 100 * event.loaded / event.total; status.textContent = `Uploaded ${Math.round(progress.value)}% of your pages` } }
    xhr.onload = () => {
      let result; try { result = JSON.parse(xhr.responseText) } catch { result = {} }
      if (xhr.status === 201 && result.location) location.assign(result.location)
      else { finish(); status.textContent = result.error || (xhr.status === 403 ? 'Unlock the parent area or reload this form before saving.' : 'Could not save. Your previews are still here. Try again.') }
    }
    xhr.onerror = () => { finish(); status.textContent = 'Connection paused. Your previews are still here. Try saving again.' }
    const payload = JSON.stringify(submission)
    if (payload.length > 60000000) { finish(); status.textContent = 'This batch is too large. Save fewer pages at a time.'; return }
    xhr.send(payload)
  })
}
document.querySelectorAll('[data-source-correction]').forEach(form => form.addEventListener('submit', async event => {
  event.preventDefault()
  const pages = [...form.querySelectorAll('[data-page-id]')].map(p => ({ id: p.dataset.pageId, transcription: p.value }))
  try {
    const response = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csrf: csrfValue(), pages }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    location.assign(result.location)
  } catch (e) { form.querySelector('[data-submit-status]').textContent = e.message || 'Could not save. Please try again.' }
}))

// The test date is required only when a parent chooses upcoming-test preparation.
document.querySelectorAll('[data-learning-source]').forEach(form => {
  const purpose = form.querySelector('[name="purpose"]'), fields = form.querySelector('[data-test-details]')
  const update = () => {
    const isTest = purpose.value === 'test'
    fields.hidden = !isTest
    fields.querySelectorAll('input').forEach(input => { input.required = isTest })
  }
  purpose.addEventListener('change', update)
  update()
})
// A link to something inside a closed section (#school-results, #student-access) opens that section first.
// Old anchors into the parent page (emails, bookmarks, job links) now live on their own pages.
const movedSections = { 'learning-plan': 'classes', practice: 'classes', 'school-results': 'school', controls: 'controls', 'student-access': 'controls', 'child-requests': 'controls', 'student-settings': 'controls', note: 'note' }
const parentOverview = location.pathname.match(/^\/students\/([0-9a-f-]{36})\/parent$/i)
function moveOldAnchor() {
  const moved = movedSections[location.hash.slice(1)]
  if (parentOverview && moved) location.replace(`/students/${parentOverview[1]}/${moved}${location.search}${location.hash}`)
}
moveOldAnchor()
addEventListener('hashchange', moveOldAnchor)
function openTarget() {
  const id = decodeURIComponent(location.hash.slice(1))
  const target = id && document.getElementById(id)
  if (!target) return
  let node = target.parentElement, opened = false
  while (node) { if (node.tagName === 'DETAILS' && !node.open) { node.open = true; opened = true } node = node.parentElement }
  if (opened) target.scrollIntoView({ block: 'start' })
}
openTarget()
addEventListener('hashchange', openTarget)
