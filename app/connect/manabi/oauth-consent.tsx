'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {authenticatedFetch,observeFirebaseUser,signInWithGoogle} from '../../firebase-auth-client';
type Person={uid:string;email:string|null};
export function OAuthConsent({query,write}:{query:string;write:boolean}){
 const [person,setPerson]=useState<Person|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 useEffect(()=>{
   let stopped=false;let dispose:(()=>void)|undefined;
   void observeFirebaseUser(user=>{if(!stopped)setPerson(user?{uid:user.uid,email:user.email}:null);}).then(fn=>{if(stopped)fn();else dispose=fn;}).catch(()=>{if(!stopped)setError('ログイン情報を確認できません。');});
   return()=>{stopped=true;dispose?.();};
 },[]);
 async function run(action:'approve'|'revoke'){
   if(!person||busy)return;
   setBusy(true);setError('');setMessage('');
   try{
     const response=await authenticatedFetch('/api/academic-oauth/authorize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,expectedSubject:person.uid,confirmed:true,query})});
     const data=await response.json();
     if(!response.ok)throw new Error(data.error??'操作できませんでした。');
     if(action==='approve'&&typeof data.redirect==='string'&&new URL(data.redirect).origin==='https://chatgpt.com'){window.location.assign(data.redirect);return;}
     if(action==='revoke'&&data.ok===true)setMessage('このアカウントのChatGPT連携を解除しました。');
   }catch(cause){setError(cause instanceof Error?cause.message:'操作できませんでした。');}finally{setBusy(false);}
 }
 return <main className="planner-panel" style={{maxWidth:600,margin:'2rem auto',padding:'1rem'}}>
  <h1>まなびメモ × ChatGPT</h1>
  <p>対象は同期済みの履修科目・課題・試験・出席・学習記録のみです。ノート本文、PDF、認証情報、GPAは共有しません。</p>
  {person?<p>対象アカウント：{person.email??'メール未確認'}</p>:<><p>まなびメモと同じアカウントでログインしてください。</p><button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await signInWithGoogle();}catch{setError('ログインできませんでした。');}finally{setBusy(false);}}}>Googleでログイン</button><p><Link href="/" target="_blank" rel="noreferrer">メールでのログインはまなびメモから行う</Link></p></>}
  {query&&<><h2>許可する操作</h2><p>学業情報の読み取り</p>{write&&<p>出席・課題・試験・学習記録の登録と限定的な更新（本人確認後のみ）</p>}<p>大学LMSを操作する権限はありません。クラウドに同期していない情報は取得できません。</p><button type="button" disabled={!person||!person.email||busy} onClick={()=>void run('approve')}>確認して連携を許可</button></>}
  {!query&&<><h2>連携の解除</h2><p>現在のアカウントのすべてのChatGPT連携を無効にします。学業データは削除しません。</p><button type="button" disabled={!person||busy} onClick={()=>void run('revoke')}>連携を解除</button></>}
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}<p><Link href="/">まなびメモに戻る</Link></p>
 </main>;
}
