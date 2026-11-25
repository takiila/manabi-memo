import { oauthConfig,noStore } from '@/lib/server/academic-oauth';
import { READ_SCOPE,WRITE_SCOPE } from '@/lib/server/academic-oauth-model';
export function GET(){const c=oauthConfig();return c?noStore({resource:c.resource,authorization_servers:[c.issuer],scopes_supported:[READ_SCOPE,WRITE_SCOPE],bearer_methods_supported:['header']}):noStore({error:'not_configured'},503);}
