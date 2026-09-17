import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoursePack, planCourseImport, applyCourseImport, exportCoursePack } from '../app/course-transfer.ts';
const pack = () => ({format:'manabi-course-pack',version:1,courses:[{code:'CS101',term:'2026後期',title:'情報入門',weekday:1,period:3,credits:2,assessment:'試験70%、課題30%'}]});
test('reimport preserves identity and existing notes; updates require explicit selection',()=>{
 const p=parseCoursePack(JSON.stringify(pack()));
 const first=applyCourseImport([],planCourseImport([],p),[]);
 const existing=[{...first[0],room:'手修正',privateExtra:'既存の関連データ'}];
 const plan=planCourseImport(existing,p);
 assert.equal(plan[0].kind,'update');
 assert.deepEqual(applyCourseImport(existing,plan,[]),existing);
 const next=applyCourseImport(existing,plan,[plan[0].key]);
 assert.equal(next.length,1); assert.equal(next[0].id,first[0].id);
 assert.equal(next[0].privateExtra,'既存の関連データ');
 assert.equal(next[0].room,''); assert.equal(next[0].assessment,'試験70%、課題30%');
 assert.equal(parseCoursePack(JSON.stringify(exportCoursePack(next))).courses[0].code,'CS101');
});
test('two incoming codes cannot overwrite the same legacy course',()=>{
 const p=pack();p.courses.push({...p.courses[0],code:'CS102'});
 const existing=[{id:'old',title:'情報入門',term:'2026後期',instructor:'',room:'',weekday:1,period:3,createdAt:'2026-01-01'}];
 const rows=planCourseImport(existing,parseCoursePack(JSON.stringify(p)));
 assert.ok(rows.every(r=>r.kind==='blocked'));
 assert.deepEqual(applyCourseImport(existing,rows,rows.map(r=>r.key)),existing);
});
test('rejects unsupported, unsafe and ambiguous input',()=>{
 for(const change of [{weekday:8},{period:9},{credits:-1},{syllabusUrl:'javascript:alert(1)'},{title:''},{surprise:true}]){
  const p=pack(); Object.assign(p.courses[0],change); assert.throws(()=>parseCoursePack(JSON.stringify(p)));
 }
 const p=pack();p.courses.push({...p.courses[0]});assert.throws(()=>parseCoursePack(JSON.stringify(p)));
 assert.throws(()=>parseCoursePack(JSON.stringify({...pack(),version:2})));
});
test('legacy title matching adopts code without duplicating; archived courses are blocked',()=>{
 const existing=[{id:'old',title:'情報入門',term:'2026後期',instructor:'',room:'',weekday:1,period:3,createdAt:'2026-01-01'}];
 const p=parseCoursePack(JSON.stringify(pack()));
 const plan=planCourseImport(existing,p);assert.equal(plan[0].kind,'update');
 assert.equal(applyCourseImport(existing,plan,[plan[0].key])[0].id,'old');
 assert.equal(planCourseImport([{...existing[0],deletedAt:'2026-09-01'}],p)[0].kind,'blocked');
});
