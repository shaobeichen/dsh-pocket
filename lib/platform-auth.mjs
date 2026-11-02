import { randomUUID } from 'node:crypto';

/** Optional platform adapter; native v2 API credentials remain the only upstream token protocol. */
export function createPocketActorAdapter(ctx, {required: explicit = false} = {}) {
  let platformRequired = explicit || !!ctx.get?.('platformAccess');
  const required = () => {
    if (ctx.get?.('platformAccess')) platformRequired = true;
    return platformRequired;
  };
  const authorize = (request, upstreamHeaders) => {
    if (!required()) return null;
    const access=ctx.get?.('platformAccess'), connection=ctx.get?.('connection');
    if (!access || typeof connection?.createActorApiCredential!=='function' || typeof connection?.verifyRegisteredActorCredential!=='function') throw new Error('Native actor credentials are unavailable');
    // The real IncomingMessage retains the Serve socket. Windows local mode
    // verifies its TCP peer PID against the running Tailscale service.
    const { principal }=access.authenticateHttp(request);
    const current=connection.verifyRegisteredActorCredential({headers:upstreamHeaders});
    if (current?.sharedBrowser && access.requirePrincipal(current.peer.principal).id===principal.id) return {cookie:current.cookie};
    const peer=access.acquirePrincipalPeer(principal,{channel:'pocket-browser',loginId:randomUUID(),interactions:'answer'});
    return connection.createActorApiCredential(peer);
  };
  return {required,authorize};
}

export function actorCookieHeaders(headers,credential) {
  if (!credential) return headers;
  // Remove old owner/API credentials, including a previous signed-in user's
  // native cookie; authority/signature selection must never pick a stale first duplicate.
  const ordinary=String(headers.cookie??'').split(';').filter(value=>value.trim()&&!value.trim().startsWith('dsh-auth-'));
  return {...headers,cookie:[...ordinary,credential.cookie].join('; ')};
}
