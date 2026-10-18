import type {Database} from '../../src/database.ts'
import {createStudent} from '../../src/services.ts'

/** Synthetic records only; preserves the real item-to-attempt provenance contract. */
export async function seedStrengths(db:Database,owner:string){
 const student=await createStudent(db,owner,{displayName:'Synthetic explorer',grade:5,sessionCapMinutes:5})
 await db.prepare('UPDATE students SET subjects = ? WHERE id = ?').run('["Math","Reading"]',student)
 const reading=`custom.${crypto.randomUUID()}`
 await db.prepare(`INSERT INTO custom_concepts(concept_id,student_id,subject,grade,title,recall,example,non_example,purpose,created_at) VALUES(?,?,'Reading',5,'Find a main idea','Find a main idea.','A passage has a central idea.','One detail is not the whole idea.','year',?)`).run(reading,student,new Date().toISOString())
 const date=(ago:number)=>new Date(Date.now()-ago*86400000).toISOString().slice(0,10)
 async function record(concept:string,n:number,options:{day?:number,level?:number,hints?:number,correct?:boolean|null,prompt?:string,mode?:string}={}){
  const session=crypto.randomUUID(),item=crypto.randomUUID(),day=date(options.day??0),time=day+`T12:${String(n).padStart(2,'0')}:00.000Z`,hints=options.hints??0,correct=options.correct===undefined?true:options.correct,level=options.level??2,prompt=options.prompt??`Synthetic fresh check ${n} for ${concept}`
  await db.prepare(`INSERT INTO tutor_sessions(id,student_id,started_at,ended_at,end_reason,modality,consecutive_step_downs,cap_minutes,continuity,mode,subject) VALUES(?,?,?,?,'completed','screen',0,5,'',?,?)`).run(session,student,time,time,options.mode??'assessment',concept===reading?'Reading':'Math')
  await db.prepare(`INSERT INTO session_items(id,session_id,position,beat,concept_id,bloom_level,prompt,answer,hints_json,surface,interleaved,hints_used,given_answer,answered,correct,time_ms,submitted_at) VALUES(?,?,1,'frontier',?,?,?,'4','[]','screen',1,?,'synthetic response',1,?,1200,?)`).run(item,session,concept,level,prompt,hints,correct===null?null:correct?1:0,time)
  if(correct!==null)await db.prepare(`INSERT INTO attempts(id,student_id,session_id,concept_id,bloom_level,day,correct,hints_used,interleaved,time_ms,error_type,modality,created_at) VALUES(?,?,?,?,?,?,?,?,1,1200,NULL,'screen',?)`).run(item,student,session,concept,level,day,correct?1:0,hints,time)
 }
 // Recent advanced mastery; no lower-demand evidence inferred.
 for(let n=1;n<=3;n++)await record('math.8.ee.c.7',n,{day:3-n,level:3})
 // Current fraction topic: help, repeat, one fresh independent check and one pending grade.
 await record('math.5.nf.a.1',4,{hints:1,prompt:'Synthetic supported fraction question'})
 await record('math.5.nf.a.1',5,{prompt:'Synthetic supported fraction question'})
 await record('math.5.nf.a.1',6)
 await record('math.5.nf.a.1',7,{correct:null})
 // An older achievement remains meaningful when a delayed check misses.
 for(let n=8;n<=10;n++)await record('math.5.nf.b.4',n,{day:20-n})
 await record('math.5.nf.b.4',11,{correct:false})
 await record(reading,12,{mode:'homework',hints:1})
 return {student,reading}
}
