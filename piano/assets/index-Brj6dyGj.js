(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))s(o);new MutationObserver(o=>{for(const a of o)if(a.type==="childList")for(const r of a.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&s(r)}).observe(document,{childList:!0,subtree:!0});function n(o){const a={};return o.integrity&&(a.integrity=o.integrity),o.referrerPolicy&&(a.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?a.credentials="include":o.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function s(o){if(o.ep)return;o.ep=!0;const a=n(o);fetch(o.href,a)}})();/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ie={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ae=([e,t,n])=>{const s=document.createElementNS("http://www.w3.org/2000/svg",e);return Object.keys(t).forEach(o=>{s.setAttribute(o,String(t[o]))}),n!=null&&n.length&&n.forEach(o=>{const a=ae(o);s.appendChild(a)}),s},ve=(e,t={})=>{const n="svg",s={...ie,...t};return ae([n,s,e])};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const be=e=>{for(const t in e)if(t.startsWith("aria-")||t==="role"||t==="title")return!0;return!1};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const we=(...e)=>e.filter((t,n,s)=>!!t&&t.trim()!==""&&s.indexOf(t)===n).join(" ").trim();/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ke=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(t,n,s)=>s?s.toUpperCase():n.toLowerCase());/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Se=e=>{const t=ke(e);return t.charAt(0).toUpperCase()+t.slice(1)};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Me=e=>Array.from(e.attributes).reduce((t,n)=>(t[n.name]=n.value,t),{}),Q=e=>typeof e=="string"?e:!e||!e.class?"":e.class&&typeof e.class=="string"?e.class.split(" "):e.class&&Array.isArray(e.class)?e.class:"",Z=(e,{nameAttr:t,icons:n,attrs:s})=>{var P;const o=e.getAttribute(t);if(o==null)return;const a=Se(o),r=n[a];if(!r)return console.warn(`${e.outerHTML} icon name was not found in the provided icons object.`);const c=Me(e),d=be(c)?{}:{"aria-hidden":"true"},p={...ie,"data-lucide":o,...d,...s,...c},A=Q(c),L=Q(s),I=we("lucide",`lucide-${o}`,...A,...L);I&&Object.assign(p,{class:I});const M=ve(r,p);return(P=e.parentNode)==null?void 0:P.replaceChild(M,e)};/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xe=[["path",{d:"M15 3h6v6"}],["path",{d:"m21 3-7 7"}],["path",{d:"m3 21 7-7"}],["path",{d:"M9 21H3v-6"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ee=[["path",{d:"m14 10 7-7"}],["path",{d:"M20 10h-6V4"}],["path",{d:"m3 21 7-7"}],["path",{d:"M4 14h6v6"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ae=[["path",{d:"M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 0 0 2 9v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8.5C22 9.6 20.4 8 18.5 8"}],["path",{d:"M2 14h20"}],["path",{d:"M6 14v4"}],["path",{d:"M10 14v4"}],["path",{d:"M14 14v4"}],["path",{d:"M18 14v4"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Le=[["path",{d:"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"}],["path",{d:"M21 3v5h-5"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ie=[["path",{d:"M10 5H3"}],["path",{d:"M12 19H3"}],["path",{d:"M14 3v4"}],["path",{d:"M16 17v4"}],["path",{d:"M21 12h-9"}],["path",{d:"M21 19h-5"}],["path",{d:"M21 5h-7"}],["path",{d:"M8 10v4"}],["path",{d:"M8 12H3"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pe=[["path",{d:"M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z"}],["path",{d:"M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193"}],["circle",{cx:"10.5",cy:"6.5",r:".5",fill:"currentColor"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Te=[["path",{d:"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"}],["path",{d:"M16 9a5 5 0 0 1 0 6"}],["path",{d:"M19.364 18.364a9 9 0 0 0 0-12.728"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $e=[["path",{d:"M2 12q2.5 2 5 0t5 0 5 0 5 0"}],["path",{d:"M2 19q2.5 2 5 0t5 0 5 0 5 0"}],["path",{d:"M2 5q2.5 2 5 0t5 0 5 0 5 0"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ne=[["path",{d:"M18 6 6 18"}],["path",{d:"m6 6 12 12"}]];/**
 * @license lucide v1.27.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const re=({icons:e={},nameAttr:t="data-lucide",attrs:n={},root:s=document,inTemplates:o}={})=>{if(!Object.values(e).length)throw new Error(`Please provide an icons object.
If you want to use all the icons you can import it like:
 \`import { createIcons, icons } from 'lucide';
lucide.createIcons({icons});\``);if(typeof s>"u")throw new Error("`createIcons()` only works in a browser environment.");if(Array.from(s.querySelectorAll(`[${t}]`)).forEach(r=>Z(r,{nameAttr:t,icons:e,attrs:n})),o&&Array.from(s.querySelectorAll("template")).forEach(c=>re({icons:e,nameAttr:t,attrs:n,root:c.content,inTemplates:o})),t==="data-lucide"){const r=s.querySelectorAll("[icon-name]");r.length>0&&(console.warn("[Lucide] Some icons were found with the now deprecated icon-name attribute. These will still be replaced for backwards compatibility, but will no longer be supported in v1.0 and you should switch to data-lucide"),Array.from(r).forEach(c=>Z(c,{nameAttr:"icon-name",icons:e,attrs:n})))}},$={grand:{attack:.008,decay:6.5,filter:7200,partials:[[1,.68,0],[2,.2,1.5],[3,.085,-2],[4,.035,3]],release:.32},warm:{attack:.018,decay:7.5,filter:3900,partials:[[1,.72,0],[2,.14,-1],[3,.045,1]],release:.45},bright:{attack:.005,decay:5.2,filter:9600,partials:[[1,.6,0],[2,.24,2],[3,.12,-2],[5,.04,4]],release:.22},electric:{attack:.012,decay:4.2,filter:6400,partials:[[1,.62,0],[2,.24,-4],[4,.09,4]],release:.55}},N=1e-4;function Ce(e){return 440*2**((e-69)/12)}function qe(e,t){if(typeof e.cancelAndHoldAtTime=="function"){e.cancelAndHoldAtTime(t);return}const n=Math.max(N,e.value);e.cancelScheduledValues(t),e.setValueAtTime(n,t)}class Re{constructor(){this.context=null,this.compressor=null,this.input=null,this.master=null,this.masterFilter=null,this.presetName="grand",this.sustain=!1,this.volume=.72,this.voiceId=0,this.voices=new Map}ensureContext(){if(!this.context){const t=window.AudioContext||window.webkitAudioContext;if(!t)return null;this.context=new t({latencyHint:"interactive"}),this.input=this.context.createGain(),this.input.gain.value=.78,this.masterFilter=this.context.createBiquadFilter(),this.masterFilter.type="lowpass",this.masterFilter.frequency.value=$[this.presetName].filter,this.masterFilter.Q.value=.32,this.compressor=this.context.createDynamicsCompressor(),this.compressor.threshold.value=-18,this.compressor.knee.value=18,this.compressor.ratio.value=3,this.compressor.attack.value=.006,this.compressor.release.value=.18,this.master=this.context.createGain(),this.master.gain.value=this.volume,this.input.connect(this.masterFilter),this.masterFilter.connect(this.compressor),this.compressor.connect(this.master),this.master.connect(this.context.destination)}return this.context.state==="suspended"&&this.context.resume(),this.context}noteOn(t,n=.78){var J;const s=this.ensureContext();if(!s)return null;for(;this.voices.size>=28;){const V=this.voices.keys().next().value;this.releaseVoice(V,.06)}const o=$[this.presetName],a=s.currentTime,r=Ce(t),c=s.createGain(),d=s.createBiquadFilter(),p=(J=s.createStereoPanner)==null?void 0:J.call(s),A=Math.max(.035,Math.min(.13,n*.115)),L=Math.min(1.25,Math.max(.72,440/Math.max(220,r)));c.gain.setValueAtTime(N,a),c.gain.exponentialRampToValueAtTime(A,a+o.attack),c.gain.exponentialRampToValueAtTime(A*.34,a+.55),c.gain.exponentialRampToValueAtTime(N*1.2,a+o.decay*L),d.type="lowpass",d.frequency.value=Math.min(o.filter,2200+r*6),d.Q.value=.38,d.connect(c),p?(p.pan.value=Math.max(-.38,Math.min(.38,(t-64)/90)),c.connect(p),p.connect(this.input)):c.connect(this.input);const I=o.partials.map(([V,ge,ye])=>{const b=s.createOscillator(),T=s.createGain();return b.type="sine",b.frequency.value=r*V,b.detune.value=ye,T.gain.value=ge,b.connect(T),T.connect(d),b.start(a),{oscillator:b,partialGain:T}}),M=++this.voiceId,P=window.setTimeout(()=>this.disposeVoice(M),(o.decay*L+.4)*1e3);return this.voices.set(M,{cleanupTimer:P,filter:d,midi:t,oscillators:I,panner:p,release:o.release,released:!1,sustained:!1,voiceGain:c}),M}noteOff(t){const n=this.voices.get(t);if(!(!n||n.released)){if(this.sustain){n.sustained=!0;return}this.releaseVoice(t)}}releaseVoice(t,n){const s=this.voices.get(t);if(!s||s.released||!this.context)return;s.released=!0,s.sustained=!1,window.clearTimeout(s.cleanupTimer);const o=this.context.currentTime,a=n??s.release;qe(s.voiceGain.gain,o),s.voiceGain.gain.setTargetAtTime(N,o,Math.max(.012,a/5)),s.oscillators.forEach(({oscillator:r})=>r.stop(o+a+.08)),s.cleanupTimer=window.setTimeout(()=>this.disposeVoice(t),(a+.16)*1e3)}disposeVoice(t){var s;const n=this.voices.get(t);n&&(window.clearTimeout(n.cleanupTimer),n.oscillators.forEach(({oscillator:o,partialGain:a})=>{try{o.stop()}catch{}o.disconnect(),a.disconnect()}),n.filter.disconnect(),n.voiceGain.disconnect(),(s=n.panner)==null||s.disconnect(),this.voices.delete(t))}setSustain(t){this.sustain=!!t,!this.sustain&&[...this.voices.entries()].filter(([,n])=>n.sustained).forEach(([n])=>this.releaseVoice(n))}setPreset(t){$[t]&&(this.presetName=t,this.masterFilter&&this.context&&this.masterFilter.frequency.setTargetAtTime($[t].filter,this.context.currentTime,.03))}setVolume(t){this.volume=Math.max(0,Math.min(1,t)),this.master&&this.context&&this.master.gain.setTargetAtTime(this.volume,this.context.currentTime,.025)}stopAll(){[...this.voices.keys()].forEach(t=>this.releaseVoice(t,.04))}}const ee=21,ce=108,le=5,We=24,Ke=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],Oe=new Set([0,2,4,5,7,9,11]);function F(e,t,n){return Math.min(n,Math.max(t,e))}function Ve(e){return!Oe.has(e%12)}function g(e){const t=(e%12+12)%12,n=Math.floor(e/12)-1;return`${Ke[t]}${n}`}const l=Object.freeze(Array.from({length:ce-ee+1},(e,t)=>ee+t).filter(e=>!Ve(e)));function ue(e){return Math.min(We,Math.floor(l.length/e))}function y(e){const t=F(Math.round(e.rows),1,4),n=F(Math.round(e.keysPerRow),le,ue(t)),s=t*n,o=l.length-s,a=F(Math.round(e.startWhiteIndex),0,o);return{...e,rows:t,keysPerRow:n,startWhiteIndex:a}}function Fe(e,t){const n=y(e),s=n.startWhiteIndex+(n.rows*n.keysPerRow-1)/2,o=y({...n,...t}),a=o.rows*o.keysPerRow;return y({...o,startWhiteIndex:Math.round(s-(a-1)/2)})}function E(e){const t=y(e),n=t.rows*t.keysPerRow,s=l[t.startWhiteIndex],o=l[t.startWhiteIndex+n-1];return{firstMidi:s,firstName:g(s),lastMidi:o,lastName:g(o),maximumStart:l.length-n,span:n}}function He(e){const t=y(e),n=[];for(let s=0;s<t.rows;s+=1){const o=t.startWhiteIndex+s*t.keysPerRow,a=l.slice(o,o+t.keysPerRow),r=[];a.slice(0,-1).forEach((c,d)=>{a[d+1]===c+2&&c+1<=ce&&r.push({midi:c+1,position:d+1})}),n.push({blackNotes:r,register:s,startIndex:o,whiteNotes:a})}return n.reverse()}function te(e,t){return t==="all"||t==="c"&&e%12===0?g(e):""}const de="pocket-piano-settings-v1",ne={haptics:!0,keysPerRow:12,labelMode:"c",rows:2,sound:"grand",startWhiteIndex:9,volume:.72},H=["off","c","all"],h=new Re,Be=document.querySelector("#app"),f=new Map,C=new Map;let w=!1,pe=0,i=De();function De(){try{const e=JSON.parse(localStorage.getItem(de));return y({...ne,...e})}catch{return y(ne)}}function O(){localStorage.setItem(de,JSON.stringify(i))}function m(e,t=""){return`<i data-lucide="${e}" class="${t}" aria-hidden="true"></i>`}Be.innerHTML=`
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
          <input id="keys-per-row" type="range" min="${le}" step="1" />
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
`;re({icons:{Maximize2:xe,Minimize2:Ee,Piano:Ae,RotateCw:Le,SlidersHorizontal:Ie,Tags:Pe,Volume2:Te,Waves:$e,X:Ne}});const x=document.querySelector(".piano-app"),k=document.querySelector("#keyboard-stage"),B=document.querySelector("#range-readout"),u=document.querySelector("#range-navigator"),se=document.querySelector("#range-selection"),_e=document.querySelector("#row-boundaries"),Ge=document.querySelector("#mini-white-keys"),je=document.querySelector("#mini-black-keys"),R=document.querySelector("#sustain-button"),q=document.querySelector("#labels-button"),ze=document.querySelector("#settings-button"),Xe=document.querySelector("#fullscreen-button"),v=document.querySelector("#settings-dialog"),Ue=document.querySelector("#close-settings-button"),he=document.querySelector("#rows-control"),W=document.querySelector("#keys-per-row"),oe=document.querySelector("#keys-per-row-output"),D=document.querySelector("#sound-select"),K=document.querySelector("#labels-select"),_=document.querySelector("#volume-control"),G=document.querySelector("#haptics-control"),Ye=document.querySelector("#orientation-button");function Je(){Ge.innerHTML=l.map(t=>`<div class="mini-white-key">${t%12===0?`<span>${g(t)}</span>`:""}</div>`).join("");const e=.6/l.length*100;je.innerHTML=l.map((t,n)=>l[n+1]!==t+2?"":`<div class="mini-black-key" style="left:${(n+1)/l.length*100-e/2}%;width:${e}%"></div>`).join("")}function z(){Y();const e=He(i),t=E(i);k.style.setProperty("--row-count",String(i.rows)),k.innerHTML=e.map(n=>{const s=.62/i.keysPerRow*100,o=n.whiteNotes.map(r=>{const c=te(r,i.labelMode);return`
            <button class="key white-key" type="button" data-midi="${r}"
              aria-label="${g(r)}">
              ${c?`<span class="key-label">${c}</span>`:""}
            </button>
          `}).join(""),a=n.blackNotes.map(({midi:r,position:c})=>{const d=c/i.keysPerRow*100-s/2,p=te(r,i.labelMode);return`
            <button class="key black-key" type="button" data-midi="${r}"
              aria-label="${g(r)}" style="left:${d}%;width:${s}%">
              ${p?`<span class="key-label">${p}</span>`:""}
            </button>
          `}).join("");return`
        <section class="piano-row" aria-label="${g(n.whiteNotes[0])} register">
          <div class="white-keys">${o}</div>
          <div class="black-keys">${a}</div>
        </section>
      `}).join(""),B.value=`${t.firstName}–${t.lastName}`,B.textContent=B.value,x.dataset.rows=String(i.rows),x.dataset.keysPerRow=String(i.keysPerRow),x.dataset.startWhiteIndex=String(i.startWhiteIndex),x.dataset.ready="true",Qe(t),Ze()}function Qe(e=E(i)){const t=i.startWhiteIndex/l.length*100,n=e.span/l.length*100;se.style.left=`${t}%`,se.style.width=`${n}%`,u.setAttribute("aria-valuemin","0"),u.setAttribute("aria-valuemax",String(e.maximumStart)),u.setAttribute("aria-valuenow",String(i.startWhiteIndex)),u.setAttribute("aria-valuetext",`${e.firstName} to ${e.lastName}`),_e.innerHTML=Array.from({length:i.rows-1},(s,o)=>`<span style="left:${(o+1)/i.rows*100}%"></span>`).join("")}function Ze(){var e;he.querySelectorAll("[data-rows]").forEach(t=>{t.setAttribute("aria-pressed",String(Number(t.dataset.rows)===i.rows))}),W.max=String(ue(i.rows)),W.value=String(i.keysPerRow),oe.value=String(i.keysPerRow),oe.textContent=String(i.keysPerRow),D.value=i.sound,K.value=i.labelMode,_.value=String(i.volume),G.checked=i.haptics,q.setAttribute("aria-pressed",String(i.labelMode!=="off")),q.dataset.mode=i.labelMode,q.title=`Note labels: ${((e=K.selectedOptions[0])==null?void 0:e.text)??"Off"}`}function S(e,t=!1){i=t?Fe(i,e):y({...i,...e}),h.setPreset(i.sound),h.setVolume(i.volume),O(),z()}function et(e,t){var n;return((n=document.elementFromPoint(e,t))==null?void 0:n.closest(".key"))??null}function j(e,t){const n=C.get(e)??0,s=Math.max(0,n+(t?1:-1));s===0?C.delete(e):C.set(e,s),document.querySelectorAll(`.key[data-midi="${e}"]`).forEach(o=>{o.classList.toggle("active",s>0)})}function X(e,t,n=.5){var c;const s=f.get(e),o=t?Number(t.dataset.midi):null;if((s==null?void 0:s.midi)===o)return;if(s!=null&&s.voiceId&&h.noteOff(s.voiceId),(s==null?void 0:s.midi)!==null&&(s==null?void 0:s.midi)!==void 0&&j(s.midi,!1),o===null){f.set(e,{midi:null,voiceId:null});return}const a=n>0?.55+n*.35:.78,r=h.noteOn(o,a);f.set(e,{midi:o,voiceId:r}),j(o,!0),i.haptics&&typeof e=="number"&&((c=navigator.vibrate)==null||c.call(navigator,5))}function U(e){const t=f.get(e);t&&(t.voiceId&&h.noteOff(t.voiceId),t.midi!==null&&j(t.midi,!1),f.delete(e))}function Y(){[...f.keys()].forEach(U),C.clear()}function tt(){var e,t;window.matchMedia("(display-mode: standalone)").matches&&((t=(e=screen.orientation)==null?void 0:e.lock)==null||t.call(e,"landscape").catch(()=>{}))}k.addEventListener("pointerdown",e=>{const t=e.target.closest(".key");t&&(e.preventDefault(),k.setPointerCapture(e.pointerId),f.set(e.pointerId,{midi:null,voiceId:null}),X(e.pointerId,t,e.pressure),tt())});k.addEventListener("pointermove",e=>{f.has(e.pointerId)&&(e.preventDefault(),X(e.pointerId,et(e.clientX,e.clientY),e.pressure))});["pointerup","pointercancel","lostpointercapture"].forEach(e=>{k.addEventListener(e,t=>U(t.pointerId))});function me(e){const t=u.getBoundingClientRect(),n=E(i),s=(e-t.left-pe)/t.width*l.length,o=Math.max(0,Math.min(n.maximumStart,Math.round(s)));o!==i.startWhiteIndex&&(i={...i,startWhiteIndex:o},O(),z())}u.addEventListener("pointerdown",e=>{e.preventDefault();const t=u.getBoundingClientRect(),n=E(i),s=i.startWhiteIndex/l.length*t.width,o=n.span/l.length*t.width,a=e.clientX-t.left;pe=a>=s&&a<=s+o?a-s:o/2,u.setPointerCapture(e.pointerId),u.classList.add("dragging"),me(e.clientX)});u.addEventListener("pointermove",e=>{u.hasPointerCapture(e.pointerId)&&(e.preventDefault(),me(e.clientX))});["pointerup","pointercancel","lostpointercapture"].forEach(e=>{u.addEventListener(e,()=>u.classList.remove("dragging"))});u.addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const t=E(i);let n=i.startWhiteIndex;e.key==="ArrowLeft"&&(n-=1),e.key==="ArrowRight"&&(n+=1),e.key==="Home"&&(n=0),e.key==="End"&&(n=t.maximumStart),S({startWhiteIndex:n})});he.addEventListener("click",e=>{const t=e.target.closest("[data-rows]");t&&S({rows:Number(t.dataset.rows)},!0)});W.addEventListener("input",()=>{S({keysPerRow:Number(W.value)},!0)});D.addEventListener("change",()=>S({sound:D.value}));K.addEventListener("change",()=>S({labelMode:K.value}));_.addEventListener("input",()=>{i={...i,volume:Number(_.value)},h.setVolume(i.volume),O()});G.addEventListener("change",()=>{i={...i,haptics:G.checked},O()});R.addEventListener("click",()=>{w=!w,h.setSustain(w),R.setAttribute("aria-pressed",String(w))});q.addEventListener("click",()=>{const e=H.indexOf(i.labelMode);S({labelMode:H[(e+1)%H.length]})});ze.addEventListener("click",()=>{typeof v.showModal=="function"?v.showModal():v.setAttribute("open","")});Ue.addEventListener("click",()=>v.close());v.addEventListener("click",e=>{e.target===v&&v.close()});async function fe(){var e,t;try{document.fullscreenElement||await document.documentElement.requestFullscreen({navigationUI:"hide"})}catch{}try{await((t=(e=screen.orientation)==null?void 0:e.lock)==null?void 0:t.call(e,"landscape"))}catch{}}async function nt(){document.fullscreenElement?await document.exitFullscreen():await fe()}Xe.addEventListener("click",()=>void nt());Ye.addEventListener("click",()=>void fe());document.addEventListener("fullscreenchange",()=>{x.dataset.fullscreen=String(!!document.fullscreenElement)});const st={KeyA:60,KeyW:61,KeyS:62,KeyE:63,KeyD:64,KeyF:65,KeyT:66,KeyG:67,KeyY:68,KeyH:69,KeyU:70,KeyJ:71,KeyK:72};window.addEventListener("keydown",e=>{if(e.repeat||e.target.matches("input, select, button"))return;if(e.code==="Space"){e.preventDefault(),w||R.click();return}const t=st[e.code];if(!t)return;e.preventDefault();const n=`keyboard:${e.code}`;f.set(n,{midi:null,voiceId:null});const s=document.querySelector(`.key[data-midi="${t}"]`);s&&X(n,s,.65)});window.addEventListener("keyup",e=>{if(e.code==="Space"){e.preventDefault(),w&&R.click();return}U(`keyboard:${e.code}`)});window.addEventListener("blur",()=>{Y(),h.stopAll()});document.addEventListener("visibilitychange",()=>{document.hidden&&(Y(),h.stopAll())});window.addEventListener("contextmenu",e=>e.preventDefault());window.addEventListener("gesturestart",e=>e.preventDefault());"serviceWorker"in navigator&&window.addEventListener("load",()=>{navigator.serviceWorker.register("./sw.js")});Je();h.setPreset(i.sound);h.setVolume(i.volume);z();
