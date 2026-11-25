import { NextResponse } from 'next/server';
import { queryOne, withTransaction } from '@/lib/server/database';
import { accountForRequest } from '../../server-auth-response';
import { academicSnapshot, applyAcademicCommand } from '../../academic-api-model';
import { pdfVersionsFromState } from '../../pdf-sync-model';

type StateRow={revision:number;schema_version:number;payload:string;updated_at:number;deleted_at:number|null;sync_complete:number;pdf_manifest:string};
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'no-store'}});
const select='SELECT revision, schema_version, payload, updated_at, deleted_at, sync_complete, pdf_manifest FROM synced_app_state WHERE user_id = ?';
async function authorize(request:Request){
  // Explicit deployment opt-in and Firebase bearer only; no cookie/legacy-header access.
  if(process.env.MANABI_ACADEMIC_API_ENABLED!=='true')return {response:json({error:'学業連携APIは無効です。'},503)} as const;
  if(!/^Bearer [^ ]+$/.test(request.headers.get('authorization')??''))return {response:json({error:'認証が必要です。'},401)} as const;
  return accountForRequest(request);
}
function read(row:StateRow|null){
  if(!row||row.deleted_at!==null||Number(row.sync_complete)!==1)throw new Error('同期済みの学業データがありません。');
  if(row.schema_version>16)throw new Error('保存形式が新しいため読み取れません。');
  return JSON.parse(row.payload) as unknown;
}
export async function GET(request:Request){
  const auth=await authorize(request);
  if('response'in auth)return auth.response;
  try{
    const row=await queryOne<StateRow>(select,[auth.account.id]);
    const state=read(row);
    return json({ok:true,revision:row!.revision,syncedAt:new Date(row!.updated_at).toISOString(),coverage:'synced-snapshot-only',data:academicSnapshot(state)});
  }catch{return json({error:'同期済みの学業情報を取得できません。'},409);}
}
export async function POST(request:Request){
  const auth=await authorize(request);
  if('response'in auth)return auth.response;
  try{
    const text=await request.text();
    if(new TextEncoder().encode(text).length>16384)return json({error:'操作が大きすぎます。'},413);
    const body=JSON.parse(text);
    if(!body||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1)return json({error:'同期版を指定してください。'},400);
    const accountId=auth.account.id;
    return await withTransaction(async tx=>{
      const row=(await tx.queryAll<StateRow>(select,[accountId]))[0]??null;
      const state=read(row);
      if(row!.revision!==body.expectedRevision)return json({error:'別の端末で更新されました。再取得してください。'},409);
      // Never bypass PDF revision/object integrity. This initial API only supports PDF-free/reference-only snapshots.
      const manifest=JSON.parse(row!.pdf_manifest);
      const pdfRows=await tx.queryAll<{session_id:string}>('SELECT session_id FROM synced_pdf WHERE user_id = ? LIMIT 1',[accountId]);
      const pending=await tx.queryAll<{id:string}>("SELECT id FROM sync_transactions WHERE user_id = ? AND status = 'pending' LIMIT 1",[accountId]);
      if(!Array.isArray(manifest)||manifest.length||Object.keys(pdfVersionsFromState(state)).length||pdfRows.length||pending.length)return json({error:'PDF同期または同期処理中のため直接更新できません。'},409);
      const now=new Date();
      const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
      const next=applyAcademicCommand(state,body.command,today,now.toISOString());
      if(next===state)return json({ok:true,changed:false,revision:row!.revision});
      const payload=JSON.stringify(next);
      if(new TextEncoder().encode(payload).length>4500000)return json({error:'同期容量を超えています。'},413);
      const updated=await tx.execute("UPDATE synced_app_state SET payload = ?, revision = ?, schema_version = ?, updated_at = ?, updated_by = 'academic-api' WHERE user_id = ? AND revision = ? AND deleted_at IS NULL AND sync_complete = 1",[payload,row!.revision+1,16,now.getTime(),accountId,row!.revision]);
      if(updated.changes!==1)return json({error:'同期版が変わりました。'},409);
      return json({ok:true,changed:true,revision:row!.revision+1});
    });
  }catch(cause){return json({error:cause instanceof Error && /^(本人|対象|科目|課題|提出|授業|出席|学習|以前|未対応|保存|同期済み)/.test(cause.message)?cause.message:'操作を登録できませんでした。'},400);}
}
