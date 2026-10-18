// Hands-on models (see src/manipulatives.ts). Native buttons keep touch, mouse and keyboard working;
// the live sentence always states the current value.
(() => {
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n))
  function fraction(root) {
    const bar = root.querySelector('[data-bar]'), value = root.querySelector('[data-value]')
    const render = () => {
      const parts = bar.children.length, shaded = bar.querySelectorAll('[aria-pressed="true"]').length
      root.dataset.parts = String(parts)
      value.textContent = `${shaded} of ${parts} equal parts shaded: ${shaded}/${parts}`
    }
    bar.addEventListener('click', event => {
      const part = event.target.closest('[data-part]'); if (!part) return
      part.setAttribute('aria-pressed', String(part.getAttribute('aria-pressed') !== 'true')); render()
    })
    root.querySelectorAll('[data-step="parts"]').forEach(button => button.addEventListener('click', () => {
      const parts = clamp(bar.children.length + Number(button.dataset.by), 2, 12)
      // Re-cutting the bar starts the shading again, like cutting a fresh strip of paper.
      bar.replaceChildren(...Array.from({ length: parts }, (_, i) => {
        const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'manip-part'; cell.dataset.part = ''
        cell.setAttribute('aria-pressed', 'false'); cell.setAttribute('aria-label', `Part ${i + 1} of ${parts}`); return cell
      }))
      render()
    }))
  }
  function groups(root) {
    const view = root.querySelector('[data-groups-view]'), value = root.querySelector('[data-value]')
    const render = () => {
      const g = Number(root.dataset.groups), each = Number(root.dataset.each)
      view.replaceChildren(...Array.from({ length: g }, () => {
        const box = document.createElement('span'); box.className = 'manip-group'
        for (let i = 0; i < each; i++) { const dot = document.createElement('span'); dot.className = 'manip-dot'; box.append(dot) }
        return box
      }))
      value.textContent = `${g} groups of ${each} make ${g * each}`
    }
    root.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.step, max = key === 'groups' ? 10 : 12
      root.dataset[key] = String(clamp(Number(root.dataset[key]) + Number(button.dataset.by), 1, max)); render()
    }))
  }
  function line(root) {
    const value = root.querySelector('[data-value]'), low = Number(root.dataset.low), high = Number(root.dataset.high)
    const render = () => {
      const at = Number(root.dataset.at)
      root.querySelectorAll('[data-tick]').forEach(tick => {
        const n = Number(tick.dataset.tick); tick.classList.toggle('is-here', n === at)
        tick.textContent = n % 5 === 0 || n === at ? String(n) : ''
      })
      value.textContent = `At ${at}`
    }
    root.querySelectorAll('[data-step="at"]').forEach(button => button.addEventListener('click', () => {
      root.dataset.at = String(clamp(Number(root.dataset.at) + Number(button.dataset.by), low, high)); render()
    }))
  }
  function bind(scope) {
    scope.querySelectorAll('[data-manip]').forEach(root => {
      if (root.dataset.bound) return; root.dataset.bound = '1'
      ;({ fraction, groups, line })[root.dataset.manip]?.(root)
    })
  }
  bind(document)
  document.addEventListener('tutor:content', event => bind(event.detail instanceof Element ? event.detail : document))
})()
