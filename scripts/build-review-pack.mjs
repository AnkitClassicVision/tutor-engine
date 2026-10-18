import {readFileSync, writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const root = new URL('../eval/review-pack/', import.meta.url)
const source = readFileSync(new URL('cases.jsonl', root), 'utf8')
const cases = source.trim().split('\n').map(line => JSON.parse(line))
const version = createHash('sha256').update(source).digest('hex').slice(0,16)
const template = readFileSync(new URL('review-template.html', root), 'utf8')
writeFileSync(new URL('review.html', root), template.replace('__CASE_DATA__', JSON.stringify(cases).replaceAll('<','\\u003c')).replaceAll('__PACK_VERSION__',version))
console.log(`Built offline reviewer: ${cases.length} synthetic cases; ${cases.filter(c=>c.handChecked).length} human-reviewed.`)
