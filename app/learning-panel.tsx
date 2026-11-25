'use client';
import { useState } from 'react';
import { addEvidence, dailyStudyPlan, OUTCOME_LABELS, reviewTopics, STUDY_OUTCOMES, studyDay, type StudyEvidence, type StudyOutcome } from './learning-model';
import type { AcademicPriority, PlannerCourse } from './planner-model';
export function LearningPanel({ courses, records, priorities, disabled, onRecord }: { courses: PlannerCourse[]; records: StudyEvidence[]; priorities: AcademicPriority[]; disabled:boolean; onRecord:(record:StudyEvidence)=>void }) {
  const [budget,setBudget]=useState(45);
  const [courseId,setCourseId]=useState('');
  const [topic,setTopic]=useState('');
  const [outcome,setOutcome]=useState<StudyOutcome>('explanation');
  const [minutes,setMinutes]=useState(0);
  const [error,setError]=useState('');
  const today=studyDay();
  const activeRecords=records.filter(row=>courses.some(c=>c.id===row.courseId));
  const topics=reviewTopics(activeRecords,today);
  const plan=dailyStudyPlan(priorities,topics,today,budget);
  const due=topics.filter(row=>row.reviewOn<=today);
  return <section className="planner-home-card" aria-label="学習計画と記録">
    <div className="planner-heading"><div><small>授業以外に使える時間で調整</small><h2>今日の学習プラン</h2></div></div>
    <div className="planner-tabs" aria-label="学習時間">{[15,45,90,150].map(value=><button key={value} type="button" aria-pressed={budget===value} onClick={()=>setBudget(value)}>{value}分</button>)}</div>
    {plan.blocks.length===0 && <p>登録済みの課題・復習候補がありません。試験範囲と大学の最新情報を確認してください。</p>}
    {plan.blocks.map((block,index)=><div key={index} className="home-todo-row"><span><strong>{block.title}</strong><small>{block.reason}</small></span><small>{block.minutes}分</small></div>)}
    <p>残り{plan.remaining}分は追加の学習や休息に使えます。出席・締切の必要性は時間枠で免除されません。これは作業の提案で、完了時刻の保証ではありません。</p>
    <details open={due.length>0 || undefined}><summary>復習候補（{due.length}件）・学習記録</summary>
      {topics.slice(0,20).map(row=><div key={row.id} className="home-todo-row"><span><strong>{row.topic}</strong><small>{courses.find(c=>c.id===row.courseId)?.title} · {OUTCOME_LABELS[row.outcome]} · 最終記録 {row.day}</small></span><small>復習目安 {row.reviewOn}</small></div>)}
      {topics.length>20 && <p>ほか{topics.length-20}件（直近の復習候補から表示）</p>}
      <form className="event-editor" onSubmit={event=>{
        event.preventDefault(); if(disabled)return;
        try{
          if(!courses.some(c=>c.id===courseId))throw new Error('科目を選択してください。');
          if(outcome==='retained' && !activeRecords.some(row=>row.courseId===courseId && row.topic.normalize('NFKC').trim()===topic.normalize('NFKC').trim() && row.day<today && ['independent','retained'].includes(row.outcome)))throw new Error('日を空けた自力解答は、以前の自力解答記録がある範囲で選択してください。');
          const record:StudyEvidence={id:crypto.randomUUID(),courseId,topic:topic.trim(),outcome,day:today,minutes,createdAt:new Date().toISOString()};
          addEvidence(records,record); onRecord(record); setTopic('');setMinutes(0);setOutcome('explanation');setError('');
        }catch(cause){setError(cause instanceof Error?cause.message:'記録を確認してください。');}
      }}>
        <h3>今日の学習結果を記録</h3>
        <fieldset disabled={disabled}>
          <label>科目<select value={courseId} onChange={e=>setCourseId(e.target.value)}><option value="">選択</option>{courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label>範囲・問題<input maxLength={160} value={topic} onChange={e=>setTopic(e.target.value)} placeholder="例：証明木"/></label>
          <label>解答結果<select value={outcome} onChange={e=>setOutcome(e.target.value as StudyOutcome)}>{STUDY_OUTCOMES.map(value=><option key={value} value={value}>{OUTCOME_LABELS[value]}</option>)}</select></label>
          <label>勉強時間（任意・分）<input type="number" min={0} max={1440} step={1} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>
          <button type="submit" disabled={!courseId || !topic.trim()}>学習結果を保存</button>
        </fieldset>{error && <p role="alert">{error}</p>}
      </form>
      <p>解説を見ただけでは自力解答と区別します。復習日は暫定的な目安です。</p>
    </details>
  </section>;
}
