import { createHash, timingSafeEqual } from 'node:crypto';
export const READ_SCOPE='manabi.read';
export const WRITE_SCOPE='manabi.write';
export type OAuthConfig={issuer:string;resource:string;clientId:string;redirectUri:string;clientSecret:string};
export type AuthorizationInput={client_id:string;redirect_uri:string;response_type:string;resource:string;scope:string;state:string;code_challenge:string;code_challenge_method:string};
export function configuredOAuth(env:Record<string,string|undefined>):OAuthConfig|null{
  if(env.MANABI_MCP_ENABLED!=='true')return null;
  try{
    const issuer=new URL(env.MANABI_MCP_ORIGIN??'');
    const redirect=new URL(env.MANABI_MCP_REDIRECT_URI??'');
    const clientId=env.MANABI_MCP_CLIENT_ID??'';
    const clientSecret=env.MANABI_MCP_CLIENT_SECRET??'';
    if(issuer.protocol!=='https:'||issuer.href!==issuer.origin+'/'||issuer.username||issuer.password||
       redirect.origin!=='https://chatgpt.com'||redirect.username||redirect.password||redirect.search||redirect.hash||
       !(/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(redirect.pathname)||redirect.pathname==='/connector_platform_oauth_redirect')||
       !/^[A-Za-z0-9._-]{8,128}$/.test(clientId)||(clientSecret&&clientSecret.length<32))return null;
    return {issuer:issuer.origin,resource:issuer.origin+'/mcp',clientId,redirectUri:redirect.href,clientSecret};
  }catch{return null;}
}
export function sameSecret(a:string,b:string){const left=Buffer.from(a);const right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
export function hashToken(value:string){return createHash('sha256').update(value).digest('hex');}
export function pkceMatches(verifier:string,challenge:string){
  if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||!/^[-_A-Za-z0-9]{43}$/.test(challenge))return false;
  return sameSecret(createHash('sha256').update(verifier).digest('base64url'),challenge);
}
export function one(params:URLSearchParams,key:string){const all=params.getAll(key);if(all.length>1)throw new Error('duplicate_parameter');return all[0]??'';}
export function parseAuthorization(params:URLSearchParams,config:OAuthConfig):AuthorizationInput{
  const scope=one(params,'scope')||READ_SCOPE;
  const list=scope.split(/ +/);
  if(!list.includes(READ_SCOPE)||new Set(list).size!==list.length||list.some(value=>value!==READ_SCOPE&&value!==WRITE_SCOPE))throw new Error('invalid_scope');
  const value={client_id:one(params,'client_id'),redirect_uri:one(params,'redirect_uri'),response_type:one(params,'response_type'),resource:one(params,'resource'),scope:list.sort().join(' '),state:one(params,'state'),code_challenge:one(params,'code_challenge'),code_challenge_method:one(params,'code_challenge_method')};
  if(value.client_id!==config.clientId||value.redirect_uri!==config.redirectUri||value.resource!==config.resource||value.response_type!=='code'||value.code_challenge_method!=='S256'||!/^[-_A-Za-z0-9]{43}$/.test(value.code_challenge)||!value.state||value.state.length>1024)throw new Error('invalid_request');
  return value;
}
export function authorizationRedirect(config:OAuthConfig,input:AuthorizationInput,code:string){
  const url=new URL(config.redirectUri);url.searchParams.set('code',code);url.searchParams.set('state',input.state);url.searchParams.set('iss',config.issuer);return url.toString();
}
export function tokenClientAllowed(params:URLSearchParams,authorization:string,config:OAuthConfig){
  const suppliedId=one(params,'client_id');const suppliedSecret=one(params,'client_secret');
  if(authorization){
    if(!config.clientSecret||suppliedSecret)return false;
    const match=authorization.match(/^Basic ([A-Za-z0-9+/=]+)$/i);if(!match)return false;
    try{
      const raw=Buffer.from(match[1],'base64').toString('utf8');const split=raw.indexOf(':');if(split<0)return false;
      const id=decodeURIComponent(raw.slice(0,split).replace(/\+/g,' '));const secret=decodeURIComponent(raw.slice(split+1).replace(/\+/g,' '));
      return id===config.clientId&&(!suppliedId||suppliedId===id)&&sameSecret(secret,config.clientSecret);
    }catch{return false;}
  }
  return suppliedId===config.clientId&&(config.clientSecret?sameSecret(suppliedSecret,config.clientSecret):!suppliedSecret);
}
