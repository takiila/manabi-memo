'use client';
import { useState } from 'react';
import { exportCoursePack, MAX_PACK_BYTES, PACK_GUIDE, parseCoursePack, planCourseImport, SAMPLE_PACK, type CoursePack, type TransferCourse } from './course-transfer';

export function CourseTransferPanel({courses,disabled,onApply}:{courses:TransferCourse[];disabled:boolean;onApply:(pack:CoursePack,updates:string[])=>void}){
 const [text,setText]=useState(''),[pack,setPack]=useState<CoursePack|null>(null),[updates,setUpdates]=useState<string[]>([]),[message,setMessage]=useState('');
 const [draft,setDraft]=useState({...SAMPLE_PACK.courses[0],code:'',title:'',instructor:'',assessment:'',notes:'',syllabusUrl:''});
 const [baseline,setBaseline]=useState('');
 const stale=Boolean(pack&&baseline!==JSON.stringify(courses));
 const rows=pack?planCourseImport(courses,pack):[];
 function edit(value:string){setText(value);setPack(null);setUpdates([]);setMessage('');}
 function preview(){try{setPack(parseCoursePack(text));setBaseline(JSON.stringify(courses));setUpdates([]);setMessage('追加と更新の内容を確認してください');}catch(e){setPack(null);setMessage(e instanceof Error?e.message:'読み込みに失敗しました');}}
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setMessage('コピーしました');}catch{edit(value);setMessage('コピーできませんでした。下のJSON欄から選択・コピーしてください');}}
 function download(){const blob=new Blob([JSON.stringify(exportCoursePack(courses),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`manabi-courses-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="course-transfer-panel" aria-label="講義JSONの入出力">
 <h2>時間割・講義情報のJSON</h2><p>別のPCでも同じJSONを読み込めます。既存のノート・PDF・付箋は残ります。ノートを含む移動には完全バックアップをご利用ください。</p>
 <details><summary>受け付ける形式・AIへの依頼文</summary><p>{PACK_GUIDE}</p><pre>{JSON.stringify(SAMPLE_PACK,null,2)}</pre></details>
 <div className="course-transfer-actions"><button type="button" onClick={()=>void copy(JSON.stringify(SAMPLE_PACK,null,2))}>見本JSONをコピー</button><button type="button" onClick={()=>void copy(`以下の資料をまなびメモ用JSONにしてください。推測せず、不明値は空欄にしてください。JSONのみ出力してください。\n${PACK_GUIDE}\n${JSON.stringify(SAMPLE_PACK,null,2)}\n資料：`)}>AIへの依頼文をコピー</button><button type="button" disabled={disabled||!courses.some(c=>!c.deletedAt&&!c.archivedAt)} onClick={download}>講義JSONを書き出す</button></div>
 <details><summary>フォームで講義をJSONに追加</summary><div className="course-transfer-form">
 {(['term','code','title','instructor','room','assessment','notes','syllabusUrl'] as const).map((key,i)=><label key={key}>{['年度・学期','科目コード','科目名','担当教員','教室','評価方法・注意事項','自由メモ','シラバスURL'][i]}<input value={draft[key]??''} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></label>)}
 <label>単位数<input type="number" min="0" max="30" step="0.5" value={draft.credits??''} onChange={e=>setDraft({...draft,credits:e.target.value===''?null:Number(e.target.value)})}/></label>
 <label>曜日<select value={draft.weekday??''} onChange={e=>setDraft({...draft,weekday:e.target.value?Number(e.target.value):null,period:e.target.value?(draft.period??1):null})}><option value="">未定</option>{['月','火','水','木','金','土'].map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select></label>
 <label>授業枠<select disabled={draft.weekday===null} value={draft.period??''} onChange={e=>setDraft({...draft,period:Number(e.target.value)})}><option value="">未定</option>{['08:40〜10:10','10:20〜11:50','12:40〜14:10','14:20〜15:50','16:00〜17:30'].map((t,i)=><option key={t} value={i+1}>{t}</option>)}</select></label>
 </div><button type="button" onClick={()=>{try{const current=text.trim()?parseCoursePack(text):{...SAMPLE_PACK,courses:[]};const next=parseCoursePack(JSON.stringify({...current,courses:[...current.courses,draft]}));edit(JSON.stringify(next,null,2));setMessage('JSONに追加しました。内容確認後に取り込んでください');}catch(e){setMessage(e instanceof Error?e.message:'入力を確認してください');}}}>この講義をJSONに追加</button></details>
 <label>JSONファイルを選択<input type="file" accept=".json,application/json" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.size>MAX_PACK_BYTES){setMessage('JSONは1MB以内にしてください');return;}try{edit(await f.text());}catch{setMessage('ファイルを読めませんでした');}}}/></label>
 <label>JSONを貼り付け<textarea rows={10} value={text} onChange={e=>edit(e.target.value)} spellCheck={false}/></label>
 <button type="button" onClick={preview} disabled={disabled}>取り込み内容を確認</button>
 <p role="status">{message}</p>
 {stale&&<p role="alert">確認後に講義データが変わりました。「取り込み内容を確認」をもう一度押してください。</p>}
 {pack&&<div><p>追加 {rows.filter(r=>r.kind==='add').length} 件。更新はチェックした講義だけ適用します。チェックした講義の空欄は既存値を消します。</p>{rows.map(r=><div className="course-import-row" key={r.key}><strong>{r.course.title} — {r.course.term}</strong><p>{r.kind==='add'?'新規追加':r.kind==='same'?'変更なし':r.kind==='blocked'?'適用不可':'更新候補'}</p>{r.warning&&<p role="alert">{r.warning}</p>}{r.kind==='update'&&<><label><input type="checkbox" checked={updates.includes(r.key)} onChange={e=>setUpdates(e.target.checked?[...updates,r.key]:updates.filter(k=>k!==r.key))}/>JSONの講義情報で更新する</label><details><summary>現在の情報</summary><pre>{JSON.stringify(exportCoursePack(courses.filter(c=>c.id===r.existingId)).courses[0],null,2)}</pre></details></>}<details><summary>取り込む情報</summary><pre>{JSON.stringify(r.course,null,2)}</pre></details></div>)}<button type="button" disabled={disabled||stale||rows.some(r=>r.kind==='blocked')||!rows.some(r=>r.kind==='add'||updates.includes(r.key))} onClick={()=>{if(stale)return;onApply(pack,updates);setPack(null);setUpdates([]);setMessage('講義情報を反映しました。画面上部の保存状態をご確認ください');}}>確認した内容を適用</button></div>}
 </section>;
}
