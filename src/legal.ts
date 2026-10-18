// The privacy notice, terms and source link every deployment shows. Operators name themselves with
// TUTOR_OPERATOR_NAME and TUTOR_CONTACT_EMAIL. The source link satisfies AGPL-3.0 section 13: people using a
// deployment over the network can get its source. Point TUTOR_SOURCE_URL at your fork if you change the code.
import { esc } from "./view.ts"

export const SOURCE_URL = process.env.TUTOR_SOURCE_URL || "https://github.com/AnkitClassicVision/tutor-engine"
const operator = () => process.env.TUTOR_OPERATOR_NAME || "the person or organization running this site"
const contact = () => {
  const email = process.env.TUTOR_CONTACT_EMAIL
  // Without an email, people reach the operator through the project page; never ask for a child's details there.
  return email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : `the operator through <a href="${esc(SOURCE_URL)}/issues" rel="noopener">the project’s GitHub page</a> (please don’t post your child’s details there)`
}

export function siteFooter() {
  return `<footer class="site-foot"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="${esc(SOURCE_URL)}" rel="noopener">Source code</a></footer>`
}

export function privacyPage() {
  return `<article class="legal">
  <h1>Privacy notice</h1>
  <p class="lede">This site is run by ${esc(operator())}. It is built from open-source software, and this notice describes what that software does with your family’s information.</p>
  <h2>Who uses it</h2>
  <p>Only a parent or guardian creates an account. Children do not sign up; they use a link and PIN their parent makes, and can do only learner things.</p>
  <h2>What is stored</h2>
  <ul>
    <li>Your email address and a salted, slow hash of your password (never the password itself).</li>
    <li>For each child: the name you choose, an optional birthday, school level, classes, answers, notes, photos of schoolwork you upload, and their learning history.</li>
    <li>Your AI provider key or sign-in, if you connect one, encrypted.</li>
  </ul>
  <p>Children’s names, birthdays, notes, chats and answers are encrypted with a key belonging to your family before they reach the database. Photo location and camera details are removed when a photo is saved.</p>
  <h2>The AI provider you choose</h2>
  <p>Practice missions work without any AI. If you connect one (for example OpenAI, Anthropic, xAI or OpenRouter), the questions, your child’s answers, homework photos and their text, and a first name may be sent to that provider to check work, explain and plan. That provider’s own terms and privacy policy apply to what it receives. You can disconnect it at any time in AI settings.</p>
  <h2>Email</h2>
  <p>We send account verification, password recovery and, if there is something to report, a weekly summary. Nothing else.</p>
  <h2>What we never do</h2>
  <p>No advertising, no selling or sharing data for marketing, no tracking or analytics scripts, no profiles of children beyond their learning record here.</p>
  <h2>Your choices</h2>
  <p>In the parent area you can export everything we hold about your family, correct it, or delete the whole family. Deleting removes the records and files and destroys your family’s encryption key.</p>
  <h2>Questions</h2>
  <p>Contact ${contact()}.</p>
</article>`
}

export function termsPage() {
  return `<article class="legal">
  <h1>Terms</h1>
  <p class="lede">This site is run by ${esc(operator())} using open-source software licensed under the GNU Affero General Public License v3.0.</p>
  <ul>
    <li><b>Early software.</b> It is provided as is, without warranty. Teaching and AI feedback can be wrong. It supports, and does not replace, a parent, teacher or tutor.</li>
    <li><b>A parent stays involved.</b> You create the account, choose what your child works on, and review what the AI says.</li>
    <li><b>Your AI account.</b> If you connect an AI provider, its charges and terms are between you and that provider.</li>
    <li><b>Fair use.</b> Use it for your own family’s learning. Do not upload anything you do not have the right to share, or try to reach other families’ data.</li>
    <li><b>Changes.</b> The operator may change or end this service. You can export your family’s data at any time.</li>
  </ul>
  <p>The source code is at <a href="${esc(SOURCE_URL)}" rel="noopener">${esc(SOURCE_URL)}</a>. Questions: ${contact()}.</p>
</article>`
}
