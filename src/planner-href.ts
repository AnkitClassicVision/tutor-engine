/** A link that opens the planner, pre-filled, on the parent page. Works without scripts because the server renders it open. */
export function plannerHref(studentId: string, say = "") {
  return `/students/${encodeURIComponent(studentId)}/parent?planner=open${say ? `&say=${encodeURIComponent(say)}` : ""}#planner`
}
