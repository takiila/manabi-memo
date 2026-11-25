import { isPlannerDate } from './planner-model.ts';
import { normalizeStudyEvidence, type StudyEvidence } from './learning-model.ts';

function record(value:unknown):value is Record<string,unknown>{return Boolean(value&&typeof value==='object'&&!Array.isArray(value));}
function rows(value:unknown):Record<string,unknown>[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.some(item=>!record(item)))throw new Error('保存データの形式を確認できません。');
  return value;
}
function required(value:unknown,max=180):string {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('対象を特定できません。');
  return value.trim();
}
function fields(row:Record<string,unknown>, keys:string[]){return Object.fromEntries(keys.flatMap(key=>typeof row[key]==='string'||typeof row[key]==='number'||row[key]===null?[[key,row[key]]]:[]));}
function activeCourses(state:Record<string,unknown>){return rows(state.courses).filter(row=>!row.deletedAt&&!row.archivedAt);}
export function academicSnapshot(state:unknown) {
  if(!record(state)||!record(state.campus))throw new Error('学業データを確認できません。');
  const courses=activeCourses(state);
  const ids=new Set(courses.map(row=>row.id));
  const scoped=(value:unknown)=>rows(value).filter(row=>ids.has(row.courseId));
  const inbox=record(state.inbox)?rows(state.inbox.records):[];
  const university=inbox.flatMap(row=>{
    const item=record(row.item)?row.item:null;
    if(!item||!['event','assignment','deadline','exam','registration','announcement'].includes(String(item.type)))return [];
    const data=record(item.data)?item.data:{};
    const extensions=record(item.extensions)?item.extensions:{};
    return [{...fields(item,['id','title','type','term']),source:record(item.source)?fields(item.source,['title','kind']):{},dates:fields(data,['starts_at','ends_at','due_at','opens_at','closes_at','published_at','course_code']),calendarRule:fields(extensions,['x-class-calendar','x-class-weekday']),needsReview:item.needs_review===true,updatedAt:typeof row.updatedAt==='string'?row.updatedAt:null}];
  });
  return {
    universityCoverage:'unverified',
    activeTerm:typeof state.activeTerm==='string'?state.activeTerm:null,
    courses:courses.map(row=>fields(row,['id','title','term','code','weekday','period','room'])),
    assignments:scoped(state.campus.assignments).map(row=>fields(row,['id','courseId','title','dueISO','status','importance','estimatedMinutes'])),
    exams:scoped(state.campus.exams).map(row=>fields(row,['id','courseId','title','datetime','examType','location'])),
    attendance:scoped(state.campus.attendanceRecords).map(row=>fields(row,['id','courseId','dateISO','period','status'])),
    university,
    classDates:rows(state.sessions).filter(row=>ids.has(row.courseId)&&!row.deletedAt&&typeof row.scheduledOn==='string'&&row.scheduledOn).map(row=>fields(row,['courseId','id','scheduledOn','sessionNumber'])),
    learning:normalizeStudyEvidence(state.campus.studyEvidence).filter(row=>ids.has(row.courseId)).map(row=>fields(row,['id','courseId','topic','day','outcome','minutes'])),
  };
}
export function applyAcademicCommand(state:unknown,command:unknown,today:string,createdAt:string) {
  if(!record(state)||!record(state.campus)||!record(command)||command.confirmed!==true)throw new Error('本人が確認した操作のみ登録できます。');
  const campus=state.campus;
  const courseId=required(command.courseId);
  const courses=activeCourses(state).filter(row=>row.id===courseId);
  if(courses.length!==1)throw new Error('科目を一意に特定できません。');
  const course=courses[0];
  const replace=(key:string,value:unknown)=>({...state,campus:{...campus,[key]:value}});
  if(command.kind==='assignment_create'||command.kind==='exam_create'){
    const isExam=command.kind==='exam_create';
    const id=required(command.recordId);
    const title=required(command.title,160);
    const date=required(command.at,80);
    const source=required(command.source,300);
    if(!isPlannerDate(date,false))throw new Error('日時を確認してください。');
    const key=isExam?'exams':'assignments';
    const dateKey=isExam?'datetime':'dueISO';
    const list=rows(campus[key]);
    const existing=list.find(row=>row.id===id);
    if(existing){
      if(existing.courseId===courseId&&existing.title===title&&existing[dateKey]===date)return state;
      throw new Error('同じIDの記録があります。');
    }
    if(list.some(row=>row.courseId===courseId&&typeof row.title!=='string'))throw new Error('保存済みの件名を確認してください。');
    if(list.some(row=>row.courseId===courseId&&typeof row.title==='string'&&row.title.normalize('NFKC').trim()===title.normalize('NFKC')))throw new Error('同名の記録があります。再取得して重複を確認してください。');
    const base={id,courseId,termId:typeof course.term==='string'?course.term:'学期未設定',title,[dateKey]:date,note:'出典：'+source,createdAt};
    const next=isExam?{...base,examType:'other',location:''}:{...base,status:'todo',type:'課題',importance:2,estimatedMinutes:0};
    return replace(key,[...list,next]);
  }
  if(command.kind==='assignment_submitted'){
    const id=required(command.assignmentId);
    const assignments=rows(campus.assignments);
    const matches=assignments.filter(row=>row.id===id&&row.courseId===courseId);
    if(matches.length!==1)throw new Error('課題を一意に特定できません。');
    const previous=matches[0];
    if(previous.status==='done')return state;
    if(previous.status!==command.expectedStatus||!['todo','doing'].includes(String(previous.status)))throw new Error('提出状態が変更されています。再確認してください。');
    return replace('assignments',assignments.map(row=>row===previous?{...row,status:'done'}:row));
  }
  if(command.kind==='attendance'){
    const day=required(command.day,10);
    const status=command.status;
    if(day.length!==10||!isPlannerDate(day,false)||day>today||!['present','late','absent'].includes(String(status)))throw new Error('授業日・出席状況を確認してください。');
    const attendance=rows(campus.attendanceRecords);
    const matches=attendance.filter(row=>row.courseId===courseId&&row.dateISO===day);
    if(matches.length>1)throw new Error('出席記録が重複しています。');
    const previous=matches[0];
    if(previous?.status===status)return state;
    if((previous?.status??null)!==command.expectedStatus)throw new Error('出席状態が変更されています。再確認してください。');
    const id=previous?.id??('attendance-'+courseId+'-'+day);
    if(!previous&&attendance.some(row=>row.id===id))throw new Error('出席IDが重複しています。');
    const next={...previous,id,courseId,dateISO:day,period:previous?.period??(typeof course.period==='number'?course.period:null),status,createdAt:previous?.createdAt??createdAt};
    return replace('attendanceRecords',previous?attendance.map(row=>row===previous?next:row):[...attendance,next]);
  }
  if(command.kind==='study'){
    const day=required(command.day,10);
    if(day.length!==10||!isPlannerDate(day,false)||day>today)throw new Error('学習日を確認してください。');
    const id=required(command.recordId);
    const history=normalizeStudyEvidence(campus.studyEvidence);
    const candidate={id,courseId,topic:required(command.topic,160),outcome:command.outcome,day,minutes:command.minutes??0,createdAt};
    const [next]=normalizeStudyEvidence([candidate]);
    const previous=history.find(row=>row.id===id);
    if(previous){
      const equal=(row:StudyEvidence)=>JSON.stringify([row.courseId,row.topic,row.outcome,row.day,row.minutes]);
      if(equal(previous)===equal(next))return state;
      throw new Error('学習記録IDが既に使われています。');
    }
    if(next.outcome==='retained'&&!history.some(row=>row.courseId===courseId&&row.topic.normalize('NFKC')===next.topic.normalize('NFKC')&&row.day<day&&['independent','retained'].includes(row.outcome)))throw new Error('以前の自力解答記録を確認してください。');
    return replace('studyEvidence',normalizeStudyEvidence([...history,next]));
  }
  throw new Error('未対応の操作です。');
}
