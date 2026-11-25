import { oauthConfig,noStore,exchangeCode,rotateRefresh } from '@/lib/server/academic-oauth';
import { one,tokenClientAllowed } from '@/lib/server/academic-oauth-model';
export async function POST(request:Request){
  const c=oauthConfig();if(!c)return noStore({error:'temporarily_unavailable'},503);
  if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return noStore({error:'invalid_request'},400);
  try{
    const body=await request.text();if(body.length>8192)return noStore({error:'invalid_request'},400);
    const params=new URLSearchParams(body);
    if(!tokenClientAllowed(params,request.headers.get('authorization')??'',c))return noStore({error:'invalid_client'},401);
    const grant=one(params,'grant_type');
    if(grant!=='authorization_code'&&grant!=='refresh_token')return noStore({error:'unsupported_grant_type'},400);
    const token=grant==='authorization_code'?await exchangeCode(params,c):await rotateRefresh(params,c);
    return token?noStore(token):noStore({error:'invalid_grant'},400);
  }catch{return noStore({error:'invalid_request'},400);}
}
