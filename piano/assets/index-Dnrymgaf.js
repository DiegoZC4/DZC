(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))s(o);new MutationObserver(o=>{for(const i of o)if(i.type==="childList")for(const r of i.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&s(r)}).observe(document,{childList:!0,subtree:!0});function n(o){const i={};return o.integrity&&(i.integrity=o.integrity),o.referrerPolicy&&(i.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?i.credentials="include":o.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function s(o){if(o.ep)return;o.ep=!0;const i=n(o);fetch(o.href,i)}})();/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const oe={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ae=([e,t,n])=>{const s=document.createElementNS("http://www.w3.org/2000/svg",e);return Object.keys(t).forEach(o=>{s.setAttribute(o,String(t[o]))}),n!=null&&n.length&&n.forEach(o=>{const i=ae(o);s.appendChild(i)}),s},ye=(e,t={})=>{const n="svg",s={...oe,...t};return ae([n,s,e])};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ve=e=>{for(const t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const be=(...e)=>e.filter((t,n,s)=>!!t&&t.trim()!==""&&s.indexOf(t)===n).join(" ").trim();/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const we=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(t,n,s)=>s?s.toUpperCase():n.toLowerCase());/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ke=e=>{const t=we(e);return t.charAt(0).toUpperCase()+t.slice(1)};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Se=e=>Array.from(e.attributes).reduce((t,n)=>(t[n.name]=n.value,t),{}),J=e=>typeof e=="string"?e:!e||!e.class?"":e.class&&typeof e.class=="string"?e.class.split(" "):e.class&&Array.isArray(e.class)?e.class:"",Q=(e,{nameAttr:t,icons:n,attrs:s})=>{var $;const o=e.getAttribute(t);if(o==null)return;const i=ke(o),r=n[i];if(!r)return console.warn(`${e.outerHTML} icon name was not found in the provided icons object.`);const c=Se(e),d=ve(c)?{}:{"aria-hidden":"true"},p={...oe,"data-lucide":o,...d,...s,...c},L=J(c),I=J(s),P=be("lucide",`lucide-${o}`,...L,...I);P&&Object.assign(p,{class:P});const M=ye(r,p);return($=e.parentNode)==null?void 0:$.replaceChild(M,e)};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Me=[["path",{d:"M15 3h6v6"}],["path",{d:"m21 3-7 7"}],["path",{d:"m3 21 7-7"}],["path",{d:"M9 21H3v-6"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xe=[["path",{d:"m14 10 7-7"}],["path",{d:"M20 10h-6V4"}],["path",{d:"m3 21 7-7"}],["path",{d:"M4 14h6v6"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ee=[["path",{d:"M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 0 0 2 9v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8.5C22 9.6 20.4 8 18.5 8"}],["path",{d:"M2 14h20"}],["path",{d:"M6 14v4"}],["path",{d:"M10 14v4"}],["path",{d:"M14 14v4"}],["path",{d:"M18 14v4"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ae=[["path",{d:"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Le=[["path",{d:"M10 5H3"}],["path",{d:"M12 19H3"}],["path",{d:"M14 3v4"}],["path",{d:"M16 17v4"}],["path",{d:"M21 12h-9"}],["path",{d:"M21 19h-5"}],["path",{d:"M21 5h-7"}],["path",{d:"M8 10v4"}],["path",{d:"M8 12H3"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ie=[["path",{d:"M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z"}],["path",{d:"M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193"}],["circle",{cx:"10.5",cy:"6.5",r:".5",fill:"currentColor"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pe=[["path",{d:"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"}],["path",{d:"M16 9a5 5 0 0 1 0 6"}],["path",{d:"M19.364 18.364a9 9 0 0 0 0-12.728"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $e=[["path",{d:"M2 12q2.5 2 5 0t5 0 5 0 5 0"}],["path",{d:"M2 19q2.5 2 5 0t5 0 5 0 5 0"}],["path",{d:"M2 5q2.5 2 5 0t5 0 5 0 5 0"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Te=[["path",{d:"M18 6 6 18"}],["path",{d:"m6 6 12 12"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ie=({icons:e={},nameAttr:t="data-lucide",attrs:n={},root:s=document,inTemplates:o}={})=>{if(!Object.values(e).length)throw new Error(`Please provide an icons object.
If you want to use all the icons you can import it like:
 \`import { createIcons, icons } from 'lucide';
lucide.createIcons({icons});\``);if(typeof s>"u")throw new Error("`createIcons()` only works in a browser environment.");if(Array.from(s.querySelectorAll(`[${t}]`)).forEach(r=>Q(r,{nameAttr:t,icons:e,attrs:n})),o&&Array.from(s.querySelectorAll("template")).forEach(c=>ie({icons:e,nameAttr:t,attrs:n,root:c.content,inTemplates:o})),t==="data-lucide"){const r=s.querySelectorAll("[icon-name]");r.length>0&&(console.warn("[Lucide] Some icons were found with the now deprecated icon-name attribute. These will still be replaced for backwards compatibility, but will no longer be supported in v1.0 and you should switch to data-lucide"),Array.from(r).forEach(c=>Q(c,{nameAttr:"icon-name",icons:e,attrs:n})))}},x={grand:{attack:.008,decay:6.5,filter:7200,partials:[[1,.68,0],[2,.2,1.5],[3,.085,-2],[4,.035,3]],release:.32},warm:{attack:.018,decay:7.5,filter:3900,partials:[[1,.72,0],[2,.14,-1],[3,.045,1]],release:.45},bright:{attack:.005,decay:5.2,filter:9600,partials:[[1,.6,0],[2,.24,2],[3,.12,-2],[5,.04,4]],release:.22},electric:{attack:.012,decay:4.2,filter:6400,partials:[[1,.62,0],[2,.24,-4],[4,.09,4]],release:.55}};function Ne(e){return 440*2**((e-69)/12)}class Ce{constructor(){this.context=null,this.compressor=null,this.input=null,this.master=null,this.masterFilter=null,this.presetName="grand",this.sustain=!1,this.volume=.72,this.voiceId=0,this.voices=new Map}ensureContext(){if(!this.context){const t=window.AudioContext||window.webkitAudioContext;if(!t)return null;this.context=new t({latencyHint:"interactive"}),this.input=this.context.createGain(),this.input.gain.value=.78,this.masterFilter=this.context.createBiquadFilter(),this.masterFilter.type="lowpass",this.masterFilter.frequency.value=x[this.presetName].filter,this.masterFilter.Q.value=.32,this.compressor=this.context.createDynamicsCompressor(),this.compressor.threshold.value=-18,this.compressor.knee.value=18,this.compressor.ratio.value=3,this.compressor.attack.value=.006,this.compressor.release.value=.18,this.master=this.context.createGain(),this.master.gain.value=this.volume,this.input.connect(this.masterFilter),this.masterFilter.connect(this.compressor),this.compressor.connect(this.master),this.master.connect(this.context.destination)}return this.context.state==="suspended"&&this.context.resume(),this.context}noteOn(t,n=.78){var Y;const s=this.ensureContext();if(!s)return null;for(;this.voices.size>=28;){const O=this.voices.keys().next().value;this.releaseVoice(O,.06)}const o=x[this.presetName],i=s.currentTime,r=Ne(t),c=s.createGain(),d=s.createBiquadFilter(),p=(Y=s.createStereoPanner)==null?void 0:Y.call(s),L=Math.max(.035,Math.min(.13,n*.115)),I=Math.min(1.25,Math.max(.72,440/Math.max(220,r)));c.gain.setValueAtTime(1e-4,i),c.gain.exponentialRampToValueAtTime(L,i+o.attack),c.gain.exponentialRampToValueAtTime(L*.34,i+.55),c.gain.exponentialRampToValueAtTime(12e-5,i+o.decay*I),d.type="lowpass",d.frequency.value=Math.min(o.filter,2200+r*6),d.Q.value=.38,d.connect(c),p?(p.pan.value=Math.max(-.38,Math.min(.38,(t-64)/90)),c.connect(p),p.connect(this.input)):c.connect(this.input);const P=o.partials.map(([O,fe,ge])=>{const b=s.createOscillator(),T=s.createGain();return b.type="sine",b.frequency.value=r*O,b.detune.value=ge,T.gain.value=fe,b.connect(T),T.connect(d),b.start(i),{oscillator:b,partialGain:T}}),M=++this.voiceId,$=window.setTimeout(()=>this.disposeVoice(M),(o.decay*I+.4)*1e3);return this.voices.set(M,{cleanupTimer:$,filter:d,midi:t,oscillators:P,panner:p,released:!1,sustained:!1,voiceGain:c}),M}noteOff(t){const n=this.voices.get(t);if(!(!n||n.released)){if(this.sustain){n.sustained=!0;return}this.releaseVoice(t)}}releaseVoice(t,n){const s=this.voices.get(t);if(!s||s.released||!this.context)return;s.released=!0,s.sustained=!1,window.clearTimeout(s.cleanupTimer);const o=this.context.currentTime,i=n??x[this.presetName].release;s.voiceGain.gain.cancelScheduledValues(o),s.voiceGain.gain.setTargetAtTime(1e-4,o,Math.max(.012,i/5)),s.oscillators.forEach(({oscillator:r})=>r.stop(o+i+.08)),s.cleanupTimer=window.setTimeout(()=>this.disposeVoice(t),(i+.16)*1e3)}disposeVoice(t){var s;const n=this.voices.get(t);n&&(window.clearTimeout(n.cleanupTimer),n.oscillators.forEach(({oscillator:o,partialGain:i})=>{try{o.stop()}catch{}o.disconnect(),i.disconnect()}),n.filter.disconnect(),n.voiceGain.disconnect(),(s=n.panner)==null||s.disconnect(),this.voices.delete(t))}setSustain(t){this.sustain=!!t,!this.sustain&&[...this.voices.entries()].filter(([,n])=>n.sustained).forEach(([n])=>this.releaseVoice(n))}setPreset(t){x[t]&&(this.presetName=t,this.masterFilter&&this.context&&this.masterFilter.frequency.setTargetAtTime(x[t].filter,this.context.currentTime,.03))}setVolume(t){this.volume=Math.max(0,Math.min(1,t)),this.master&&this.context&&this.master.gain.setTargetAtTime(this.volume,this.context.currentTime,.025)}stopAll(){[...this.voices.keys()].forEach(t=>this.releaseVoice(t,.04))}}const Z=21,re=108,ce=5,qe=24,Re=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],We=new Set([0,2,4,5,7,9,11]);function F(e,t,n){return Math.min(n,Math.max(t,e))}function Ke(e){return!We.has(e%12)}function g(e){const t=(e%12+12)%12,n=Math.floor(e/12)-1;return`${Re[t]}${n}`}const l=Object.freeze(Array.from({length:re-Z+1},(e,t)=>Z+t).filter(e=>!Ke(e)));function le(e){return Math.min(qe,Math.floor(l.length/e))}function y(e){const t=F(Math.round(e.rows),1,4),n=F(Math.round(e.keysPerRow),ce,le(t)),s=t*n,o=l.length-s,i=F(Math.round(e.startWhiteIndex),0,o);return{...e,rows:t,keysPerRow:n,startWhiteIndex:i}}function Oe(e,t){const n=y(e),s=n.startWhiteIndex+(n.rows*n.keysPerRow-1)/2,o=y({...n,...t}),i=o.rows*o.keysPerRow;return y({...o,startWhiteIndex:Math.round(s-(i-1)/2)})}function A(e){const t=y(e),n=t.rows*t.keysPerRow,s=l[t.startWhiteIndex],o=l[t.startWhiteIndex+n-1];return{firstMidi:s,firstName:g(s),lastMidi:o,lastName:g(o),maximumStart:l.length-n,span:n}}function Fe(e){const t=y(e),n=[];for(let s=0;s<t.rows;s+=1){const o=t.startWhiteIndex+s*t.keysPerRow,i=l.slice(o,o+t.keysPerRow),r=[];i.slice(0,-1).forEach((c,d)=>{i[d+1]===c+2&&c+1<=re&&r.push({midi:c+1,position:d+1})}),n.push({blackNotes:r,register:s,startIndex:o,whiteNotes:i})}return n.reverse()}function ee(e,t){return t==="all"||t==="c"&&e%12===0?g(e):""}const ue="pocket-piano-settings-v1",te={haptics:!0,keysPerRow:12,labelMode:"c",rows:2,sound:"grand",startWhiteIndex:9,volume:.72},V=["off","c","all"],h=new Ce,Ve=document.querySelector("#app"),f=new Map,N=new Map;let w=!1,de=0,a=Be();function Be(){try{const e=JSON.parse(localStorage.getItem(ue));return y({...te,...e})}catch{return y(te)}}function K(){localStorage.setItem(ue,JSON.stringify(a))}function m(e,t=""){return`<i data-lucide="${e}" class="${t}" aria-hidden="true"></i>`}Ve.innerHTML=`
  <div class="piano-app" data-ready="false">
    <header class="topbar">
      <div class="brand" aria-label="Pocket Piano">
        ${m("piano")}
        <span>Piano</span>
      </div>
      <output class="range-readout" id="range-readout"></output>
      <nav class="toolbar" aria-label="Piano controls">
        <button class="tool-button tool-button-wide" id="sustain-button" type="button"
          aria-pressed="false" title="Sustain">
          ${m("waves")}
          <span>Sustain</span>
        </button>
        <button class="tool-button" id="labels-button" type="button"
          aria-pressed="true" title="Note labels">
          ${m("tags")}
        </button>
        <button class="tool-button" id="settings-button" type="button" title="Settings">
          ${m("sliders-horizontal")}
        </button>
        <button class="tool-button fullscreen-button" id="fullscreen-button" type="button"
          title="Fullscreen">
          ${m("maximize-2","enter-fullscreen-icon")}
          ${m("minimize-2","exit-fullscreen-icon")}
        </button>
      </nav>
    </header>

    <div class="range-bar">
      <div class="range-end-label">A0</div>
      <div class="range-navigator" id="range-navigator" role="slider" tabindex="0"
        aria-label="Keyboard range">
        <div class="mini-white-keys" id="mini-white-keys"></div>
        <div class="mini-black-keys" id="mini-black-keys"></div>
        <div class="range-selection" id="range-selection">
          <div class="range-grip" aria-hidden="true"></div>
          <div class="row-boundaries" id="row-boundaries"></div>
        </div>
      </div>
      <div class="range-end-label">C8</div>
    </div>

    <main class="keyboard-stage" id="keyboard-stage" aria-label="Piano keyboard"></main>

    <dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
      <header class="settings-header">
        <h2 id="settings-title">Keyboard</h2>
        <button class="tool-button" id="close-settings-button" type="button" title="Close">
          ${m("x")}
        </button>
      </header>
      <div class="settings-grid">
        <fieldset class="setting-group">
          <legend>Rows</legend>
          <div class="segmented-control" id="rows-control">
            ${[1,2,3,4].map(e=>`
                  <button type="button" data-rows="${e}" aria-pressed="false">${e}</button>
                `).join("")}
          </div>
        </fieldset>

        <label class="setting-group range-setting" for="keys-per-row">
          <span class="setting-label">
            <span>Keys / row</span>
            <output id="keys-per-row-output" for="keys-per-row"></output>
          </span>
          <input id="keys-per-row" type="range" min="${ce}" step="1" />
        </label>

        <label class="setting-group" for="sound-select">
          <span class="setting-label">Sound</span>
          <select id="sound-select">
            <option value="grand">Grand</option>
            <option value="warm">Warm</option>
            <option value="bright">Bright</option>
            <option value="electric">Electric</option>
          </select>
        </label>

        <label class="setting-group" for="labels-select">
          <span class="setting-label">Labels</span>
          <select id="labels-select">
            <option value="off">Off</option>
            <option value="c">C notes</option>
            <option value="all">All notes</option>
          </select>
        </label>

        <label class="setting-group range-setting" for="volume-control">
          <span class="setting-label">
            <span>Volume</span>
            ${m("volume-2")}
          </span>
          <input id="volume-control" type="range" min="0" max="1" step="0.01" />
        </label>

        <label class="setting-group toggle-setting" for="haptics-control">
          <span class="setting-label">Haptics</span>
          <input id="haptics-control" type="checkbox" role="switch" />
        </label>
      </div>
    </dialog>

    <div class="orientation-guard" aria-live="polite">
      <div class="orientation-symbol">${m("rotate-cw")}</div>
      <strong>Landscape required</strong>
      <button class="orientation-button" id="orientation-button" type="button">
        ${m("maximize-2")}
        <span>Enter landscape</span>
      </button>
    </div>
  </div>
`;ie({icons:{Maximize2:Me,Minimize2:xe,Piano:Ee,RotateCw:Ae,SlidersHorizontal:Le,Tags:Ie,Volume2:Pe,Waves:$e,X:Te}});const E=document.querySelector(".piano-app"),k=document.querySelector("#keyboard-stage"),B=document.querySelector("#range-readout"),u=document.querySelector("#range-navigator"),ne=document.querySelector("#range-selection"),He=document.querySelector("#row-boundaries"),De=document.querySelector("#mini-white-keys"),_e=document.querySelector("#mini-black-keys"),q=document.querySelector("#sustain-button"),C=document.querySelector("#labels-button"),je=document.querySelector("#settings-button"),Ge=document.querySelector("#fullscreen-button"),v=document.querySelector("#settings-dialog"),ze=document.querySelector("#close-settings-button"),pe=document.querySelector("#rows-control"),R=document.querySelector("#keys-per-row"),se=document.querySelector("#keys-per-row-output"),H=document.querySelector("#sound-select"),W=document.querySelector("#labels-select"),D=document.querySelector("#volume-control"),_=document.querySelector("#haptics-control"),Xe=document.querySelector("#orientation-button");function Ue(){De.innerHTML=l.map(t=>`<div class="mini-white-key">${t%12===0?`<span>${g(t)}</span>`:""}</div>`).join("");const e=.6/l.length*100;_e.innerHTML=l.map((t,n)=>l[n+1]!==t+2?"":`<div class="mini-black-key" style="left:${(n+1)/l.length*100-e/2}%;width:${e}%"></div>`).join("")}function G(){U();const e=Fe(a),t=A(a);k.style.setProperty("--row-count",String(a.rows)),k.innerHTML=e.map(n=>{const s=.62/a.keysPerRow*100,o=n.whiteNotes.map(r=>{const c=ee(r,a.labelMode);return`
            <button class="key white-key" type="button" data-midi="${r}"
              aria-label="${g(r)}">
              ${c?`<span class="key-label">${c}</span>`:""}
            </button>
          `}).join(""),i=n.blackNotes.map(({midi:r,position:c})=>{const d=c/a.keysPerRow*100-s/2,p=ee(r,a.labelMode);return`
            <button class="key black-key" type="button" data-midi="${r}"
              aria-label="${g(r)}" style="left:${d}%;width:${s}%">
              ${p?`<span class="key-label">${p}</span>`:""}
            </button>
          `}).join("");return`
        <section class="piano-row" aria-label="${g(n.whiteNotes[0])} register">
          <div class="white-keys">${o}</div>
          <div class="black-keys">${i}</div>
        </section>
      `}).join(""),B.value=`${t.firstName}–${t.lastName}`,B.textContent=B.value,E.dataset.rows=String(a.rows),E.dataset.keysPerRow=String(a.keysPerRow),E.dataset.startWhiteIndex=String(a.startWhiteIndex),E.dataset.ready="true",Ye(t),Je()}function Ye(e=A(a)){const t=a.startWhiteIndex/l.length*100,n=e.span/l.length*100;ne.style.left=`${t}%`,ne.style.width=`${n}%`,u.setAttribute("aria-valuemin","0"),u.setAttribute("aria-valuemax",String(e.maximumStart)),u.setAttribute("aria-valuenow",String(a.startWhiteIndex)),u.setAttribute("aria-valuetext",`${e.firstName} to ${e.lastName}`),He.innerHTML=Array.from({length:a.rows-1},(s,o)=>`<span style="left:${(o+1)/a.rows*100}%"></span>`).join("")}function Je(){var e;pe.querySelectorAll("[data-rows]").forEach(t=>{t.setAttribute("aria-pressed",String(Number(t.dataset.rows)===a.rows))}),R.max=String(le(a.rows)),R.value=String(a.keysPerRow),se.value=String(a.keysPerRow),se.textContent=String(a.keysPerRow),H.value=a.sound,W.value=a.labelMode,D.value=String(a.volume),_.checked=a.haptics,C.setAttribute("aria-pressed",String(a.labelMode!=="off")),C.dataset.mode=a.labelMode,C.title=`Note labels: ${((e=W.selectedOptions[0])==null?void 0:e.text)??"Off"}`}function S(e,t=!1){a=t?Oe(a,e):y({...a,...e}),h.setPreset(a.sound),h.setVolume(a.volume),K(),G()}function Qe(e,t){var n;return((n=document.elementFromPoint(e,t))==null?void 0:n.closest(".key"))??null}function j(e,t){const n=N.get(e)??0,s=Math.max(0,n+(t?1:-1));s===0?N.delete(e):N.set(e,s),document.querySelectorAll(`.key[data-midi="${e}"]`).forEach(o=>{o.classList.toggle("active",s>0)})}function z(e,t,n=.5){var c;const s=f.get(e),o=t?Number(t.dataset.midi):null;if((s==null?void 0:s.midi)===o)return;if(s!=null&&s.voiceId&&h.noteOff(s.voiceId),(s==null?void 0:s.midi)!==null&&(s==null?void 0:s.midi)!==void 0&&j(s.midi,!1),o===null){f.set(e,{midi:null,voiceId:null});return}const i=n>0?.55+n*.35:.78,r=h.noteOn(o,i);f.set(e,{midi:o,voiceId:r}),j(o,!0),a.haptics&&typeof e=="number"&&((c=navigator.vibrate)==null||c.call(navigator,5))}function X(e){const t=f.get(e);t&&(t.voiceId&&h.noteOff(t.voiceId),t.midi!==null&&j(t.midi,!1),f.delete(e))}function U(){[...f.keys()].forEach(X),N.clear()}function Ze(){var e,t;window.matchMedia("(display-mode: standalone)").matches&&((t=(e=screen.orientation)==null?void 0:e.lock)==null||t.call(e,"landscape").catch(()=>{}))}k.addEventListener("pointerdown",e=>{const t=e.target.closest(".key");t&&(e.preventDefault(),k.setPointerCapture(e.pointerId),f.set(e.pointerId,{midi:null,voiceId:null}),z(e.pointerId,t,e.pressure),Ze())});k.addEventListener("pointermove",e=>{f.has(e.pointerId)&&(e.preventDefault(),z(e.pointerId,Qe(e.clientX,e.clientY),e.pressure))});["pointerup","pointercancel","lostpointercapture"].forEach(e=>{k.addEventListener(e,t=>X(t.pointerId))});function he(e){const t=u.getBoundingClientRect(),n=A(a),s=(e-t.left-de)/t.width*l.length,o=Math.max(0,Math.min(n.maximumStart,Math.round(s)));o!==a.startWhiteIndex&&(a={...a,startWhiteIndex:o},K(),G())}u.addEventListener("pointerdown",e=>{e.preventDefault();const t=u.getBoundingClientRect(),n=A(a),s=a.startWhiteIndex/l.length*t.width,o=n.span/l.length*t.width,i=e.clientX-t.left;de=i>=s&&i<=s+o?i-s:o/2,u.setPointerCapture(e.pointerId),u.classList.add("dragging"),he(e.clientX)});u.addEventListener("pointermove",e=>{u.hasPointerCapture(e.pointerId)&&(e.preventDefault(),he(e.clientX))});["pointerup","pointercancel","lostpointercapture"].forEach(e=>{u.addEventListener(e,()=>u.classList.remove("dragging"))});u.addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const t=A(a);let n=a.startWhiteIndex;e.key==="ArrowLeft"&&(n-=1),e.key==="ArrowRight"&&(n+=1),e.key==="Home"&&(n=0),e.key==="End"&&(n=t.maximumStart),S({startWhiteIndex:n})});pe.addEventListener("click",e=>{const t=e.target.closest("[data-rows]");t&&S({rows:Number(t.dataset.rows)},!0)});R.addEventListener("input",()=>{S({keysPerRow:Number(R.value)},!0)});H.addEventListener("change",()=>S({sound:H.value}));W.addEventListener("change",()=>S({labelMode:W.value}));D.addEventListener("input",()=>{a={...a,volume:Number(D.value)},h.setVolume(a.volume),K()});_.addEventListener("change",()=>{a={...a,haptics:_.checked},K()});q.addEventListener("click",()=>{w=!w,h.setSustain(w),q.setAttribute("aria-pressed",String(w))});C.addEventListener("click",()=>{const e=V.indexOf(a.labelMode);S({labelMode:V[(e+1)%V.length]})});je.addEventListener("click",()=>{typeof v.showModal=="function"?v.showModal():v.setAttribute("open","")});ze.addEventListener("click",()=>v.close());v.addEventListener("click",e=>{e.target===v&&v.close()});async function me(){var e,t;try{document.fullscreenElement||await document.documentElement.requestFullscreen({navigationUI:"hide"})}catch{}try{await((t=(e=screen.orientation)==null?void 0:e.lock)==null?void 0:t.call(e,"landscape"))}catch{}}async function et(){document.fullscreenElement?await document.exitFullscreen():await me()}Ge.addEventListener("click",()=>void et());Xe.addEventListener("click",()=>void me());document.addEventListener("fullscreenchange",()=>{E.dataset.fullscreen=String(!!document.fullscreenElement)});const tt={KeyA:60,KeyW:61,KeyS:62,KeyE:63,KeyD:64,KeyF:65,KeyT:66,KeyG:67,KeyY:68,KeyH:69,KeyU:70,KeyJ:71,KeyK:72};window.addEventListener("keydown",e=>{if(e.repeat||e.target.matches("input, select, button"))return;if(e.code==="Space"){e.preventDefault(),w||q.click();return}const t=tt[e.code];if(!t)return;e.preventDefault();const n=`keyboard:${e.code}`;f.set(n,{midi:null,voiceId:null});const s=document.querySelector(`.key[data-midi="${t}"]`);s&&z(n,s,.65)});window.addEventListener("keyup",e=>{if(e.code==="Space"){e.preventDefault(),w&&q.click();return}X(`keyboard:${e.code}`)});window.addEventListener("blur",()=>{U(),h.stopAll()});document.addEventListener("visibilitychange",()=>{document.hidden&&(U(),h.stopAll())});window.addEventListener("contextmenu",e=>e.preventDefault());window.addEventListener("gesturestart",e=>e.preventDefault());"serviceWorker"in navigator&&window.addEventListener("load",()=>{navigator.serviceWorker.register("./sw.js")});Ue();h.setPreset(a.sound);h.setVolume(a.volume);G();
