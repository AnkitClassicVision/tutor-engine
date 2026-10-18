export class UserError extends Error {}
export const unexpectedMessage = 'Could not finish. Your saved work is still here. Please try again.'
export function userMessage(error: unknown) {
  if (error instanceof UserError) return error.message
  console.error('Request failed', { id: crypto.randomUUID().slice(0, 8) })
  return unexpectedMessage
}
