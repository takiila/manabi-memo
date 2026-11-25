import { oauthConfig,noStore,issueCode,revokeAccountLinks } from '@/lib/server/academic-oauth';
import { authorizationRedirect,parseAuthorization } from '@/lib/server/academic-oauth-model';
import { isSameOriginRequest } from '@/lib/server/request-security';
import { accountForRequest } from '../../../server-auth-response';
export async function POST(request:Request){
  const c=oauthConfig();if(!c)return noStore({error:'ChatGPT連携はまだ有効化されていません。'},503);
  if(!isSameOriginRequest(request)||!/^Bearer [^ ]+$/.test(request.headers.get('authorization')??''))return noStore({error:'本人確認が必要です。'},403);
  const auth=await accountForRequest(request);if('response'in auth)return auth.response;
  try{
    const raw=await request.text();if(raw.length>8192)return noStore({error:'認証要求が大きすぎます。'},400);
    const body=JSON.parse(raw);
    if(body.expectedSubject!==auth.account.subject)return noStore({error:'表示中のアカウントと一致しません。'},409);
    if(body.action==='revoke'){await revokeAccountLinks(auth.account.id);return noStore({ok:true});}
    if(body.action!=='approve'||body.confirmed!==true||typeof body.query!=='string')return noStore({error:'権限を確認して許可してください。'},400);
    const input=parseAuthorization(new URLSearchParams(body.query),c);
    const code=await issueCode(auth.account,input);
    return noStore({redirect:authorizationRedirect(c,input,code)});
  }catch{return noStore({error:'認証要求を確認できません。'},400);}
}
