import { oauthConfig,noStore,revokeToken } from '@/lib/server/academic-oauth';
import { one,tokenClientAllowed } from '@/lib/server/academic-oauth-model';
export async function POST(request:Request){
 const c=oauthConfig();if(!c)return noStore({error:'temporarily_unavailable'},503);
 if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return noStore({error:'invalid_request'},400);
 try{
  const body=await request.text();if(body.length>8192)return noStore({error:'invalid_request'},400);
  const params=new URLSearchParams(body);
  if(!tokenClientAllowed(params,request.headers.get('authorization')??'',c))return noStore({error:'invalid_client'},401);
  await revokeToken(one(params,'token'),c);return noStore({});
 }catch{return noStore({error:'invalid_request'},400);}
}
