// Speak the words only: drawn dots and shapes are for counting by eye, not to be read out one by one.
function speakable(text) { return String(text || '').replace(/[\u2022\u25A0-\u25FF\u2600-\u27BF]/g, ' ').replace(/\s+/g, ' ').trim() }
const answer = document.querySelector("form.answer")
if (answer) {
  const started = Number(answer.dataset.started || Date.now())
  answer.addEventListener("submit", () => {
    const field = answer.querySelector('input[name="timeMs"]')
    if (field) field.value = String(Date.now() - started)
  })
}

document.querySelectorAll("form[data-file-upload]").forEach((plan) => {
  plan.addEventListener("submit", (event) => {
    const fileInput = plan.querySelector('input[type="file"]')
    const file = fileInput && fileInput.files && fileInput.files[0]
    if (!file) return
    event.preventDefault()
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || "")
      const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      const textField = plan.querySelector('textarea[name="syllabusText"]')
      const encoded = plan.querySelector('input[name="syllabusBase64"]')
      const mime = plan.querySelector('input[name="syllabusMime"]')
      const name = plan.querySelector('input[name="syllabusName"]')
      if (pdf) {
        if (encoded) encoded.value = raw.split(",")[1] || ""
        if (mime) mime.value = "application/pdf"
      } else if (textField) {
        textField.value = raw
      }
      if (name) name.value = file.name
      plan.submit()
    }
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) reader.readAsDataURL(file)
    else reader.readAsText(file)
  })
})

const Talk = window.SpeechRecognition || window.webkitSpeechRecognition
let activeVoice, readingButton, readingUtterance
function voiceIdle(current) {
  clearTimeout(current.timer)
  current.button.textContent = 'Use microphone'; current.button.setAttribute('aria-pressed', 'false'); current.button.classList.remove('listening')
  if (current.wave) current.wave.hidden = true
}
function stopVoice() {
  const current = activeVoice; activeVoice = null
  if (!current) return
  current.commit()
  try { current.heard.abort() } catch { /* Recognition may already have ended. */ }
  voiceIdle(current)
}
function bindMedia(root) {
root.querySelectorAll('[data-talk]').forEach(button => {
  if (button.dataset.bound) return; button.dataset.bound = '1'
  const form = button.closest('form'), field = form?.querySelector('textarea[name="message"], input[name="answer"], textarea[name="answer"]')
  const status = form?.querySelector('[data-voice-status]'), wave = form?.querySelector('[data-voice-wave]')
  if (!field || !status) return
  button.setAttribute('aria-pressed', 'false')
  if (!Talk) { button.disabled = true; status.textContent = 'Voice typing is unavailable in this browser. Type your message, or try Chrome, Edge or Safari.'; return }
  button.addEventListener('click', () => {
    if (activeVoice?.button === button) {
      const words = Boolean(field.value.trim()); stopVoice()
      status.textContent = words ? 'Microphone is off. Check your words before sending.' : 'Microphone is off. Try again or type your message.'
      return
    }
    stopVoice()
    // Words stream into the field as they are recognised: earlier text, finished phrases, then the phrase still being heard.
    const current = { heard: null, button, wave, timer: null, base: field.value.trim(), kept: '', final: '', interim: '', heardAnything: false, failed: false, restarts: 0, until: Date.now() + 60000, commit() {} }
    activeVoice = current
    const render = () => {
      field.value = [current.base, current.kept, current.final, current.interim].filter(Boolean).join(' ')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    current.commit = () => {
      current.kept = [current.kept, current.final, current.interim].filter(Boolean).join(' '); current.final = ''; current.interim = ''
      render(); field.dispatchEvent(new Event('blur'))
    }
    const listen = () => {
      const heard = current.heard = new Talk()
      heard.lang = document.documentElement.lang || 'en-US'; heard.interimResults = true; heard.continuous = true
      heard.onstart = () => { if (activeVoice === current && !current.heardAnything) status.textContent = 'Listening… your words appear here as you speak. Tap Stop microphone when you finish.' }
      heard.onresult = event => {
        if (activeVoice !== current || current.heard !== heard) return
        const finals = [], partial = []
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i], text = String(result?.[0]?.transcript ?? '').trim()
          if (!text) continue
          if (result.isFinal !== false) finals.push(text); else partial.push(text)
        }
        if (!finals.length && !partial.length) return
        current.final = finals.join(' '); current.interim = partial.join(' '); current.heardAnything = true
        render()
        const voice = form.querySelector('[name="voice"]'); if (voice) voice.value = '1'
        if (form.classList.contains('answer') && !current.noted) { current.noted = true; noteAccess('voice_entry') }
        status.textContent = partial.length ? 'Listening… keep going. Tap Stop microphone when you finish.' : 'Got it. Keep talking, or tap Stop microphone and check your words.'
      }
      heard.onerror = event => {
        if (activeVoice !== current || current.heard !== heard) return
        const kind = event.error
        if (kind === 'no-speech') { status.textContent = current.heardAnything ? 'Listening… tap Stop microphone when you finish.' : 'Listening… nothing heard yet. Speak a little louder, closer to the microphone.'; return }
        if (kind === 'aborted') return
        current.failed = true
        status.textContent = ['not-allowed', 'service-not-allowed'].includes(kind) ? 'Microphone or speech access was denied. Allow it in browser settings, or type instead.'
          : kind === 'audio-capture' ? 'No working microphone was found. Check the microphone, or type instead.'
          : kind === 'network' ? 'Voice typing could not reach the speech service. Check the internet connection or try Chrome, or type instead.'
          : 'Voice typing could not finish. Your words are still here. Try again or type instead.'
        stopVoice()
      }
      heard.onend = () => {
        if (activeVoice !== current || current.heard !== heard) return
        current.commit()
        // Browsers end a listening session after a pause; keep listening until Stop or the time limit.
        if (!current.failed && Date.now() < current.until && current.restarts < 12) {
          current.restarts++
          try { listen(); return } catch { /* fall through to stop */ }
        }
        activeVoice = null; voiceIdle(current)
        status.textContent = field.value.trim() ? 'Microphone is off. Check your words before sending.' : 'Microphone is off. No words were heard. Try again or type your message.'
      }
      heard.start()
    }
    button.textContent = 'Stop microphone'; button.setAttribute('aria-pressed', 'true'); button.classList.add('listening')
    if (wave) wave.hidden = false
    status.textContent = 'Allow microphone access in your browser, then speak. Tap Stop microphone when you finish.'
    try {
      listen()
      current.timer = setTimeout(() => {
        if (activeVoice !== current) return
        stopVoice()
        status.textContent = field.value.trim() ? 'One minute is up. Microphone is off. Check your words before sending.' : 'One minute is up and no words were heard. Check the microphone, or type instead.'
      }, 60000)
    } catch { stopVoice(); status.textContent = 'Could not start voice typing. Try again or type instead.' }
  })
  form.addEventListener('submit', stopVoice)
})
root.querySelectorAll('[data-hear]').forEach(button => {
  if (button.dataset.bound) return; button.dataset.bound = '1'
  button.setAttribute('aria-pressed', 'false')
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { button.disabled = true; button.title = 'Read aloud is unavailable in this browser.'; return }
  const label = button.textContent
  let utterance
  function reset() { if (readingUtterance !== utterance) return; button.textContent = label; button.setAttribute('aria-pressed', 'false'); if (readingButton === button) readingButton = null }
  button.addEventListener('click', () => {
    const wasReading = readingButton === button
    if (readingButton) { readingButton.textContent = readingButton.dataset.readLabel; readingButton.setAttribute('aria-pressed', 'false') }
    window.speechSynthesis.cancel(); readingButton = null; readingUtterance = null
    if (wasReading) return
    // A button can name the field it reads (data-hear-for), so it reads what is in the box right now.
    const field = button.dataset.hearFor ? document.getElementById(button.dataset.hearFor) : null
    const text = field || button.parentElement?.querySelector('.question-text') || button.parentElement?.querySelector('p')
    if (!text) return
    // An empty box reads its label instead, so the child hears what to do.
    const words = field ? (field.value.trim() || document.querySelector(`label[for="${field.id}"]`)?.textContent || '') : text.textContent
    if (!String(words).trim()) return
    utterance = new SpeechSynthesisUtterance(speakable(words)); readingUtterance = utterance
    button.dataset.readLabel = label; button.textContent = 'Stop reading'; button.setAttribute('aria-pressed', 'true'); readingButton = button
    const current = utterance; utterance.onend = () => { if (readingUtterance === current) reset() }; utterance.onerror = utterance.onend
    window.speechSynthesis.speak(utterance)
  })
})
}
bindMedia(document)
document.addEventListener('tutor:content', event => bindMedia(event.detail instanceof Element ? event.detail : document))
addEventListener('pagehide', () => { stopVoice(); window.speechSynthesis?.cancel() })
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopVoice(); window.speechSynthesis?.cancel() } })
// Note when a question or its feedback is actually on screen, once the tab is visible.
function noteSeen() {
  const form = document.querySelector('form.answer'), base = (form?.action || document.querySelector('form[action*="/session/"]')?.action || '').match(/\/session\/[0-9a-f-]{36}/i)?.[0]
  if (!base) return
  const csrf = document.querySelector('#csrf-store')?.value || document.querySelector('[name=csrf]')?.value || ''
  const send = (itemId, what) => itemId && fetch(`${base}/seen`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf, itemId, what }) }).catch(() => {})
  send(form?.querySelector('[name=itemId]')?.value, 'question')
  document.querySelectorAll('.feedback-review article[data-item]').forEach(card => send(card.dataset.item, 'feedback'))
}
if (document.visibilityState === 'visible') requestAnimationFrame(noteSeen)
else document.addEventListener('visibilitychange', function seenOnce() { if (document.visibilityState !== 'visible') return; document.removeEventListener('visibilitychange', seenOnce); requestAnimationFrame(noteSeen) })
// Access support is noted on the current question, apart from hints and help; it does not change scoring.
function noteAccess(kind) {
  const form = document.querySelector('form.answer'), itemId = form?.querySelector('[name=itemId]')?.value
  if (!form || !itemId) return
  const csrf = document.querySelector('#csrf-store')?.value || document.querySelector('[name=csrf]')?.value || ''
  fetch(form.action.replace(/\/answer$/, '/access'), { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csrf, itemId, kind }) }).catch(() => {})
}
document.querySelectorAll('[data-format-help]').forEach(details => details.addEventListener('toggle', () => { if (details.open) noteAccess('format_help') }))
document.querySelectorAll('.prompt [data-hear]').forEach(button => button.addEventListener('click', () => { if (button.getAttribute('aria-pressed') === 'true') noteAccess('read_aloud') }))
// Ages 5–7: read each question on arrival where the browser allows it, unless this child turned it off.
// The choice belongs to the learner on this device, so a sibling on the same device keeps their own. Reading
// is separate from motion: a child who needs less animation can still need questions read aloud.
const autoread = document.querySelector('[data-autoread]'), autoreadToggle = document.querySelector('[data-autoread-toggle]')
const autoreadKey = `tutor-autoread:${document.querySelector('[data-learner]')?.dataset.learner || 'device'}`
const autoreadOn = () => { try { return localStorage.getItem(autoreadKey) !== 'off' } catch { return true } }
if (autoreadToggle) {
  autoreadToggle.checked = autoreadOn()
  autoreadToggle.addEventListener('change', () => {
    try { localStorage.setItem(autoreadKey, autoreadToggle.checked ? 'on' : 'off') } catch {}
    if (!autoreadToggle.checked) window.speechSynthesis?.cancel()
  })
}
if (autoread && autoreadOn() && window.speechSynthesis && window.SpeechSynthesisUtterance) {
  const question = autoread.querySelector('.question-text'), hear = autoread.querySelector('[data-hear]')
  const say = new SpeechSynthesisUtterance(speakable(question?.textContent))
  // Browsers that block speech before a tap get a clear button instead.
  say.onerror = event => { if (event.error === 'not-allowed' && hear) { hear.classList.add('tap-to-hear'); hear.textContent = 'Tap to hear it' } }
  say.onstart = () => noteAccess('read_aloud')
  window.speechSynthesis.speak(say)
}
const spoken = document.querySelector("[data-say]")
if (spoken && new URLSearchParams(location.search).get("voice") === "1" && window.speechSynthesis) {
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(spoken.textContent || ""))
}

document.querySelectorAll("form.talk:not([data-fetch]), form.build:not([data-fetch])").forEach((form) => {
  form.addEventListener("submit", () => {
    const button = form.querySelector("button[type='submit']")
    if (button) button.disabled = true
    const note = document.createElement("p")
    note.className = "working"
    note.innerHTML = form.classList.contains("build")
      ? "<i></i> Building the curriculum."
      : "<i></i> Thinking."
    form.before(note)
  })
})

const live = document.querySelector("[data-live]")
try {
  const keptTab = sessionStorage.getItem("tutor-keep-tab")
  if (keptTab) {
    sessionStorage.removeItem("tutor-keep-tab")
    const tab = document.getElementById(keptTab)
    if (tab) tab.checked = true
  }
} catch { /* Tab storage is optional; the answer controls still work. */ }
if (live) {
  const stamp = live.getAttribute("data-live")
  const progressUrl = live.getAttribute("data-progress-url") || `${location.pathname}/progress${location.search}`
  const timer = setInterval(async () => {
    try {
      const response = await fetch(progressUrl, { headers: { Accept: "application/json" } })
      if (!response.ok) return
      const body = await response.json()
      if (body.stamp === stamp) return
      const current = document.querySelector('input[name="student-tab"]:checked')
      try { if (current) sessionStorage.setItem("tutor-keep-tab", current.id) } catch {}
      location.reload()
    } catch {
      /* keep the current page */
    }
  }, 2000)
  window.addEventListener("pagehide", () => clearInterval(timer))
}

const upload = document.querySelector("#upload-form")
if (upload) {
  const fileInput = upload.querySelector('#photo'), preview = upload.querySelector('[data-paper-photo-preview]'), status = upload.querySelector('[data-paper-photo-status]')
  const mime = upload.querySelector('[name=mime]'), encoded = upload.querySelector('[name=base64]'), button = upload.querySelector('button[type=submit]')
  let reading = false, saving = false, revision = 0
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0], current = ++revision
    preview.replaceChildren(); mime.value = ''; encoded.value = ''; reading = false
    if (!file) { status.textContent = 'No photo selected.'; return }
    reading = true; status.textContent = 'Preparing the photo preview…'
    const reader = new FileReader()
    reader.onload = () => {
      if (current !== revision) return
      const raw = String(reader.result || '')
      mime.value = file.type; encoded.value = raw.split(',')[1] || ''; reading = false
      const image = document.createElement('img'); image.src = raw; image.alt = 'Selected paper photo, not saved yet'; image.style.maxWidth = '100%'; preview.append(image)
      status.textContent = 'Photo selected in this page only. Keep this page open until saving is confirmed.'
    }
    reader.onerror = () => { if (current === revision) { reading = false; status.textContent = 'Could not read this photo. Choose it again or retake it.' } }
    reader.readAsDataURL(file)
  })
  upload.addEventListener('submit', async event => {
    event.preventDefault()
    if (saving) return
    if (reading || !encoded.value) { status.textContent = 'Wait for the photo preview before saving.'; return }
    saving = true; button.disabled = true; fileInput.disabled = true
    status.textContent = 'Uploading the photo. Saving is not confirmed yet.'
    try {
      const response = await fetch(upload.action, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ csrf: upload.querySelector('[name=csrf]').value, mime: mime.value, base64: encoded.value }), signal: AbortSignal.timeout(120000) })
      const receipt = await response.json()
      if (!response.ok || receipt.saved !== true || receipt.location !== location.pathname) throw new Error(receipt.error || 'Saving is not confirmed. Your photo is still in this page; try again when connected.')
      status.textContent = 'Photo saved in your private family account.'; location.assign(receipt.location)
    } catch (error) {
      status.textContent = ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name) ? 'Connection paused. Keep this page open and try saving again; saving is not confirmed.' : error.message || 'Saving is not confirmed. Keep this page open and try again.'
    } finally { saving = false; button.disabled = false; fileInput.disabled = false }
  })
  addEventListener('pagehide', () => {
    revision++; preview.replaceChildren(); fileInput.value = ''; mime.value = ''; encoded.value = ''
  })
}
const paperScore = document.querySelector('[data-paper-score]'), paperSheet = document.body.dataset.paperSheet
if (paperSheet) {
  const key = 'draft:paper:' + paperSheet
  if (!paperScore) { try { sessionStorage.removeItem(key) } catch { /* Storage can be unavailable. */ } }
  else {
    const fields = [...paperScore.querySelectorAll('textarea[name^="box-"], select[name=paperHelp]')]
    const draftStatus = paperScore.querySelector('[data-paper-draft-status]'), status = paperScore.querySelector('[data-paper-submit-status]')
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
      if (saved) { for (const field of fields) if (typeof saved[field.name] === 'string') field.value = saved[field.name]; draftStatus.textContent = 'Restored from this tab. Not submitted yet.' }
    } catch { /* Retain editable fields without requiring tab storage. */ }
    function keepDraft() {
      try { sessionStorage.setItem(key, JSON.stringify(Object.fromEntries(fields.map(field => [field.name, field.value])))); draftStatus.textContent = 'Kept in this tab. Not submitted yet.' }
      catch { draftStatus.textContent = 'Not submitted. Keep this page open until submission is confirmed.' }
    }
    fields.forEach(field => field.addEventListener('input', keepDraft))
    let submitting = false
    paperScore.addEventListener('submit', async event => {
      event.preventDefault()
      if (submitting) return
      keepDraft(); submitting = true
      const data = Object.fromEntries(new FormData(paperScore)), button = paperScore.querySelector('button[type=submit]')
      button.disabled = true; status.textContent = 'Submitting your paper answers…'
      try {
        const response = await fetch(paperScore.action, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) })
        const receipt = await response.json()
        if (!response.ok || receipt.submitted !== true || receipt.location !== location.pathname) throw new Error(receipt.error || 'Submission is not confirmed. Keep these entries and try again.')
        try { sessionStorage.removeItem(key) } catch { /* A later submitted page also clears the draft. */ }
        status.textContent = 'Paper answers submitted.'; location.assign(receipt.location)
      } catch (error) { status.textContent = ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name) ? 'Connection paused. Your entries are still here. Try submitting again.' : error.message || 'Submission is not confirmed. Try again.' }
      finally { submitting = false; button.disabled = false }
    })
  }
  // Returning from browser page memory must recheck family authorization before showing paper work.
  addEventListener('pageshow', event => { if (event.persisted) location.reload() })
}

// Save the confidence choice at capture, retaining its question revision and help conditions.
function bindConfidence(root) {
  root.querySelectorAll('form.answer input[name="confidence"]').forEach(input => {
    if (input.dataset.confidenceBound) return
    input.dataset.confidenceBound = '1'
    input.addEventListener('change', () => {
      if (!input.checked) return
      const form = input.form
      const body = { csrf: form.querySelector('[name="csrf"]')?.value, itemId: form.querySelector('[name="itemId"]')?.value,
        revision: form.querySelector('[name="revision"]')?.value, confidence: input.value }
      fetch(form.action.replace(/\/answer$/, '/confidence'), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
      // The regular answer submission also captures this value if this optional request is interrupted.
    })
  })
}
bindConfidence(document)
document.addEventListener('tutor:content', event => bindConfidence(event.detail instanceof Element ? event.detail : document))
