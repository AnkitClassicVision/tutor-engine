export function parentMailConfigured() {
  if (!process.env.TUTOR_MAIL_FROM) return false
  if (process.env.TUTOR_MAIL_PROVIDER === 'resend') return !!process.env.RESEND_API_KEY
  if (process.env.TUTOR_MAIL_PROVIDER && process.env.TUTOR_MAIL_PROVIDER !== 'smtp') return false
  return !!process.env.TUTOR_SMTP_URL
}

export async function parentMailer() {
  if (!parentMailConfigured()) throw new Error('Parent email delivery is not configured.')
  if (process.env.TUTOR_MAIL_PROVIDER === 'resend') {
    const { Resend } = await import('resend')
    const client = new Resend(process.env.RESEND_API_KEY)
    return {
      async send(id: string, message: { to: string; subject: string; text: string }) {
        const result = await client.emails.send({ from: process.env.TUTOR_MAIL_FROM!, ...message }, {
          idempotencyKey: `tutor-parent-mail/${id}`, signal: AbortSignal.timeout(30000),
        })
        // Provider responses can contain recipient details. Keep errors generic.
        if (result.error || !result.data?.id) throw new Error('Parent email delivery paused. Please try again later.')
      },
      close() {},
    }
  }
  const { default: nodemailer } = await import('nodemailer')
  const transport = nodemailer.createTransport(process.env.TUTOR_SMTP_URL!)
  return {
    async send(_id: string, message: { to: string; subject: string; text: string }) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          transport.sendMail({ from: process.env.TUTOR_MAIL_FROM!, ...message }),
          new Promise((_, reject) => { timer = setTimeout(() => { transport.close(); reject(new Error('Parent email delivery paused.')) }, 30000) }),
        ])
      } finally { if (timer) clearTimeout(timer) }
    },
    close() { transport.close() },
  }
}
