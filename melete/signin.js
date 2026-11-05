/* Google authentication stays on a real origin, outside about:srcdoc scores. */
(() => {
  "use strict";
  const status = document.getElementById("status");
  const inline = new URL(location.href).searchParams.get('inline') === '1';
  const direct = new URL(location.href).searchParams.get('direct') === '1';
  const attemptKey = 'melete:oidc-attempt';
  document.documentElement.classList.toggle('inline', inline);
  if (inline) status.textContent = '';
  let session;
  async function request(action, body) {
    const response = await fetch(`api.php?action=${action}`, {method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
      headers: body ? {"Content-Type": "application/json", "X-Melete-CSRF": session.csrf} : {},
      body: body && JSON.stringify(body), signal: AbortSignal.timeout(30000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Sign-in failed");
    return data;
  }
  function done() {
    status.textContent = "Signed in. Return to Melete to choose what to back up.";
    document.getElementById("google").replaceChildren();
    const close = document.getElementById("close"); close.hidden = false;
    close.onclick = () => window.close();
    window.opener?.postMessage({type: "melete-cloud-signed-in"}, location.origin);
    if (inline) parent.postMessage({type: 'melete-cloud-signed-in'}, location.origin);
    if (window.opener && !inline) window.close();
  }
  async function start() {
    session = await request("status");
    if (!session.configured) throw new Error("The server's Google client ID needs configuring.");
    const response = new URLSearchParams(location.hash.slice(1));
    if (response.has('id_token') || response.has('error')) {
      history.replaceState(null, '', location.pathname);
      const attempt = JSON.parse(sessionStorage.getItem(attemptKey) || 'null');
      sessionStorage.removeItem(attemptKey);
      if (!attempt || attempt.state !== response.get('state') || Date.now() - attempt.at > 600000
        || attempt.nonce !== session.nonce) throw new Error('Sign-in expired or could not be verified. Return to Melete and click Upload again.');
      if (response.has('error')) throw new Error('Google sign-in was canceled. Your local recordings are unchanged.');
      // The server verifies signature, issuer, audience, expiry and session nonce.
      await request('login', {credential: response.get('id_token')});
      done(); return;
    }
    if (session.user) { done(); return; }
    if (direct) {
      const state = crypto.randomUUID();
      sessionStorage.setItem(attemptKey, JSON.stringify({state, nonce:session.nonce, at:Date.now()}));
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      const redirect = new URL('signin.html', location.href);
      for (const [key, value] of Object.entries({client_id:session.clientId, redirect_uri:redirect.href,
        response_type:'id_token', scope:'openid email profile', nonce:session.nonce, state, prompt:'select_account'})) url.searchParams.set(key, value);
      location.replace(url.href); return;
    }
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => {script.remove(); reject(new Error("Google sign-in timed out. Reload to retry."));}, 15000);
      script.src = "https://accounts.google.com/gsi/client"; script.async = true;
      script.onload = () => {clearTimeout(timer); resolve();};
      script.onerror = () => {clearTimeout(timer); reject(new Error("Google sign-in could not load. Reload to retry."));};
      document.head.append(script);
    });
    google.accounts.id.initialize({client_id: session.clientId, nonce: session.nonce, auto_select: false,
      callback: async response => {
        try { await request("login", {credential: response.credential}); done(); }
        catch (e) {status.textContent = e.message;}
      }});
    google.accounts.id.renderButton(document.getElementById("google"), inline
      ? {type:'icon',theme:'outline',size:'small',shape:'circle'}
      : {type: "standard", theme: "outline", size: "large", text: "signin_with"});
    status.textContent = inline ? '' : "Sign in to return to your selected Melete action.";
    status.title = 'Sign in with Google. Signing in alone uploads no recordings.';
  }
  function fail(error) {
    status.textContent = inline ? 'Sign-in unavailable' : error.message;
    status.title = error.message;
    if (inline) {
      const retry = document.createElement('button'); retry.type='button'; retry.textContent='Retry';
      retry.onclick=()=>{document.getElementById('google').replaceChildren();void start().catch(fail);};
      document.getElementById('google').replaceChildren(retry);
    }
  }
  void start().catch(fail);
})();
