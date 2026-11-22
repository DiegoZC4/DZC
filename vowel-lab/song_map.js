/* Recorded choir exemplars on the same absolute-Hz chart as the live microphone. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VowelSongMap = api;
})(globalThis, function songMaps() {
  'use strict';
  // Navigation only. Measurements, listening examples and lyric choices stay keyed
  // by their exact transcription, never by the family of the held sound.
  const families = [
    ['EE', ['feel / here','seed'], '#7cdaff', ['i','i>ø','i>ɹ']],
    ['IH', ['in','will'], '#8aabff', ['ɪ','ɪ>ɹ']],
    ['AY', ['they / air','rain'], '#abacff', ['e>ɪ','e>ø']],
    ['EH', ['wend','let'], '#c29aff', ['ɛ','ɛ>ø','ɛ>ɹ']],
    ['Short A', ['paths / and','that'], '#f6a5ed', ['æ']],
    ['AH', ['fall / light','rock / my / ground'], '#ff9b87', ['ɑ','a>ɪ','a>ʊ','a>ɪ(>ɹ)','ɑ>ø','ɑ>ɹ']],
    ['AW', ['autumn','saw'], '#ffa94f', ['ɔ','ɔ>ɹ']],
    ['OH', ['grows','hold'], '#aad77d', ['o>ʊ']],
    ['OO', ['soon','blue / could'], '#65dbb4', ['u','ʊ']],
    ['UH', ['colors / again','dug / weak the'], '#ffcb74', ['ʌ','ə']],
    ['R', ['rounded R in earth','English R in earth / thunder'], '#53d7dc', ['ø','ɝ','ɚ']],
  ];
  const bySymbol = new Map(families.flatMap(row=>row[3].map(v=>[v,row])));
  const color = v => bySymbol.get(v)?.[2] || '#e0e6f0';
  const compact = v => v.replaceAll('>', '');
  const notation = v => v.replaceAll('>', ' → ').replace('( → ', ' (→ ');
  const soundNames = {u:'long OO','ʊ':'short OO','ʌ':'stressed UH','ə':'schwa',
    'ø':'rounded Ö','ɝ':'stressed English ER','ɚ':'unstressed English ER'};
  function rehearsalGroups(song) {
    const symbols=Object.keys(song.vowels);
    const known=song.id==='autumn' || song.id==='the-seed';
    const rows=known ? families.map(([id,cues,ink,members])=>({
      id,label:id==='R'?(song.id==='autumn'?'Ö':'ER'):id,cue:cues[song.id==='autumn'?0:1],ink,
      members:members.filter(v=>Object.hasOwn(song.vowels,v)),
    })).filter(g=>g.members.length) : [];
    for(const v of symbols.filter(v=>!known || !bySymbol.has(v)).sort())
      rows.push({id:v,label:compact(v),cue:notation(v),ink:color(v),members:[v]});
    return rows;
  }
  const hz = p => p.center.join(' / ')+' Hz';
  const titleOf = e => 'm'+e.m+' · '+e.word+(e.syllable.toLowerCase()===e.word ? '' : ' ('+e.syllable+')');
  const evidence = (symbol, row) => !row.examples.length ? 'none'
    : !symbol.includes('>') || row.examples.some(e => e.patches.length===2) ? 'measured' : 'partial';
  function groupEvidence(group, song, sourceFor) {
    const states=group.members.map(v=>evidence(v,song.vowels[v]));
    if(states.every(s=>s==='measured'))return 'measured';
    if(states.some(s=>s!=='none'))return 'partial';
    return group.members.some(v=>sourceFor(v)!==song)?'borrowed':'none';
  }
  function exampleReading(e) {
    const phases = {steady:'F1 / F2',early:'Early',late:'Late'};
    const readings = e.patches.map(p => phases[p.phase]+' '+hz(p)).join(' · ');
    const motion = e.patches.length===2 && !e.motion ? ' · No clear movement' : '';
    return readings+motion;
  }
  function guidesFor(symbol, landmarks) {
    const symbols = symbol.replace(/[()]/g,'').split('>');
    return symbols.map((s,index)=>{
      const anchor = landmarks.find(p=>p.symbol===s);
      return anchor ? {index,s,points:[anchor.men,anchor.women].filter(Boolean).map(p=>[p.f1,p.f2])} : null;
    }).filter(Boolean);
  }

  function drawPatch(ctx, patch, project, ink, focused, borrowed) {
    const outline = patch.hull.map(project), p = project(patch.center);
    ctx.beginPath();
    outline.forEach((v,i)=>i ? ctx.lineTo(v.x,v.y) : ctx.moveTo(v.x,v.y));
    ctx.closePath();
    ctx.fillStyle=ink+(focused?'43':'27'); ctx.fill();
    ctx.strokeStyle=ink; ctx.lineWidth=focused?1.8:1;
    ctx.setLineDash(borrowed ? [3,3] : []);
    ctx.stroke();ctx.setLineDash([]);
    const r=focused?4:3;ctx.beginPath();
    if(patch.phase==='late') {
      ctx.moveTo(p.x,p.y-r-1);ctx.lineTo(p.x+r,p.y+r);ctx.lineTo(p.x-r,p.y+r);ctx.closePath();
    } else ctx.arc(p.x,p.y,r,0,2*Math.PI);
    ctx.fillStyle=patch.phase==='steady'?ink:'#141d29';ctx.fill();ctx.strokeStyle=ink;ctx.stroke();
    return p;
  }
  function arrow(ctx, a, b, ink) {
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
    if(d<6)return;
    const ux=dx/d,uy=dy/d,tip={x:b.x-4*ux,y:b.y-4*uy};
    const head=Math.min(7,d/3);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(tip.x,tip.y);
    ctx.strokeStyle=ink;ctx.lineWidth=1.7;ctx.stroke();
    ctx.beginPath();ctx.moveTo(tip.x,tip.y);
    ctx.lineTo(tip.x-head*ux-.5*head*uy,tip.y-head*uy+.5*head*ux);
    ctx.lineTo(tip.x-head*ux+.5*head*uy,tip.y-head*uy-.5*head*ux);
    ctx.closePath();ctx.fillStyle=ink;ctx.fill();
  }
  function speechGuide(ctx, guides, project, ink) {
    let anchor;
    ctx.strokeStyle=ink;ctx.lineWidth=1;
    for(const g of guides) {
      const pair=g.points.map(project);
      if(pair.length===2){
        ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(pair[0].x,pair[0].y);ctx.lineTo(pair[1].x,pair[1].y);ctx.stroke();ctx.setLineDash([]);
      }
      for(const p of pair) {
        ctx.beginPath();ctx.moveTo(p.x-3,p.y-3);ctx.lineTo(p.x+3,p.y+3);
        ctx.moveTo(p.x-3,p.y+3);ctx.lineTo(p.x+3,p.y-3);ctx.stroke();
      }
      anchor ||= pair[0];
    }
    return anchor;
  }
  function labelRegions(ctx, labels, box) {
    ctx.font='600 13px "Segoe UI",sans-serif';
    const occupied=labels.map(({p})=>({x:p.x-3,y:p.y-3,w:6,h:6}));
    const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))
                        *Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    for(const {p,text,ink} of labels) {
      const w=Math.ceil(ctx.measureText(text).width)+7,h=18;
      let best, cost=Infinity;
      for(const radius of [12,26,42,59,78,100]) for(const angle of [-.7,.7,-2.4,2.4,-1.55,1.55,0,Math.PI]) {
        const ux=Math.cos(angle),uy=Math.sin(angle);
        const x=Math.max(box.x+1,Math.min(box.x+box.width-w-1,p.x+radius*ux-w*(1-ux)/2));
        const y=Math.max(box.y+1,Math.min(box.y+box.height-h-1,p.y+radius*uy-h/2));
        const rect={x,y,w,h};
        const score=occupied.reduce((sum,r)=>sum+overlap(rect,r),0)*12+radius;
        if(score<cost){cost=score;best=rect;}
      }
      if(!best)continue;
      const {x,y}=best;
      const end={x:Math.max(x,Math.min(x+w,p.x)),y:Math.max(y,Math.min(y+h,p.y))};
      ctx.strokeStyle=ink+'a0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(end.x,end.y);ctx.stroke();
      ctx.fillStyle='#192331ee';ctx.fillRect(x,y,w,h);
      ctx.fillStyle=ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x+w/2,y+h/2);
      occupied.push({x:x-2,y:y-1,w:w+4,h:h+2});
    }
  }

  function attach(redraw) {
    const el=id=>document.getElementById(id);
    const select=el('song-map'), part=el('map-part'), legend=el('map-key'), lyrics=el('map-lyrics'), focus=el('map-focus');
    const known=new Set([...select.options].map(option=>option.value));
    const cache=new Map();
    let song=null, otherSong=null, groups=[], selected=[], selectionText='', generation=0, revision=0, layer=null, layerKey='', activeExample=null;
    const audioSprites=new Map();
    let playback=null, output, quietUntil=0, idleTimer, abort;
    const element=(tag,cls,text)=>{
      const node=document.createElement(tag);
      if(cls)node.className=cls;
      if(text!=null)node.textContent=text;
      return node;
    };
    const button=(cls,text)=>{const b=element('button',cls,text);b.type='button';return b;};
    function invalidate(){revision++;redraw();}
    function stopPlayback() {
      if(!playback)return;
      const {node,control}=playback;
      playback=null;quietUntil=performance.now()+350;
      control.setAttribute('aria-pressed','false');
      if(node){node.onended=null;node.stop();node.disconnect();}
      clearTimeout(idleTimer);
      idleTimer=setTimeout(()=>{if(!playback && output?.state==='running')void output.suspend().catch(()=>{});},350);
    }
    function sprite(file) {
      if(!audioSprites.has(file)) {
        const pending=fetch(file+'?v=1').then(res=>{
          if(!res.ok)throw new Error('Missing reference audio');
          return res.arrayBuffer();
        }).then(bytes=>output.decodeAudioData(bytes)).catch(error=>{audioSprites.delete(file);throw error;});
        audioSprites.set(file,pending);
      }
      return audioSprites.get(file);
    }
    async function listen(example, control, source) {
      const repeated = playback?.control===control;
      stopPlayback();
      if(repeated)return;
      clearTimeout(idleTimer);
      const ticket=playback={control,node:null}, [start,end]=example.audio;
      control.setAttribute('aria-pressed','true');
      try {
        // Unlock in the tap handler; schedule decoded samples, not a network seek.
        output ||= new AudioContext({latencyHint:'interactive'});
        const [,buffer]=await Promise.all([output.resume(),sprite(source.audio)]);
        if(playback!==ticket)return;
        if(!(start>=0 && start<end && end<=buffer.duration+.001))throw new Error('Invalid excerpt');
        const node=output.createBufferSource();node.buffer=buffer;node.connect(output.destination);
        node.onended=()=>{if(playback===ticket)stopPlayback();};
        node.start(0,start,end-start);ticket.node=node;
      } catch {
        if(playback!==ticket)return;
        stopPlayback();control.textContent='Retry · '+titleOf(example);
        control.title='The reference excerpt could not play.';
      }
    }

    function sourceFor(symbol) {
      if(!song.vowels[symbol].examples.length && el('map-borrow').checked && otherSong?.vowels[symbol]?.examples.length)return otherSong;
      return song;
    }

    function selectVowels(symbols, sourceText) {
      stopPlayback();activeExample=null;selected=symbols;selectionText=sourceText;focus.replaceChildren();
      for(const [i,b] of [...legend.children].entries())
        b.setAttribute('aria-pressed',String(groups[i].members.some(v=>selected.includes(v))));
      for(const b of lyrics.querySelectorAll('button')) {
        b.setAttribute('aria-pressed',String(b.dataset.vowels.split('/').some(v=>selected.includes(v))));
      }
      el('map-all').hidden=!selected.length;
      if(!selected.length) {
        focus.textContent='Select a vowel or lyric syllable to see its readings and hear an example.';
      } else {
        if(sourceText)focus.append(element('p','',sourceText));
        for(const symbol of selected) {
          const source=sourceFor(symbol), row=source.vowels[symbol], block=element('div','map-reading');
          block.dataset.vowel=symbol;
          const name=soundNames[symbol];
          const label=element('strong','',notation(symbol)+(name?' · '+name:''));
          label.style.color=color(symbol);block.append(label);
          if(!row.examples.length) {
            block.append(document.createTextNode(' · No clean shared-syllable measurement.'));
            const guides=guidesFor(symbol,globalThis.VowelLandmarks);
            if(el('map-guides').checked) block.append(element('p','',guides.length
              ? 'Speech crosses available for '+guides.map(g=>g.s).join(', ')+'.'
              : 'No speech coordinates available for this vowel.'));
          } else {
            const first=row.examples[0], count=row.examples.length;
            if(source!==song)block.append(document.createTextNode(' · Example from '+source.title));
            block.append(document.createTextNode(' · '+count+' of '+row.accepted+' usable '+(row.accepted===1?'excerpt':'excerpts')));
            const info=element('p','map-hz',titleOf(first)+' · '+exampleReading(first));
            const list=element('div','map-examples');
            for(const example of row.examples) {
              const b=button('map-example','▶ '+titleOf(example));
              b.setAttribute('aria-pressed','false');b.setAttribute('aria-label','Play '+titleOf(example));
              b.title=example.parts.join(', ')+' · '+example.from+' s · '+exampleReading(example);
              b.addEventListener('click',()=>{
                activeExample=example;info.textContent=titleOf(example)+' · '+exampleReading(example);
                void listen(example,b,source);invalidate();
              });
              list.append(b);
            }
            block.append(info,list);
          }
          focus.append(block);
        }
      }
      invalidate();
    }

    function renderLyrics(id) {
      lyrics.replaceChildren();
      const staff=song.parts.find(p=>p.id===id);
      for(const [m,syllables] of staff.lines) {
        const row=element('div','lyric-line'), words=element('div','lyric-words');
        row.dataset.measure=String(m);row.append(element('span','lyric-measure','m'+m),words);
        let word;
        for(const [text,full,choice,kind] of syllables) {
          if(!word || kind==='begin' || kind==='single') {
            if(words.children.length)words.append(' ');
            word=element('span','lyric-word');words.append(word);
          }
          if(!choice) {
            const neutral=element('span','lyric-neutral',text);neutral.title='No vowel target';word.append(neutral);
          } else {
            const variants=choice.split('/'), b=button('lyric-syllable',text);
            b.dataset.vowels=choice;b.style.setProperty('--vowel',color(variants[0]));
            if(variants.length>1) {
              b.dataset.choice='';
              const bands=variants.map((v,i)=>color(v)+' '+(100*i/variants.length)+'% '+(100*(i+1)/variants.length)+'%');
              b.style.setProperty('--stripe','linear-gradient(to right,'+bands.join(',')+')');
            }
            const label=variants.map(notation).join(' or ');
            b.title=full+' · '+label;b.setAttribute('aria-label',text+' · '+label+' · measure '+m);
            b.addEventListener('click',()=>selectVowels(variants,staff.id+' · m'+m+' · '+full+(variants.length>1?' · pronunciation options':'')));
            word.append(b);
          }
          if(kind==='single' || kind==='end')word=null;
        }
        lyrics.append(row);
      }
      lyrics.scrollTop=0;selectVowels([],null);
    }
    function renderKey() {
      legend.replaceChildren();
      const measured=groups.filter(g=>g.members.some(v=>song.vowels[v].examples.length)).length;
      el('map-count').textContent=groups.length+' rehearsal groups · '+measured+' with examples from this recording.';
      for(const group of groups) {
        const state=groupEvidence(group,song,sourceFor), b=button('vowel-key',group.label);
        b.dataset.family=group.id;b.dataset.evidence=state;b.style.setProperty('--vowel',group.ink);
        b.title=group.label+' · '+group.cue+' · '+group.members.map(notation).join(' / ');
        b.setAttribute('aria-label',b.title);
        b.addEventListener('click',()=>{
          const alreadySelected=selected.length===group.members.length && group.members.every(v=>selected.includes(v));
          selectVowels(alreadySelected?[]:group.members,alreadySelected?null:group.label+' · '+group.cue);
        });
        legend.append(b);
      }
    }
    function renderSong(partId) {
      el('map-title').textContent=song.title+' vowels';
      groups=rehearsalGroups(song);
      renderKey();
      for(const p of song.parts)part.add(new Option(p.name,p.id));
      if(song.parts.some(p=>p.id===partId))part.value=partId;
      el('lyric-heading').hidden=false;el('map-method').hidden=false;lyrics.hidden=false;
      renderLyrics(part.value);
    }
    function urlFor(id, partId) {
      const url=new URL(location.href);
      if(id)url.searchParams.set('song',id);else url.searchParams.delete('song');
      if(partId)url.searchParams.set('part',partId);else url.searchParams.delete('part');
      return url;
    }
    async function loadSong(id, partId) {
      const token=++generation;abort?.abort();stopPlayback();
      song=null;otherSong=null;groups=[];selected=[];activeExample=null;layer=null;select.value=known.has(id)?id:'';
      legend.replaceChildren();focus.replaceChildren();part.replaceChildren();lyrics.replaceChildren();
      for(const key of ['map-all','lyric-heading','map-method','map-lyrics'])el(key).hidden=true;
      el('map-method').open=false;
      el('song-panel').hidden=!select.value;document.body.classList.toggle('song-open',Boolean(select.value));
      el('map-title').textContent=select.selectedOptions[0].textContent+' vowels';
      el('map-count').textContent=select.value?'Loading song map…':'';
      invalidate();
      if(!select.value)return;
      try {
        abort=new AbortController();
        const loaded=await fetchSong(id,abort.signal);
        if(token!==generation)return;
        song=loaded;renderSong(partId);
        if(el('map-borrow').checked)void updateBorrowed();
      } catch {
        if(token!==generation)return;
        el('map-count').textContent='The song map could not load.';
        const retry=button('','Retry');retry.addEventListener('click',()=>loadSong(id,partId));focus.append(retry);
      }
    }
    async function fetchSong(id,signal) {
      if(cache.has(id))return cache.get(id);
      const res=await fetch(id+'-vowel-map.json?v=1',{signal});
      if(!res.ok)throw new Error('Missing song map');
      const data=await res.json();
      if(data.version!==1 || data.id!==id || !data.parts?.length)throw new Error('Invalid song map');
      cache.set(id,data);return data;
    }
    async function updateBorrowed() {
      const token=generation;
      if(!song)return;
      if(el('map-borrow').checked && !otherSong) {
        const other=[...known].find(id=>id && id!==song.id);
        try {
          const loaded=await fetchSong(other,abort.signal);
          if(token!==generation)return;
          otherSong=loaded;
        } catch {
          if(token!==generation)return;
          el('map-borrow').checked=false;
          el('map-count').textContent='The other song could not load. Its examples can be retried in the map settings.';
          return;
        }
      }
      renderKey();selectVowels(selected,selectionText);
    }
    function draw(ctx, plotPoint, bounds) {
      if(!song)return;
      const dpr=ctx.getTransform().a, w=ctx.canvas.width, h=ctx.canvas.height;
      const key=[w,h,dpr,revision].join(',');
      if(layerKey!==key || !layer) {
        layerKey=key;layer=document.createElement('canvas');layer.width=w;layer.height=h;
        const out=layer.getContext('2d');out.setTransform(dpr,0,0,dpr,0,0);
        const project=([f1,f2])=>plotPoint({f1,f2});
        const labels=new Map();
        for(const group of groups) for(const symbol of group.members) {
          if(selected.length && !selected.includes(symbol))continue;
          const source=sourceFor(symbol), examples=source.vowels[symbol].examples, ink=group.ink;
          const detail=selected.length>0, key=detail?symbol:group.id;
          function label(p,rank) {
            if(!p || (labels.get(key)?.rank??-1)>=rank)return;
            labels.set(key,{p,rank,ink,text:(detail?compact(symbol):group.label)+
              (source!==song?' · '+source.title:examples.length?'':' *')});
          }
          for(const example of examples) {
            out.globalAlpha=activeExample && activeExample!==example ? .35 : 1;
            const points=example.patches.map(p=>drawPatch(out,p,project,ink,detail,source!==song));
            if(example.motion && points.length===2)arrow(out,points[0],points[1],ink);
            // A late-only release is evidence for the path, not an anchor for its held vowel.
            if(detail || example.patches[0].phase!=='late')label(points[0],
              (example===activeExample?16:0)+(source===song?8:4)+(example.patches[0].phase==='steady'?2:1));
          }
          out.globalAlpha=1;
          if(!examples.length && el('map-guides').checked) {
            const guides=guidesFor(symbol,globalThis.VowelLandmarks), anchor=speechGuide(out,guides,project,ink);
            if(detail || guides[0]?.index===0)label(anchor,0);
          }
        }
        labelRegions(out,[...labels.values()],bounds);
      }
      ctx.drawImage(layer,0,0,w/dpr,h/dpr);
    }
    select.addEventListener('change',()=>{history.pushState(null,'',urlFor(select.value));void loadSong(select.value);});
    part.addEventListener('change',()=>{if(song){history.replaceState(null,'',urlFor(song.id,part.value));renderLyrics(part.value);}});
    el('map-all').addEventListener('click',()=>selectVowels([]));
    el('map-guides').addEventListener('change',()=>selectVowels(selected,selectionText));
    el('map-borrow').addEventListener('change',()=>void updateBorrowed());
    const fromURL=()=>{const query=new URLSearchParams(location.search);void loadSong(query.get('song')||'',query.get('part'));};
    window.addEventListener('popstate',fromURL);window.addEventListener('pagehide',stopPlayback);
    fromURL();
    return {draw, auditioning:()=>Boolean(playback)||performance.now()<quietUntil};
  }
  return {attach,color,evidence,exampleReading,guidesFor,rehearsalGroups,groupEvidence};
});
