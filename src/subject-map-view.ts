import { csrfField, esc } from "./view.ts"
import { BAND_LABEL } from "./engine/ladder.ts"
import { concepts, type MapRow, type SubjectMap } from "./subject-map.ts"

const STATUS: Record<string, string> = {
  researching: "Researching", draft: "Waiting for your approval", approved: "Approved", rejected: "Set aside", superseded: "Replaced by a newer version", failed: "Research did not finish",
}

/** On the classes page: each subject's map and its state, with a way to research one. */
export function mapsSection(studentId: string, subjects: string[], maps: MapRow[]) {
  // Subjects with a map are listed even before they have a class.
  const all = [...new Map([...subjects, ...maps.map(row => row.subject)].map(subject => [subject.toLowerCase(), subject])).values()]
  const rows = all.filter(subject => !/^maths?$/i.test(subject)).map(subject => {
    const map = maps.find(row => row.subject.toLowerCase() === subject.toLowerCase())
    return `<li><strong>${esc(subject)}</strong> · ${map ? `<a href="/students/${esc(studentId)}/maps/${esc(map.id)}">${esc(STATUS[map.status] ?? map.status)}</a>` : `<form method="post" action="/students/${esc(studentId)}/maps" class="inline">${csrfField()}<input type="hidden" name="subject" value="${esc(subject)}"><button type="submit" class="ghost">Research this subject</button></form>`}</li>`
  })
  return `<section class="panel subject-maps" aria-labelledby="maps-title"><h2 id="maps-title">Subject maps</h2>
    <p class="fine">Before teaching a new subject, the tutor researches it: the key ideas in order, what good thinking looks like up to judging and creating, the mistakes children usually make, and where the facts come from. You approve the map before anything is taught. Math uses the built-in course.</p>
    ${rows.length ? `<ul>${rows.join("")}</ul>` : "<p>No other subjects yet. Add a class and its map is researched first.</p>"}
  </section>`
}

export function subjectMapPage(studentId: string, name: string, row: MapRow, jobId: string | null) {
  const back = `<p class="links"><a href="/students/${esc(studentId)}/classes">${esc(name)}’s classes</a></p>`
  const head = `<h1>${esc(row.subject)}: subject map</h1><p class="step-tag">${esc(STATUS[row.status] ?? row.status)} · version ${row.version}</p>`
  if (row.status === "researching") return `${back}${head}<p>The tutor is researching this subject.${jobId ? ` <a href="/jobs/${esc(jobId)}">Watch progress</a>.` : ""}</p>`
  if (!row.map_json) return `${back}${head}<p>${esc(row.note || "This map has no content.")}</p><form method="post" action="/students/${esc(studentId)}/maps" class="panel">${csrfField()}<input type="hidden" name="subject" value="${esc(row.subject)}"><button type="submit">Try the research again</button></form>`
  const map = JSON.parse(row.map_json) as SubjectMap
  const list = concepts(map)
  const number = new Map(list.map((concept, index) => [concept.key, index + 1]))
  const research = row.research === "web"
    ? `<p class="banner" role="note">Researched on the web: ${map.sources.filter(source => source.url).length} sources, each one returned by the search itself.</p>`
    : `<p class="banner warn" role="note">Written from the AI’s own knowledge and your uploads, without a web search. Please read it carefully; nothing here was checked against a source.</p>`
  const groups = map.groups.map(group => `<section class="map-group"><h2>${esc(group.title)}</h2>${group.concepts.map(concept => `
    <article class="map-concept" id="concept-${esc(concept.key)}">
      <h3><span class="step-number" aria-hidden="true">${number.get(concept.key)}</span> ${esc(concept.title)}</h3>
      <p><strong>The idea:</strong> ${esc(concept.idea)}</p>
      ${concept.prereqs.length ? `<p class="fine">Builds on ${concept.prereqs.map(key => `#${number.get(key) ?? "?"}`).join(", ")}.${concept.crossLinks.length ? ` Uses ${esc(concept.crossLinks.join(", "))}.` : ""}</p>` : concept.crossLinks.length ? `<p class="fine">Uses ${esc(concept.crossLinks.join(", "))}.</p>` : ""}
      <dl class="map-levels"><div><dt>${BAND_LABEL.foundations}</dt><dd>${esc(concept.success.foundations)}</dd></div><div><dt>${BAND_LABEL.use}</dt><dd>${esc(concept.success.use)}</dd></div><div><dt>${BAND_LABEL.judge}</dt><dd>${esc(concept.success.judge)}</dd></div></dl>
      <details><summary>Common mistakes, a mission and a new situation</summary>
        <ul>${concept.misconceptions.map(m => `<li><strong>“${esc(m.belief)}”</strong> The tutor checks with: ${esc(m.probe)} and repairs it by: ${esc(m.fix)}</li>`).join("")}</ul>
        <p><strong>Mission:</strong> ${esc(concept.mission)}</p>
        <p><strong>Somewhere new:</strong> ${esc(concept.transfer)}</p>
        <p><strong>Example:</strong> ${esc(concept.contrast.example)} <strong>Not an example:</strong> ${esc(concept.contrast.nonExample)}</p>
        ${concept.sources.length ? `<p class="fine">Sources: ${concept.sources.map(index => `[${index + 1}]`).join(" ")}</p>` : ""}
      </details>
    </article>`).join("")}</section>`).join("")
  const sources = map.sources.length ? `<section class="panel"><h2>Sources</h2><ol>${map.sources.map(source => `<li>${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a>` : esc(source.title)}${source.publisher ? ` · ${esc(source.publisher)}` : ""}</li>`).join("")}</ol></section>` : ""
  const decide = row.status === "draft" ? `<section class="panel map-decision" aria-labelledby="decide-title"><h2 id="decide-title">Your decision</h2>
      <form method="post" action="/students/${esc(studentId)}/maps/${esc(row.id)}/approve">${csrfField()}<button type="submit">Approve and start teaching</button></form>
      <form method="post" action="/students/${esc(studentId)}/maps/${esc(row.id)}/changes">${csrfField()}<label>Ask for changes<textarea name="note" maxlength="2000" required placeholder="For example: leave out the Roman section, and add more about volcanoes."></textarea></label><button type="submit" class="ghost">Research again with these changes</button></form>
      <form method="post" action="/students/${esc(studentId)}/maps/${esc(row.id)}/reject">${csrfField()}<button type="submit" class="ghost">Set this map aside</button></form>
    </section>` : ""
  return `${back}${head}${research}
    <section class="panel"><p><strong>Purpose:</strong> ${esc(map.purpose)}</p><p><strong>Scope:</strong> ${esc(map.scope)}</p>${map.cautions ? `<p><strong>Worth knowing:</strong> ${esc(map.cautions)}</p>` : ""}<p class="fine">${list.length} ideas in ${map.groups.length} groups, in the order they build on each other.</p></section>
    ${decide}${groups}${sources}`
}
