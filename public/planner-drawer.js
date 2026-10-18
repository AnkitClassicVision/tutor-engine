// Parent planner drawer: opens on every parent page, sends messages as JSON, shows the reply in place,
// and applies proposals without leaving the page. Every visual state is a class or attribute so the
// drawer is correct with motion turned off.
(() => {
  const drawer = document.querySelector('[data-planner-drawer]'); if (!drawer) return
  const fab = document.querySelector('[data-planner-open].planner-fab'), panel = drawer.querySelector('.planner-panel'), body = drawer.querySelector('[data-planner-body]')
  const main = document.querySelector('main'), student = drawer.dataset.student, fragmentUrl = drawer.dataset.fragmentUrl
  const openKey = `planner-open:${student}`, draftKey = `planner-draft:${student}`
  const phone = () => matchMedia('(max-width: 750px)').matches
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || getComputedStyle(panel).transitionDuration === '0s'
  const csrf = () => document.querySelector('#csrf-store')?.value || document.querySelector('[name=csrf]')?.value || ''
  let opener = null, watcher = null, dirty = false, photos = [], photoRequest = null
  const MAX_PAGES = 12
  const store = (key, value) => { try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value) } catch { /* private mode */ } }
  const load = key => { try { return sessionStorage.getItem(key) } catch { return null } }

  const textarea = () => body.querySelector('textarea[name=message]')
  const status = (text) => { const node = body.querySelector('[data-planner-status]'); if (node) node.textContent = text }
  function focusables() { return [...panel.querySelectorAll('a[href], button:not([disabled]), textarea, input:not([type=hidden]), [tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && el.offsetParent !== null) }

  function open(prefill, restoring) {
    opener = document.activeElement
    drawer.hidden = false
    if (restoring) drawer.dataset.restoring = '1'
    requestAnimationFrame(() => { drawer.classList.add('is-open'); requestAnimationFrame(() => delete drawer.dataset.restoring) })
    fab?.setAttribute('aria-expanded', 'true')
    if (phone()) { document.body.classList.add('drawer-open'); if (main) main.inert = true }
    store(openKey, '1')
    const field = textarea()
    if (field) {
      if (typeof prefill === 'string' && prefill) { field.value = prefill; store(draftKey, prefill) }
      else if (!field.value) field.value = load(draftKey) || ''
      field.dispatchEvent(new Event('input', { bubbles: true }))
      if (!restoring) { field.focus(); field.setSelectionRange(field.value.length, field.value.length) }
    } else if (!restoring) panel.focus()
    bind()
  }
  function close() {
    drawer.classList.remove('is-open')
    fab?.setAttribute('aria-expanded', 'false')
    document.body.classList.remove('drawer-open'); if (main) main.inert = false
    store(openKey, null)
    let done = false
    const finish = () => { if (done) return; done = true; drawer.hidden = true; if (opener && opener.focus) opener.focus(); if (dirty) { dirty = false; location.reload() } }
    if (reduced()) finish()
    else { panel.addEventListener('transitionend', finish, { once: true }); setTimeout(finish, 400) }
  }

  document.addEventListener('click', event => {
    const prefill = event.target.closest('[data-planner-prefill]')
    if (prefill) {
      if (prefill.closest('[data-planner-drawer]')) { const field = textarea(); if (field) { field.value = prefill.dataset.plannerPrefill; field.focus(); field.setSelectionRange(field.value.length, field.value.length); store(draftKey, field.value) } }
      else { event.preventDefault(); open(prefill.dataset.plannerPrefill) }
      return
    }
    if (event.target.closest('[data-planner-open]')) { event.preventDefault(); drawer.hidden ? open() : close(); return }
    if (event.target.closest('[data-planner-close]')) { close(); return }
    const apply = event.target.closest('[data-planner-apply]'); if (apply) { act(`/students/${student}/planner/apply/${apply.dataset.plannerApply}`, apply); return }
    const decline = event.target.closest('[data-planner-decline]'); if (decline) { act(`/students/${student}/planner/decline/${decline.dataset.plannerDecline}`, decline); return }
    const undo = event.target.closest('[data-planner-undo]'); if (undo) act(`/students/${student}/undo`, undo, { decisionId: undo.dataset.plannerUndo })
  })
  document.addEventListener('keydown', event => {
    if (drawer.hidden) return
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key === 'Tab' && phone()) {
      const items = focusables(); if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  })

  function bubble(text, mine, extra) {
    const li = document.createElement('li'); li.className = `planner-bubble is-arriving${mine ? ' mine' : ''}${extra ? ` ${extra}` : ''}`
    const p = document.createElement('p'); p.textContent = text; li.append(p); return li
  }
  function thinking() {
    const li = document.createElement('li'); li.className = 'planner-bubble working is-arriving'
    const art = body.querySelector('.mini-think')?.cloneNode(true) || document.createElement('span')
    const p = document.createElement('p'); p.textContent = 'Thinking about it.'
    li.append(art, p); return li
  }
  async function refresh(announce) {
    body.setAttribute('aria-busy', 'true')
    try {
      const response = await fetch(fragmentUrl, { headers: { Accept: 'text/html' } })
      if (!response.ok) throw new Error()
      const draft = textarea()?.value || ''
      body.innerHTML = await response.text()
      const field = textarea(); if (field && draft) field.value = draft
      body.querySelectorAll('.planner-bubble').forEach((li, i) => { if (i >= body.querySelectorAll('.planner-bubble').length - 2) { li.classList.add('is-arriving'); li.style.setProperty('--i', String(i % 3)) } })
      document.dispatchEvent(new CustomEvent('tutor:content', { detail: body }))
      bind()
      if (announce) status(announce)
      body.querySelector('[data-planner-thread]')?.lastElementChild?.scrollIntoView({ block: 'nearest' })
    } catch { status('Could not refresh the conversation. Your message is saved.') }
    finally { body.removeAttribute('aria-busy') }
  }
  function watch(jobId) {
    watcher?.close()
    watcher = window.watchJob(jobId, {
      onConnection: text => { if (text) status(text) },
      onStatus: (job, terminal) => {
        if (!terminal) { if (job.stage) status(job.stage); return }
        if (job.status === 'succeeded') refresh('Here is what I would do. Read it, then press Apply or reply.')
        else refresh(job.status === 'failed' ? 'I could not finish that. Your message is saved; try again.' : 'Stopped.')
      },
    })
  }
  function unlockLink(text) {
    const li = bubble(`${text} `, false)
    const a = document.createElement('a'); a.href = `/parent/unlock?returnTo=${encodeURIComponent(location.pathname + location.search)}`; a.textContent = 'Unlock again'
    li.firstChild.append(a); return li
  }
  // ---- Photos ----
  async function prepare(file) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Choose JPEG or PNG photos.')
    if (file.size > 15000000) throw new Error('Choose photos smaller than 15 MB.')
    const url = URL.createObjectURL(file)
    try {
      const img = new Image(); img.src = url; await img.decode()
      // Normalise large camera photos so uploads stay quick on a phone connection.
      const scale = Math.min(1, 1800 / Math.max(img.width, img.height)), canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const preview = canvas.toDataURL('image/jpeg', 0.86)
      return { preview, base64: preview.split(',')[1], mime: 'image/jpeg' }
    } finally { URL.revokeObjectURL(url) }
  }
  function renderPreviews() {
    const list = body.querySelector('[data-planner-previews]'); if (!list) return
    list.replaceChildren(...photos.map((photo, index) => {
      const li = document.createElement('li')
      const img = document.createElement('img'); img.src = photo.preview; img.alt = `Page ${index + 1}`
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ghost'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove page ${index + 1}`)
      remove.addEventListener('click', () => { photos.splice(index, 1); photoRequest = null; renderPreviews(); status(photos.length ? `${photos.length} page${photos.length === 1 ? '' : 's'} ready to send.` : 'Photos removed.') })
      li.append(img, remove); return li
    }))
    list.hidden = !photos.length
  }
  async function addPhotos(input) {
    const files = [...(input.files || [])]; input.value = ''
    if (!files.length) return
    if (photos.length + files.length > MAX_PAGES) { status(`Send up to ${MAX_PAGES} pages at a time.`); return }
    status('Preparing photos…')
    try { for (const file of files) photos.push(await prepare(file)); photoRequest = null; renderPreviews(); status(`${photos.length} page${photos.length === 1 ? '' : 's'} ready. Add a few words, then send.`) }
    catch (error) { status(error.message || 'Those photos could not be read.') }
  }
  async function uploadPages(onProgress) {
    if (drawer.dataset.cloudUploads !== '1') return photos.map(p => ({ base64: p.base64, mime: p.mime }))
    const { put } = await import('/blob-client.js')
    const pages = []
    for (const [index, photo] of photos.entries()) {
      if (photo.uploadId) { pages.push({ uploadId: photo.uploadId }); continue }
      onProgress(`Uploading page ${index + 1} of ${photos.length}…`)
      const ticket = await fetch(`/students/${student}/upload-token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csrf: csrf(), mime: photo.mime }) })
      if (!ticket.ok) throw new Error(ticket.status === 403 ? 'expired' : 'upload')
      const slot = await ticket.json()
      const bytes = Uint8Array.from(atob(photo.base64), c => c.charCodeAt(0))
      await put(slot.pathname, new Blob([bytes], { type: photo.mime }), { access: 'private', token: slot.token, contentType: photo.mime, abortSignal: AbortSignal.timeout(120000) })
      const done = await fetch(`/students/${student}/upload-complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csrf: csrf(), id: slot.id }) })
      if (!done.ok) throw new Error('upload')
      photo.uploadId = slot.id; pages.push({ uploadId: slot.id })
    }
    return pages
  }
  function photoBubble(text) {
    const li = bubble(text ? `Sent ${photos.length} page${photos.length === 1 ? '' : 's'}: ${text}` : `Sent ${photos.length} page${photos.length === 1 ? '' : 's'}.`, true)
    const strip = document.createElement('div'); strip.className = 'planner-pages'
    for (const [index, photo] of photos.slice(0, 4).entries()) { const img = document.createElement('img'); img.src = photo.preview; img.alt = `Page ${index + 1}`; strip.append(img) }
    li.prepend(strip); return li
  }
  async function sendPhotos(form, text) {
    const field = textarea(), thread = body.querySelector('[data-planner-thread]'), button = form.querySelector('button[type=submit]')
    thread.append(photoBubble(text)); const pending = thinking(); thread.append(pending); pending.scrollIntoView({ block: 'nearest' })
    form.setAttribute('aria-busy', 'true'); if (button) button.disabled = true; status('Sending photos…')
    photoRequest = photoRequest || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
    try {
      const pages = await uploadPages(status)
      status('Saving the pages…')
      const response = await fetch(`/students/${student}/planner/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csrf: csrf(), message: text, pages, requestId: photoRequest }) })
      if (response.status === 403) { pending.replaceWith(unlockLink('Your parent unlock has expired. Your photos are still here.')); return }
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { pending.replaceWith(bubble(result.error || 'The photos could not be saved. They are still here; try again.', false)); return }
      photos = []; photoRequest = null; if (field) field.value = ''; store(draftKey, null)
      dirty = true
      await refresh('Saved. Press the button on the card to build practice from these pages.')
    } catch (error) {
      pending.replaceWith(error.message === 'expired' ? unlockLink('Your parent unlock has expired. Your photos are still here.') : bubble('The connection paused while sending photos. They are still here; try again.', false))
    } finally { form.removeAttribute('aria-busy'); if (button) button.disabled = false }
  }

  async function send(form) {
    const field = textarea(), text = (field?.value || '').trim()
    if (photos.length) return sendPhotos(form, text)
    if (!text) { status('Write a message or add photos first.'); field?.focus(); return }
    const thread = body.querySelector('[data-planner-thread]'), button = form.querySelector('button[type=submit]')
    thread.append(bubble(text, true)); const pending = thinking(); thread.append(pending); pending.scrollIntoView({ block: 'nearest' })
    field.value = ''; store(draftKey, null); form.setAttribute('aria-busy', 'true'); if (button) button.disabled = true; status('Sent.')
    try {
      const response = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csrf: csrf(), message: text, voice: form.querySelector('[name=voice]')?.value || '0', source: 'drawer', mode: form.querySelector('input[name=mode]:checked')?.value || 'now' }) })
      if (response.redirected) { pending.replaceWith(bubble('You were signed out. Sign in again to continue.', false)); return }
      if (response.status === 403) { pending.replaceWith(unlockLink('Your parent unlock has expired.')); return }
      const result = await response.json().catch(() => ({}))
      if (response.status === 202 && result.jobId) { watch(result.jobId); return }
      if (response.status === 200) { await refresh(result.proposal ? 'Here is the change. Press Apply to make it.' : ''); return }
      if (response.status === 409 && result.pending?.jobId) { watch(result.pending.jobId); return }
      pending.replaceWith(bubble(result.error || 'Could not send that. Try again.', false)); field.value = text
    } catch { pending.replaceWith(bubble('The connection paused. Your message may not have arrived; try again.', false)); field.value = text }
    finally { form.removeAttribute('aria-busy'); if (button) button.disabled = false }
  }
  async function act(url, button, extra) {
    const card = button.closest('.planner-proposal'); card?.querySelectorAll('button').forEach(b => { b.disabled = true })
    status('Working…')
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csrf: csrf(), ...(extra || {}) }) })
      if (response.status === 403) { card?.after(unlockLink('Your parent unlock has expired.')); return }
      const result = await response.json().catch(() => ({}))
      if (!response.ok) { status(result.error || 'That could not be applied.'); card?.querySelectorAll('button').forEach(b => { b.disabled = false }); return }
      if (result.applied || result.undone) dirty = true
      if (result.applied) { card?.setAttribute('data-status', 'applied'); card?.classList.add('is-applied') }
      await refresh(result.message || (result.applied ? 'Applied.' : 'Okay, not applied.'))
      if (result.applied && result.location) { const a = document.createElement('a'); a.href = result.location; a.className = 'button ghost planner-see'; a.textContent = 'See it →'; body.querySelector('.planner-proposal[data-status="applied"]:last-of-type')?.append(a) }
    } catch { status('The connection paused. Reload to check whether it was applied.') }
  }
  function bind() {
    const form = body.querySelector('[data-planner-form]'); if (!form || form.dataset.bound) return
    form.dataset.bound = '1'
    form.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); send(form) }, { capture: true })
    const field = textarea()
    field?.addEventListener('input', () => store(draftKey, field.value))
    field?.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send(form) } })
    const pending = body.querySelector('[data-planner-job]'); if (pending && !watcher) watch(pending.dataset.plannerJob)
    body.querySelector('[data-planner-photos]')?.addEventListener('change', event => addPhotos(event.target))
    renderPreviews()
  }
  // The Add a class card on the parent page hands its words to the planner instead of leaving the page.
  document.addEventListener('submit', event => {
    const card = event.target.closest('form[data-planner-compose]'); if (!card) return
    event.preventDefault(); event.stopImmediatePropagation()
    const title = (card.querySelector('[name=title]')?.value || '').trim(), detail = (card.querySelector('[name=message]')?.value || '').trim()
    if (!title) { card.querySelector('[name=title]')?.focus(); return }
    open(`Add a class called ${title}. ${detail}`.trim())
    const form = body.querySelector('[data-planner-form]'); if (form) send(form)
    card.reset()
  }, true)
  bind()
  if (drawer.dataset.open === '1' || load(openKey) === '1') open(undefined, true)
})()
