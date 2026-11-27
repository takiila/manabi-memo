import { academicTools,compactSummary,object,toolCommand,validModernHeaders } from '../academic-mcp-model';
import { noStore,oauthConfig,verifyAcademicOAuth } from '@/lib/server/academic-oauth';
import { READ_SCOPE,WRITE_SCOPE } from '@/lib/server/academic-oauth-model';
import { readAcademicAccount,writeAcademicAccount } from '@/lib/server/academic-service';
const SERVER={name:'manabi-memo',title:'まなびメモ',version:'0.1.0'};
const MODERN='2026-07-28';
const LEGACY=['2025-11-25','2025-06-18','2025-03-26'];
const versions=[MODERN,...LEGACY];
function rpcError(id:unknown,code:number,message:string,status:number,data?:unknown){return noStore({jsonrpc:'2.0',id:id??null,error:{code,message,...(data?{data}:{})}},status);}
function rpcResult(id:unknown,result:Record<string,unknown>,modern:boolean){
 const meta=object(result._meta)?result._meta:{};
 return noStore({jsonrpc:'2.0',id,result:modern?{...result,_meta:{...meta,'io.modelcontextprotocol/serverInfo':SERVER}}:result});
}
function toolResult(id:unknown,payload:unknown,ok:boolean,modern:boolean,metadata?:Record<string,unknown>){
 const data=object(payload)?payload:{message:String(payload)};
 return rpcResult(id,{...(modern?{resultType:'complete'}:{}),content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError:!ok,...(metadata?{_meta:metadata}:{})},modern);
}
export function GET(){return new Response(null,{status:405,headers:{allow:'POST','cache-control':'no-store'}});}
export async function POST(request:Request){
 const config=oauthConfig();if(!config)return noStore({error:'ChatGPT連携はまだ有効化されていません。'},503);
 const origin=request.headers.get('origin');if(origin&&origin!==config.issuer&&origin!=='https://chatgpt.com')return noStore({error:'Forbidden origin'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return rpcError(null,-32600,'Expected JSON request',400);
 let body:unknown;
 try{const text=await request.text();if(text.length>32768)return rpcError(null,-32600,'Request too large',413);body=JSON.parse(text);}catch{return rpcError(null,-32700,'Parse error',400);}
 if(!object(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string'||(body.id!==undefined&&typeof body.id!=='string'&&!(typeof body.id==='number'&&Number.isSafeInteger(body.id))))return rpcError(null,-32600,'Invalid request',400);
 const id=body.id,method=body.method;
 const params=object(body.params)?body.params:{};
 const version=request.headers.get('MCP-Protocol-Version')??'2025-03-26';
 const modern=version===MODERN;
 if(!versions.includes(version))return rpcError(id,-32000,'Unsupported protocol version',400,{supported:versions});
 if(modern){
   if(!validModernHeaders(body,request.headers))return rpcError(id,-32020,'Header mismatch',400);
   if(!object(params._meta)||!object(params._meta['io.modelcontextprotocol/clientCapabilities']))return rpcError(id,-32602,'Missing client capabilities',400);
 }
 if(id===undefined){if(!modern&&method==='notifications/initialized')return new Response(null,{status:202});return rpcError(null,-32600,'Invalid notification',400);}
 if(!modern&&method==='initialize'){
   const negotiated=typeof params.protocolVersion==='string'&&LEGACY.includes(params.protocolVersion)?params.protocolVersion:LEGACY[0];
   return rpcResult(id,{protocolVersion:negotiated,capabilities:{tools:{listChanged:false}},serverInfo:SERVER,instructions:'最新大学情報は未照合。明示された本人確認を経てから登録する。'},false);
 }
 if(method==='ping')return rpcResult(id,{},modern);
 if(method==='tools/list')return rpcResult(id,{...(modern?{resultType:'complete',ttlMs:300000,cacheScope:'public'}:{}),tools:academicTools},modern);
 if(method!=='tools/call')return rpcError(id,-32601,'Method not found',404);
 const name=typeof params.name==='string'?params.name:'';
 let command:ReturnType<typeof toolCommand>;
 try{command=toolCommand(name,params.arguments??{});}catch{return rpcError(id,-32602,'Invalid tool arguments',400);}
 try{
   const auth=await verifyAcademicOAuth(request,config,!command.read);
   if(!auth){
     const scope=command.read?READ_SCOPE:READ_SCOPE+' '+WRITE_SCOPE;
     return toolResult(id,{error:'認証・連携権限を確認してください。データは変更していません。'},false,modern,{'mcp/www_authenticate':['Bearer resource_metadata="'+config.issuer+'/.well-known/oauth-protected-resource", scope="'+scope+'", error="invalid_token", error_description="Manabi authorization required"']});
   }
   const detail=command.read&&'courseId' in command&&command.courseId?{courseId:command.courseId,offset:command.offset??0}:undefined;
   const result=command.read?await readAcademicAccount(auth.accountId,detail):await writeAcademicAccount(auth.accountId,command.input,auth);
   const value=await result.json();
   return toolResult(id,command.read&&!detail&&result.ok?compactSummary(value,command.term):value,result.ok,modern);
 }catch{return toolResult(id,{error:'学業情報の取得・更新に失敗しました。成功したとは報告しないでください。'},false,modern);}
}
