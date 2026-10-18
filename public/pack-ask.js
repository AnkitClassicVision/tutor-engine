// Learning-pack requests: one box, progress in place, then a Start button. Every node is built with the DOM
// so text from the request or the model is never parsed as markup.
(() => {
  const csrf = () => document.querySelector('#csrf-store')?.value || document.querySelector('[name=csrf]')?.value || ''
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')
  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(Boolean)); return node }
  const STEPS = ['Reading your request', 'Writing the lesson and questions', 'Checking every answer', 'Ready']
  const stepFor = stage => /ready|finished/i.test(stage) ? 3 : /check|fix/i.test(stage) ? 2 : /writ/i.test(stage) ? 1 : 0

  for (const form of document.querySelectorAll('form[data-pack-form]')) {
    const card = form.closest('[data-pack-ask]'), live = card?.querySelector('[data-pack-live]')
    const field = form.querySelector('textarea[name=message]'), button = form.querySelector('button[type=submit]')
    if (!card || !live || !field || !button) continue
    let watcher
    const reset = () => { button.disabled = false; card.dataset.state = '' }
    const show = (...nodes) => { live.replaceChildren(...nodes) }
    const steps = at => el('ol', { className: 'pack-steps' }, ...STEPS.map((label, i) => { const li = el('li', { textContent: label }); li.dataset.state = i < at ? 'done' : i === at ? 'now' : 'next'; return li }))

    function progress(stage) {
      const at = stepFor(stage || '')
      show(steps(at), el('p', { className: 'fine', textContent: at === 2 ? 'Checking every answer, so this takes about a minute.' : 'This takes about a minute. You can keep going; it carries on.' }))
    }
    function problem(text) { reset(); show(el('p', { className: 'banner', role: 'alert', textContent: text })) }

    async function finish(packId) {
      watcher?.close()
      let pack
      try { pack = await (await fetch(`/packs/${packId}`, { headers: { Accept: 'application/json' } })).json() } catch { location.href = `/packs/${packId}`; return }
      reset(); field.value = ''
      card.dataset.state = pack.status
      if (pack.status === 'published') {
        show(steps(4), el('p', { className: 'pack-ready', textContent: pack.interpretation || `${pack.title} is ready.` }),
          el('p', {}, el('a', { className: 'button', href: pack.lesson, textContent: 'Start with the one-minute lesson' }), ' ', el('a', { href: pack.location, textContent: 'See it' })))
        card.querySelector('.pack-ready')?.focus?.()
      } else if (pack.status === 'review') show(el('p', { textContent: 'It is written and checked. ' }), el('a', { href: pack.location, textContent: 'Open it to look it over' }))
      else if (pack.status === 'failed') problem(pack.note || 'That did not work this time. Try asking in a different way.')
      else location.href = pack.location
    }

    function watch(pack) {
      card.dataset.state = 'making'; progress('')
      if (!window.watchJob) { location.href = pack.location; return }
      watcher = window.watchJob(pack.jobId, {
        onStatus(job, terminal) { if (terminal) finish(pack.packId); else progress(job.stage) },
        onConnection(text) { if (text) live.querySelector('.fine')?.replaceChildren(text) },
      })
    }

    async function send(subject) {
      if (!field.value.trim()) { field.focus(); return }
      button.disabled = true; card.dataset.state = 'sending'; progress('')
      let response, data = {}
      try {
        response = await fetch(form.action, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ csrf: csrf(), message: field.value, requestId: form.elements.requestId.value, subject: subject || '', mode: form.elements.preview?.checked ? ('packParent' in form.dataset ? 'review' : 'plan') : 'now' }),
        })
        if (response.redirected) { problem('You were signed out. Sign in again and your words will still be here.'); return }
        data = await response.json()
      } catch { problem('The connection dropped. Your words are still here; try again.'); return }
      if (!response.ok) { problem(data.error || 'That did not work. Try again.'); return }
      if (data.kind === 'safety') { reset(); show(el('p', { className: 'pack-safety', textContent: data.reply })); return }
      if (data.kind === 'clarify') {
        reset()
        const chips = el('div', { className: 'chips' }, ...(data.chips || []).map(chip => {
          const b = el('button', { type: 'button', className: 'chip', textContent: chip })
          b.addEventListener('click', () => send(chip)); return b
        }))
        show(el('p', { textContent: data.reply }), chips)
        chips.querySelector('button')?.focus()
        return
      }
      if (data.kind === 'pack') {
        form.elements.requestId.value = newId()
        if (data.status === 'brief') { location.href = data.location; return }
        if (data.existing && data.status === 'published') { finish(data.packId); return }
        if (['queued', 'writing', 'checking'].includes(data.status) && data.jobId) { watch(data); return }
        finish(data.packId)
      }
    }

    form.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); send(form.elements.subject?.value) }, true)
  }

  // A pack page that is still being made follows the job and refreshes once it is done.
  const making = document.querySelector('[data-pack-job]')
  if (making?.dataset.packJob && window.watchJob) {
    const stage = document.querySelector('[data-pack-stage]')
    window.watchJob(making.dataset.packJob, {
      onStatus(job, terminal) {
        if (terminal) { location.reload(); return }
        const at = stepFor(job.stage || '')
        making.querySelectorAll('li').forEach((li, i) => { li.dataset.state = i < at ? 'done' : i === at ? 'now' : 'next' })
        if (stage && job.stage) stage.textContent = job.stage
      },
    })
  }
})()
