import { oauthConfig,noStore } from '@/lib/server/academic-oauth';
import { READ_SCOPE,WRITE_SCOPE } from '@/lib/server/academic-oauth-model';
export function GET(){
  const c=oauthConfig();if(!c)return noStore({error:'not_configured'},503);
  return noStore({issuer:c.issuer,authorization_endpoint:c.issuer+'/connect/manabi',token_endpoint:c.issuer+'/api/academic-oauth/token',revocation_endpoint:c.issuer+'/api/academic-oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:c.clientSecret?['client_secret_basic','client_secret_post']:['none'],revocation_endpoint_auth_methods_supported:c.clientSecret?['client_secret_basic','client_secret_post']:['none'],scopes_supported:[READ_SCOPE,WRITE_SCOPE],authorization_response_iss_parameter_supported:true});
}
