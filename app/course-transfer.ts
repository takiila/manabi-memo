export type CourseInfo = { code?: string; credits?: number | null; assessment?: string; notes?: string; syllabusUrl?: string };
export type TransferCourse = CourseInfo & { id: string; title: string; term: string; instructor: string; room: string; weekday: number | null; period: number | null; createdAt: string; deletedAt?: string | null; archivedAt?: string | null };
export type PackCourse = Omit<TransferCourse, 'id' | 'createdAt' | 'deletedAt' | 'archivedAt'> & {code: string};
export type CoursePack = {format:'manabi-course-pack';version:1;exportedAt?:string;courses:PackCourse[]};
export const MAX_PACK_BYTES = 1024 * 1024;
const fields = ['code','term','title','instructor','room','weekday','period','credits','assessment','notes','syllabusUrl'] as const;
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('JSONのオブジェクトが必要です'); return v as Record<string, unknown>; }
function string(v: unknown, name: string, required=false) { if(v===undefined && !required)return ''; if(typeof v!=='string'||v.length>10000||(required&&!v.trim()))throw new Error(`${name}: 文字列を確認してください`);return v.trim(); }
export function parseCoursePack(text: string): CoursePack {
 if(new TextEncoder().encode(text).length>MAX_PACK_BYTES)throw new Error('JSONは1MB以内にしてください');
 const p=object(JSON.parse(text));
 if(p.format!=='manabi-course-pack'||p.version!==1)throw new Error('manabi-course-pack version 1 が必要です');
 if(Object.keys(p).some(k=>!['format','version','exportedAt','courses'].includes(k)))throw new Error('未対応の項目があります');
 if(!Array.isArray(p.courses)||!p.courses.length||p.courses.length>200)throw new Error('講義は1〜200件です');
 const keys=new Set<string>();
 const courses=p.courses.map((raw,index)=>{
  const c=object(raw);
  if(Object.keys(c).some(k=>!fields.includes(k as typeof fields[number])))throw new Error(`${index+1}件目: 未対応の項目があります`);
  const code=string(c.code,'code',true),term=string(c.term,'term',true),title=string(c.title,'title',true);
  if(code.length>120||term.length>120||title.length>300)throw new Error('科目コード・学期・科目名が長すぎます');
  const key=JSON.stringify([term,code]);if(keys.has(key))throw new Error('同じ学期・科目コードが重複しています');keys.add(key);
  const weekday=c.weekday??null,period=c.period??null,credits=c.credits??null;
  if(weekday!==null&&(!Number.isInteger(weekday)||Number(weekday)<1||Number(weekday)>6))throw new Error('weekdayは月=1〜土=6です');
  if(period!==null&&(!Number.isInteger(period)||Number(period)<1||Number(period)>5))throw new Error('periodは90分枠の1〜5です');
  if((weekday===null)!==(period===null))throw new Error('曜日と時限は両方指定するか両方nullにしてください');
  if(credits!==null&&(typeof credits!=='number'||!Number.isFinite(credits)||credits<0||credits>30))throw new Error('creditsは0〜30です');
  const syllabusUrl=string(c.syllabusUrl,'syllabusUrl');if(syllabusUrl){let u;try{u=new URL(syllabusUrl);}catch{throw new Error('シラバスURLが不正です');}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('シラバスは認証情報を含まないhttp/https URLにしてください');}
  return {code,term,title,instructor:string(c.instructor,'instructor'),room:string(c.room,'room'),weekday:weekday as number|null,period:period as number|null,credits:credits as number|null,assessment:string(c.assessment,'assessment'),notes:string(c.notes,'notes'),syllabusUrl};
 });return {format:'manabi-course-pack',version:1,courses};
}
export type ImportRow={key:string;course:PackCourse;existingId?:string;kind:'add'|'update'|'same'|'blocked';warning:string};
export function planCourseImport(existing:TransferCourse[],pack:CoursePack):ImportRow[]{
 const rows:ImportRow[]=pack.courses.map(c=>{
  const matches=existing.filter(e=>e.term===c.term&&(e.code===c.code||(!e.code&&e.title===c.title)));
  const old=matches[0];const blocked=matches.length>1||Boolean(old?.deletedAt||old?.archivedAt);
  const clash=[...existing.filter(e=>e.id!==old?.id&&!e.deletedAt&&!e.archivedAt),...pack.courses.filter(e=>e!==c)].some(e=>c.weekday!==null&&e.term===c.term&&e.weekday===c.weekday&&e.period===c.period);
  return {key:JSON.stringify([c.term,c.code]),course:c,existingId:old?.id,kind:blocked?'blocked':!old?'add':fields.every(k=>(old[k]??(k==='credits'?null:''))===(c[k]??(k==='credits'?null:'')))?'same':'update',warning:blocked?'同じ講義が複数存在するか、ごみ箱・保管中です。先に講義を整理してください。':clash?'同じ曜日・時限の講義があります。時間割では重なります。':''};
 });
 for(const row of rows){if(row.existingId&&rows.filter(r=>r.existingId===row.existingId).length>1){row.kind='blocked';row.warning='複数の入力が同じ既存講義に一致します。科目コードを確認してください。';}}
 return rows;
}
export function applyCourseImport<T extends TransferCourse>(existing:T[],rows:ImportRow[],updates:string[]):(T|TransferCourse)[]{
 const result: (T|TransferCourse)[]=existing.slice();
 for(const r of rows){if(r.kind==='add')result.push({...r.course,id:crypto.randomUUID(),createdAt:new Date().toISOString()});else if(r.kind==='update'&&updates.includes(r.key)){const i=result.findIndex(e=>e.id===r.existingId);if(i>=0)result[i]={...result[i],...r.course};}}
 return result;
}
export function exportCoursePack(courses:TransferCourse[]):CoursePack{
 return {format:'manabi-course-pack',version:1,exportedAt:new Date().toISOString(),courses:courses.filter(c=>!c.deletedAt&&!c.archivedAt).map(c=>({code:c.code||`local-${c.id}`,term:c.term,title:c.title,instructor:c.instructor,room:c.room,weekday:c.weekday,period:c.period,credits:c.credits??null,assessment:c.assessment||'',notes:c.notes||'',syllabusUrl:c.syllabusUrl||''}))};
}
export const SAMPLE_PACK:CoursePack={format:'manabi-course-pack',version:1,courses:[{code:'SAMPLE101',term:'2026年度 後期',title:'サンプル情報学',instructor:'架空の教員',room:'',weekday:1,period:3,credits:2,assessment:'試験70%、課題30%',notes:'不明な情報は推測しない',syllabusUrl:'https://example.com/syllabus'}]};
export const PACK_GUIDE='科目コードcodeと学期termと科目名titleは必須。同じ学期・コードは同一講義です。weekdayは月1〜土6、periodは90分枠（1=08:40〜10:10、2=10:20〜11:50、3=12:40〜14:10、4=14:20〜15:50、5=16:00〜17:30）。大学の1〜2限はperiod=1、3〜4限は2、5〜6限は3です。曜日・時限不明は両方null。credits不明はnull。他の文字列は不明なら空文字。assessmentは評価割合と注意事項、notesは自由メモ。未知の項目を追加しない。最大200科目・1MB。ノート・PDF・課題進捗は含まれません。';
