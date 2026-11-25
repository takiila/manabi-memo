import type { Metadata } from 'next';
import { oauthConfig } from '@/lib/server/academic-oauth';
import { parseAuthorization,WRITE_SCOPE } from '@/lib/server/academic-oauth-model';
import { OAuthConsent } from './oauth-consent';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'まなびメモ・ChatGPT連携',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function ConnectPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const config=oauthConfig();
 if(!config)return <main className="planner-panel"><h1>ChatGPT連携</h1><p>連携はまだ有効化されていません。</p><a href="/">まなびメモへ戻る</a></main>;
 const raw=await searchParams;const params=new URLSearchParams();
 for(const [key,value] of Object.entries(raw))if(Array.isArray(value))value.forEach(item=>params.append(key,item));else if(typeof value==='string')params.set(key,value);
 if(!params.size)return <OAuthConsent query="" write={false} />;
 try{const parsed=parseAuthorization(params,config);return <OAuthConsent query={params.toString()} write={parsed.scope.split(' ').includes(WRITE_SCOPE)} />;}
 catch{return <main className="planner-panel"><h1>連携要求を確認できません</h1><p>不明な接続先には認証情報を送りません。</p><a href="/">まなびメモへ戻る</a></main>;}
}
