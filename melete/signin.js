/* Google authentication stays on a real origin, outside about:srcdoc scores. */
(() => {
  "use strict";
  const status = document.getElementById("status");
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
  }
  async function start() {
    session = await request("status");
    if (!session.configured) throw new Error("The server's Google client ID needs configuring.");
    if (session.user) { done(); return; }
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
    google.accounts.id.renderButton(document.getElementById("google"), {type: "standard", theme: "outline", size: "large", text: "signin_with"});
    status.textContent = "Sign in to save your comp and best continuous take privately.";
  }
  void start().catch(e => {status.textContent = e.message;});
})();
