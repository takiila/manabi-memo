import {READ_SCOPE,WRITE_SCOPE} from '../lib/server/academic-oauth-model.ts';
import { correctionValues } from './academic-records-model.ts';
const string=(description:string,maxLength=180)=>({type:'string',minLength:1,maxLength,description});
const id=string('概要取得で確認したID');
const day=string('本人が確認した実施日 YYYY-MM-DD',10);
const base={expectedRevision:{type:'integer',minimum:1,description:'直前の概要取得で返されたrevision'},confirmed:{type:'boolean',const:true,description:'本人の明確な指示・確認がある場合だけtrue'},courseId:id};
const schema=(properties:Record<string,unknown>,required:string[]=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
function writeTool(name:string,title:string,description:string,extra:Record<string,unknown>,optional:string[]=[]){
 const properties={...base,...extra};
 return {name,title,description,inputSchema:schema(properties,Object.keys(properties).filter(key=>!optional.includes(key))),annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false},_meta:{securitySchemes:[{type:'oauth2',scopes:[READ_SCOPE,WRITE_SCOPE]}]},securitySchemes:[{type:'oauth2',scopes:[READ_SCOPE,WRITE_SCOPE]}]};
}
export const academicTools=[
 {name:'get_academic_summary',title:'学業情報を取得',description:'同期済みの科目、授業日、課題、試験、出席、学習記録、大学情報を取得。大学側の最新情報は未照合。空リストを授業なし・課題なしと断定しない。',inputSchema:schema({term:string('学期名。指定しなければ現在の学期。全学期は all。')},[]),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:{securitySchemes:[{type:'oauth2',scopes:[READ_SCOPE]}]},securitySchemes:[{type:'oauth2',scopes:[READ_SCOPE]}]},
 {name:'get_course_academic_detail', title:'科目別の学業詳細を取得', description:'概要で返された科目IDを使い、出典付きの提出・出席候補・得点・評価条件・資料と集計を取得。nextOffsetで続きを取得できます。',inputSchema:schema({courseId:id,offset:{type:'integer',minimum:0,maximum:20000}},['courseId']),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},_meta:{securitySchemes:[{type:'oauth2',scopes:[READ_SCOPE]}]},securitySchemes:[{type:'oauth2',scopes:[READ_SCOPE]}]},
 writeTool('record_academic_correction','本人確認済みの訂正を記録','科目詳細のrecord IDを使い、まなびメモに訂正履歴を追加。巡回情報は保持し、大学側は変更しない。',{recordId:string('科目詳細の記録ID'),correctionId:string('再送時に再利用する一意なID'),value:{type:'string',enum:[...correctionValues]},reason:string('本人報告の内容と訂正理由',500)}),
 writeTool('record_attendance','出席を記録','本人が実際の授業日と出席状況を確認した場合のみ。LMSの出席操作はしない。',{day,status:{type:'string',enum:['present','late','absent']},expectedStatus:{enum:[null,'present','late','absent'],description:'現在の記録。未記録はnull。'}}),
 writeTool('record_study','学習結果を記録','問題を自力で解けた場合と解説・ヒントを確認した場合を区別する。試験範囲だけならplanned。',{day,recordId:string('再送時に再利用する一意なID'),topic:string('学習範囲',160),outcome:{type:'string',enum:['planned','explanation','hinted','independent','retained']},minutes:{type:'integer',minimum:0,maximum:1440,description:'実際の勉強時間。不明なら省略。plannedは0。'}},['minutes']),
 writeTool('mark_assignment_submitted','提出済みを記録','既存課題を本人の報告で提出済みにする。LMSへの提出は実行しない。',{assignmentId:id,expectedStatus:{type:'string',enum:['todo','doing','done']}}),
 writeTool('add_assignment','課題を登録','大学資料・本人報告に基づく課題。科目・期限・出典が不明なら確認する。',{recordId:string('再送時に再利用する一意なID'),title:string('課題名',160),at:string('確定した締切日または日時。時刻を推測しない。',80),source:string('確認した情報源の名称',300)}),
 writeTool('add_exam','試験予定を登録','確定した試験情報のみ登録する。科目・日程・出典が不明なら確認する。',{recordId:string('再送時に再利用する一意なID'),title:string('試験名',160),at:string('確定した日付または日時',80),source:string('確認した情報源の名称',300)})
];
const kinds:Record<string,string>={record_academic_correction:'academic_correction',record_attendance:'attendance',record_study:'study',mark_assignment_submitted:'assignment_submitted',add_assignment:'assignment_create',add_exam:'exam_create'};
export function object(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==='object'&&!Array.isArray(value));}
export function toolCommand(name:string,args:unknown){
 const tool=academicTools.find(item=>item.name===name);
 if(!tool||!object(args))throw new Error('invalid_arguments');
 const schema=tool.inputSchema;
 const props=schema.properties as Record<string,Record<string,unknown>>;
 if(Object.keys(args).some(key=>!Object.hasOwn(props,key))||schema.required.some(key=>!Object.hasOwn(args,key)))throw new Error('invalid_arguments');
 for(const [key,value] of Object.entries(args)){
   const prop=props[key];
   if(prop.type==='string'&&(typeof value!=='string'||!value.trim()||(typeof prop.maxLength==='number'&&value.length>prop.maxLength)))throw new Error('invalid_arguments');
   if(prop.type==='integer'&&(typeof value!=='number'||!Number.isSafeInteger(value)||(typeof prop.minimum==='number'&&value<prop.minimum)||(typeof prop.maximum==='number'&&value>prop.maximum)))throw new Error('invalid_arguments');
   if(prop.const!==undefined&&value!==prop.const)throw new Error('invalid_arguments');
   if(Array.isArray(prop.enum)&&!prop.enum.includes(value))throw new Error('invalid_arguments');
 }
 if(name==='get_course_academic_detail')return {read:true as const,courseId:String(args.courseId),offset:Number(args.offset??0),term:undefined};
 if(name==='get_academic_summary')return {read:true as const,term:typeof args.term==='string'?args.term:undefined};
 const {expectedRevision,...command}=args;
 return {read:false as const,input:{expectedRevision,command:{...command,kind:kinds[name]}}};
}
export function compactSummary(body:unknown,term?:string){
 if(!object(body)||!object(body.data))return body;
 const data=body.data;
 const selected=term??(typeof data.activeTerm==='string'?data.activeTerm:'all');
 const rows=(value:unknown)=>Array.isArray(value)?value.filter(object):[];
 const courses=rows(data.courses).filter(row=>selected==='all'||row.term===selected);
 const ids=new Set(courses.map(row=>row.id));
 const limited:Record<string,number>={};
 function cap(key:string,list:Record<string,unknown>[],limit:number){if(list.length>limit)limited[key]=list.length-limit;return list.slice(0,limit);}
 const byDate=(list:Record<string,unknown>[],key:string,reverse=false)=>[...list].sort((a,b)=>(reverse?-1:1)*String(a[key]??'').localeCompare(String(b[key]??'')));
 return {...body,data:{universityCoverage:'unverified',activeTerm:data.activeTerm,selectedTerm:selected,
   courses:cap('courses',courses,100),
   assignments:cap('assignments',byDate(rows(data.assignments).filter(row=>ids.has(row.courseId)),'dueISO').sort((a,b)=>Number(a.status==='done')-Number(b.status==='done')),150),
   exams:cap('exams',byDate(rows(data.exams).filter(row=>ids.has(row.courseId)),'datetime'),100),
   attendance:cap('attendance',byDate(rows(data.attendance).filter(row=>ids.has(row.courseId)),'dateISO',true),150),
   learning:cap('learning',byDate(rows(data.learning).filter(row=>ids.has(row.courseId)),'day',true),150),
   classDates:cap('classDates',byDate(rows(data.classDates).filter(row=>ids.has(row.courseId)),'scheduledOn',true),100),
   university:cap('university',rows(data.university).filter(row=>selected==='all'||!row.term||row.term===selected),100),
   omittedCounts:limited,notice:'同期済みの記録だけです。大学側最新情報・未取得・未記録を確定扱いにしないでください。省略件数があれば全件ではありません。'}}
}
export function validModernHeaders(body:Record<string,unknown>,headers:Headers){
 const params=object(body.params)?body.params:{};const meta=object(params._meta)?params._meta:{};
 if(headers.get('MCP-Protocol-Version')!=='2026-07-28'||headers.get('Mcp-Method')!==body.method||meta['io.modelcontextprotocol/protocolVersion']!=='2026-07-28')return false;
 if(body.method==='tools/call'&&headers.get('Mcp-Name')!==params.name)return false;
 return true;
}
