import { NextResponse } from 'next/server';
import { accountForRequest } from '../../server-auth-response';
import { readAcademicAccount,writeAcademicAccount } from '@/lib/server/academic-service';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'no-store'}});
async function authorize(request:Request){
  if(process.env.MANABI_ACADEMIC_API_ENABLED!=='true')return {response:json({error:'学業連携APIは無効です。'},503)} as const;
  if(!/^Bearer [^ ]+$/.test(request.headers.get('authorization')??''))return {response:json({error:'認証が必要です。'},401)} as const;
  return accountForRequest(request);
}
export async function GET(request:Request){
  const auth=await authorize(request);
  if('response'in auth)return auth.response;
  return readAcademicAccount(auth.account.id);
}
export async function POST(request:Request){
  const auth=await authorize(request);
  if('response'in auth)return auth.response;
  try{
    const text=await request.text();
    if(new TextEncoder().encode(text).length>16384)return json({error:'操作が大きすぎます。'},413);
    return writeAcademicAccount(auth.account.id,JSON.parse(text));
  }catch{return json({error:'操作を読み取れません。'},400);}
}
