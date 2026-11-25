import 'server-only';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { queryOne, withTransaction, type DatabaseTransaction } from './database';
import { parseAllowedAccountEmails } from './account-access-policy';
import { configuredOAuth,hashToken,pkceMatches,one,READ_SCOPE,WRITE_SCOPE,type OAuthConfig,type AuthorizationInput } from './academic-oauth-model';
import type { AccountIdentity } from '../../app/account-server';

const ACCESS_MS=60*60*1000, LINK_MS=30*24*60*60*1000, CODE_MS=5*60*1000;
const secret=()=>randomBytes(32).toString('base64url');
export const noStore=(body:unknown,status=200,headers:Record<string,string>={})=>NextResponse.json(body,{status,headers:{'cache-control':'no-store','pragma':'no-cache',...headers}});
export function oauthConfig(){
  const allowed=parseAllowedAccountEmails(process.env.ALLOWED_ACCOUNT_EMAILS);
  if(!allowed.length||allowed.length>3||!process.env.FIREBASE_PROJECT_ID?.trim())return null;
  return configuredOAuth(process.env);
}
function allowed(email:string){return parseAllowedAccountEmails(process.env.ALLOWED_ACCOUNT_EMAILS).includes(email.toLowerCase());}
type Identity={user_id:string;identity_issuer:string;identity_subject:string;email:string;client_id:string;resource:string;scope:string;expires_at:number};
type CodeRow=Identity&{code_hash:string;redirect_uri:string;challenge:string;used_at:number|null};
type LinkRow=Identity&{id:string;revoked_at:number|null};
type TokenRow=LinkRow&{token_hash:string;token_expires_at:number;used_at:number|null;kind:string};
function validLink(row:LinkRow,config:OAuthConfig,now:number){return row.revoked_at===null&&row.expires_at>now&&row.client_id===config.clientId&&row.resource===config.resource&&allowed(row.email)&&row.scope.split(' ').includes(READ_SCOPE);}
async function identityStillLinked(tx:DatabaseTransaction,row:Identity){
  return Boolean((await tx.queryAll<{account_id:string}>('SELECT account_id FROM auth_identities WHERE issuer = ? AND subject = ? AND account_id = ?',[row.identity_issuer,row.identity_subject,row.user_id]))[0]);
}
export async function issueCode(account:AccountIdentity,input:AuthorizationInput){
  if(!allowed(account.email))throw new Error('access_denied');
  const code=secret(),now=Date.now();
  await withTransaction(async tx=>{
    await tx.execute('DELETE FROM academic_oauth_codes WHERE expires_at <= ?',[now]);
    await tx.execute('DELETE FROM academic_oauth_tokens WHERE link_id IN (SELECT id FROM academic_oauth_links WHERE expires_at <= ?)',[now]);
    await tx.execute('DELETE FROM academic_oauth_links WHERE expires_at <= ?',[now]);
    await tx.execute('INSERT INTO academic_oauth_codes (code_hash,user_id,identity_issuer,identity_subject,email,client_id,redirect_uri,resource,scope,challenge,expires_at,used_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)',[hashToken(code),account.id,account.issuer,account.subject,account.email,input.client_id,input.redirect_uri,input.resource,input.scope,input.code_challenge,now+CODE_MS]);
  });
  return code;
}
async function issueTokens(tx:DatabaseTransaction,link:LinkRow,now:number){
  const access=secret(),refresh=secret();const accessExpiry=Math.min(now+ACCESS_MS,link.expires_at);
  await tx.execute("INSERT INTO academic_oauth_tokens (token_hash,link_id,kind,expires_at,used_at) VALUES (?,?,'access',?,NULL)",[hashToken(access),link.id,accessExpiry]);
  await tx.execute("INSERT INTO academic_oauth_tokens (token_hash,link_id,kind,expires_at,used_at) VALUES (?,?,'refresh',?,NULL)",[hashToken(refresh),link.id,link.expires_at]);
  return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:Math.floor((accessExpiry-now)/1000),scope:link.scope};
}
export async function exchangeCode(params:URLSearchParams,config:OAuthConfig){
  const raw=one(params,'code'),verifier=one(params,'code_verifier'),redirect=one(params,'redirect_uri');
  if(!/^[A-Za-z0-9_-]{43}$/.test(raw)||redirect!==config.redirectUri||one(params,'resource')!==config.resource)return null;
  const now=Date.now();
  return withTransaction(async tx=>{
    const row=(await tx.queryAll<CodeRow>('SELECT * FROM academic_oauth_codes WHERE code_hash = ?',[hashToken(raw)]))[0];
    if(!row||row.used_at!==null||row.expires_at<=now||row.client_id!==config.clientId||row.resource!==config.resource||row.redirect_uri!==redirect||!allowed(row.email)||!pkceMatches(verifier,row.challenge)||!await identityStillLinked(tx,row))return null;
    const used=await tx.execute('UPDATE academic_oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?',[now,row.code_hash,now]);
    if(used.changes!==1)return null;
    const link:LinkRow={...row,id:crypto.randomUUID(),expires_at:now+LINK_MS,revoked_at:null};
    await tx.execute('INSERT INTO academic_oauth_links (id,user_id,identity_issuer,identity_subject,email,client_id,resource,scope,expires_at,revoked_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)',[link.id,link.user_id,link.identity_issuer,link.identity_subject,link.email,link.client_id,link.resource,link.scope,link.expires_at]);
    return issueTokens(tx,link,now);
  });
}
const TOKEN_SELECT='SELECT l.*, t.token_hash, t.kind, t.expires_at AS token_expires_at, t.used_at FROM academic_oauth_tokens t JOIN academic_oauth_links l ON l.id = t.link_id WHERE t.token_hash = ?';
export async function rotateRefresh(params:URLSearchParams,config:OAuthConfig){
  const raw=one(params,'refresh_token');const scope=one(params,'scope');
  if(!/^[A-Za-z0-9_-]{43}$/.test(raw)||one(params,'resource')!==config.resource)return null;
  const now=Date.now();
  return withTransaction(async tx=>{
    const row=(await tx.queryAll<TokenRow>(TOKEN_SELECT,[hashToken(raw)]))[0];
    if(!row||row.kind!=='refresh'||row.token_expires_at<=now||!validLink(row,config,now)||!await identityStillLinked(tx,row))return null;
    if(scope&&scope.split(/ +/).sort().join(' ')!==row.scope)return null;
    const revoke=()=>tx.execute('UPDATE academic_oauth_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',[now,row.id]);
    if(row.used_at!==null){await revoke();return null;}
    const used=await tx.execute('UPDATE academic_oauth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL',[now,row.token_hash]);
    if(used.changes!==1){await revoke();return null;}
    await tx.execute("UPDATE academic_oauth_tokens SET used_at = ? WHERE link_id = ? AND kind = 'access' AND used_at IS NULL",[now,row.id]);
    return issueTokens(tx,row,now);
  });
}
export async function revokeToken(raw:string,config:OAuthConfig){
  if(!/^[A-Za-z0-9_-]{43}$/.test(raw))return;
  await withTransaction(async tx=>{
    const row=(await tx.queryAll<TokenRow>(TOKEN_SELECT,[hashToken(raw)]))[0];
    if(row&&row.client_id===config.clientId&&row.resource===config.resource)await tx.execute('UPDATE academic_oauth_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',[Date.now(),row.id]);
  });
}
export async function revokeAccountLinks(accountId:string){
  await withTransaction(async tx=>{
    await tx.execute('UPDATE academic_oauth_links SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',[Date.now(),accountId]);
    await tx.execute('DELETE FROM academic_oauth_codes WHERE user_id = ?',[accountId]);
  });
}
export async function verifyAcademicOAuth(request:Request,config:OAuthConfig,write:boolean){
  const raw=/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!raw)return null;
  const row=await queryOne<TokenRow>(TOKEN_SELECT,[hashToken(raw)]),now=Date.now();
  if(!row||row.kind!=='access'||row.used_at!==null||row.token_expires_at<=now||!validLink(row,config,now)||(write&&!row.scope.split(' ').includes(WRITE_SCOPE)))return null;
  const identity=await queryOne<{account_id:string}>('SELECT account_id FROM auth_identities WHERE issuer = ? AND subject = ? AND account_id = ?',[row.identity_issuer,row.identity_subject,row.user_id]);
  return identity?{accountId:row.user_id,scope:row.scope,linkId:row.id}:null;
}
