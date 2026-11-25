'use client';
import {useEffect,useRef,useState} from 'react';
import type {AcademicPriority} from './planner-model';
export function AcademicAlerts({items,disabled}:{items:AcademicPriority[];disabled:boolean}) {
  const [enabled,setEnabled]=useState(false);
  const [message,setMessage]=useState('');
  const last=useRef('');
  const urgent=items.filter(item=>item.group==='urgent' && !item.id.startsWith('study:'));
  const signature=urgent.map(item=>item.id+':'+item.at).sort().join('|');
  useEffect(()=>{
    if(!enabled || disabled || !signature || typeof Notification==='undefined')return;
    function notify(){
      if(document.visibilityState!=='visible'||Notification.permission!=='granted'||last.current===signature)return;
      try{
        new Notification('まなびメモ',{body:'近日の重要な予定・提出期限を確認してください。'});
        last.current=signature;
      }catch{/* The in-app list remains available on unsupported platforms. */}
    }
    notify(); const timer=window.setInterval(notify,60000);
    document.addEventListener('visibilitychange',notify);
    return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',notify);};
  },[enabled,disabled,signature]);
  return <div className="todo-detail">
    <p>今日・明日の重要情報：{urgent.length}件（登録済み・未照合の情報を含む）</p>
    <button type="button" disabled={disabled} onClick={async()=>{
      if(enabled){setEnabled(false);setMessage('通知を停止しました。');return;}
      if(typeof Notification==='undefined'){setMessage('この端末ではブラウザー通知に対応していません。画面内の注意事項を確認してください。');return;}
      try{
        const permission=await Notification.requestPermission();
        setEnabled(permission==='granted');
        setMessage(permission==='granted'?'通知を有効にしました。アプリを開いている間のみ確認します。':'通知が許可されていません。');
      }catch{setMessage('通知を設定できませんでした。');}
    }}>{enabled?'この利用中の通知を停止':'この利用中の通知を有効化'}</button>
    <p>アプリを閉じている間の通知やLMSの新着確認はまだできません。</p>
    {message&&<p role="status">{message}</p>}
  </div>;
}
