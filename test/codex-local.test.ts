import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { askLocalCodex } from '../src/codex-local.ts'
import { askPhoto } from '../src/ai.ts'
import { openDb } from '../src/db.ts'
import { registerUser } from '../src/auth.ts'
import { saveAiSettings } from '../src/services.ts'
import { startServer } from '../src/server.ts'

test('Codex is opt-in, text-only and cannot start on a public or network listener', async () => {
 const before={public:process.env.TUTOR_PUBLIC,enabled:process.env.TUTOR_CODEX_LOCAL};
 const db=openDb(':memory:');
 try{
  process.env.TUTOR_PUBLIC='1'; process.env.TUTOR_CODEX_LOCAL='1';
  await assert.rejects(askLocalCodex('synthetic','{}','',1000,''),/local tutor/);
  await assert.rejects(startServer({db,uploadsDir:'/tmp/synthetic',host:'127.0.0.1',port:0}),/loopback/);
  process.env.TUTOR_PUBLIC='0';
  await assert.rejects(startServer({db,uploadsDir:'/tmp/synthetic',host:'0.0.0.0',port:0}),/loopback/);
  const user=await registerUser(db,'synthetic-codex@example.invalid','synthetic-password');assert.ok(user.ok);
  await saveAiSettings(db,user.userId,{provider:'codex',model:'',apiKey:''});
  process.env.TUTOR_PUBLIC='1';
  await assert.rejects(saveAiSettings(db,user.userId,{provider:'codex',model:'',apiKey:''}),/Host CLI/);
  await assert.rejects(askPhoto({provider:'codex',model:'synthetic',apiKey:'synthetic'},'','','image/png',''),/transcribe/);
 }finally{db.close();for(const [key,value] of [['TUTOR_PUBLIC',before.public],['TUTOR_CODEX_LOCAL',before.enabled]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value}}
});

test('Codex preserves its own auth, strips API credentials, cleans temporary prompts and rejects tool events/timeouts', async () => {
 const dir=await mkdtemp(join(tmpdir(),'tutor-codex-test-'));
 const before={PATH:process.env.PATH,TUTOR_CODEX_LOCAL:process.env.TUTOR_CODEX_LOCAL,OPENAI_API_KEY:process.env.OPENAI_API_KEY};
 try{
  process.env.TUTOR_CODEX_LOCAL='1';process.env.OPENAI_API_KEY='synthetic-must-not-be-passed';process.env.PATH=`${dir}:${before.PATH}`;
  const executable=join(dir,'codex'),capture=join(dir,'capture.json');
  await writeFile(executable,`#!/usr/bin/env node\nconst fs=require('fs');fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),apiKeyPresent:!!process.env.OPENAI_API_KEY}));process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"reply":"Synthetic response"}'}})));`,{mode:0o700});
  assert.deepEqual(JSON.parse(await askLocalCodex('Synthetic work','{}','Tutor rules',1000,'')),{structuredOutput:{reply:'Synthetic response'}});
  const result=JSON.parse(await readFile(capture,'utf8'));assert.equal(result.apiKeyPresent,false);
  await assert.rejects(readFile(join(result.cwd,'response.schema.json')),/ENOENT/);
  assert.ok(result.args.includes('--ignore-user-config'));assert.ok(result.args.includes('forced_login_method="chatgpt"'));
  await writeFile(executable,`#!/usr/bin/env node\nconsole.log(JSON.stringify({type:'item.started',item:{type:'command_execution',command:'forbidden'}}));setInterval(()=>{},1000);`,{mode:0o700});
  await assert.rejects(askLocalCodex('Synthetic','{}','',1000,''),/does not allow tools/);
  await writeFile(executable,'#!/usr/bin/env node\nsetInterval(()=>{},1000);',{mode:0o700});
  await assert.rejects(askLocalCodex('Synthetic','{}','',50,''),/too long/);
 }finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value}await rm(dir,{recursive:true,force:true})}
});
