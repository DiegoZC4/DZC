/* Recorded choir exemplars on the same absolute-Hz chart as the live microphone. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VowelSongMap = api;
})(globalThis, function songMaps() {
  'use strict';
  // Shared colors keep a syllable recognizable when switching parts or songs.
  const colors = {
    i:'#7cdaff', 'ɪ':'#8aabff', 'ɛ':'#c29aff', 'æ':'#f6a5ed',
    'ɑ':'#ff9b87', 'ɔ':'#ffa94f', 'ʊ':'#c9dc67', u:'#65dbb4',
    'ʌ':'#ffcb74', 'ə':'#c0c7d5', 'ø':'#53d7dc', 'ɝ':'#f79cba', 'ɚ':'#cfaeb5',
    'e>ɪ':'#abacff', 'o>ʊ':'#aad77d', 'a>ɪ':'#fb9cb0', 'a>ʊ':'#f5cc4e',
    'e>ø':'#80bff4', 'i>ø':'#5fe7ed', 'ɛ>ø':'#d4a7fa', 'ɑ>ø':'#fbac89',
    'i>ɹ':'#88cde3', 'ɪ>ɹ':'#919fdc', 'ɛ>ɹ':'#e6a4dc', 'ɑ>ɹ':'#eaba97',
    'ɔ>ɹ':'#f6b96d', 'a>ɪ(>ɹ)':'#f289a0',
  };
  const color = v => colors[v] || '#e0e6f0';
  const compact = v => v.replaceAll('>', '');
  const notation = v => v.replaceAll('>', ' → ').replace('( → ', ' (→ ');
  const hz = p => p.center.join(' / ')+' Hz';
  const titleOf = e => 'm'+e.m+' · '+e.word+(e.syllable.toLowerCase()===e.word ? '' : ' ('+e.syllable+')');
  const evidence = (symbol, row) => !row.examples.length ? 'none'
    : !symbol.includes('>') || row.examples.some(e => e.patches.length===2) ? 'measured' : 'partial';
  const description = {none:'No measured region',partial:'Part of the glide measured',measured:'Reference measured'};
  const order = symbols => [...symbols].sort((a,b) => {
    const known = Object.keys(colors);
    return (known.includes(a)?known.indexOf(a):known.length) - (known.includes(b)?known.indexOf(b):known.length) || a.localeCompare(b);
  });
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
    let song=null, otherSong=null, selected=[], selectionText='', generation=0, revision=0, layer=null, layerKey='', activeExample=null;
    let playback=null, quietUntil=0, stopTimer, abort;
    const element=(tag,cls,text)=>{
      const node=document.createElement(tag);
      if(cls)node.className=cls;
      if(text!=null)node.textContent=text;
      return node;
    };
    const button=(cls,text)=>{const b=element('button',cls,text);b.type='button';return b;};
    function invalidate(){revision++;redraw();}
    function stopPlayback() {
      clearTimeout(stopTimer);
      if(!playback)return;
      const {audio,control}=playback;
      playback=null;quietUntil=performance.now()+350;
      control.setAttribute('aria-pressed','false');audio.pause();audio.removeAttribute('src');audio.load();
    }
    function listen(example, control, source) {
      const repeated = playback?.control===control;
      stopPlayback();
      if(repeated)return;
      const audio=new Audio(), [start,end]=example.audio;
      playback={control,audio};
      function schedule() {
        if(playback?.audio!==audio || audio.paused)return;
        clearTimeout(stopTimer);
        if(audio.currentTime>=end-.012){stopPlayback();return;}
        stopTimer=setTimeout(schedule,Math.max(15,(end-audio.currentTime)*1000));
      }
      function failed() {
        if(playback?.audio!==audio)return;
        stopPlayback();control.textContent='Retry · '+titleOf(example);
        control.title='The reference excerpt could not play.';
      }
      audio.addEventListener('playing',schedule);audio.addEventListener('seeked',schedule);
      audio.addEventListener('timeupdate',schedule);audio.addEventListener('error',failed);
      audio.addEventListener('ended',()=>{if(playback?.audio===audio)stopPlayback();});
      control.setAttribute('aria-pressed','true');
      // The sprite holds only short excerpts from the same already-aligned performance.
      audio.src=source.audio+'?v=1';audio.currentTime=start;
      void audio.play().catch(failed);
    }

    function sourceFor(symbol) {
      if(!song.vowels[symbol].examples.length && el('map-borrow').checked && otherSong?.vowels[symbol]?.examples.length)return otherSong;
      return song;
    }

    function selectVowels(symbols, sourceText) {
      stopPlayback();activeExample=null;selected=symbols;selectionText=sourceText;focus.replaceChildren();
      for(const b of legend.children)b.setAttribute('aria-pressed',String(selected.includes(b.dataset.symbol)));
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
          const label=element('strong','',notation(symbol));label.style.color=color(symbol);block.append(label);
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
                listen(example,b,source);invalidate();
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
      const symbols=order(Object.keys(song.vowels));
      const measured=symbols.filter(v=>song.vowels[v].examples.length).length;
      const borrowed=symbols.filter(v=>sourceFor(v)!==song).length;
      el('map-count').textContent=measured+' of '+symbols.length+' vowel categories measured in this performance.'+
        (borrowed?' '+borrowed+' more shown from '+otherSong.title+'.':'');
      for(const symbol of symbols) {
        const source=sourceFor(symbol), state=source!==song?'borrowed':evidence(symbol,song.vowels[symbol]), b=button('vowel-key',compact(symbol));
        b.dataset.symbol=symbol;b.dataset.evidence=state;b.style.setProperty('--vowel',color(symbol));
        b.title=notation(symbol)+' · '+(state==='borrowed'?'Example from '+source.title:description[state]);b.setAttribute('aria-label',b.title);
        b.addEventListener('click',()=>selectVowels(selected.length===1 && selected[0]===symbol?[]:[symbol]));
        legend.append(b);
      }
    }
    function renderSong(partId) {
      el('map-title').textContent=song.title+' vowels';
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
      song=null;otherSong=null;selected=[];activeExample=null;layer=null;select.value=known.has(id)?id:'';
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
        const labels=[];
        for(const symbol of selected.length?selected:order(Object.keys(song.vowels))) {
          const source=sourceFor(symbol), examples=source.vowels[symbol].examples, ink=color(symbol);
          let anchor;
          for(const example of examples) {
            out.globalAlpha=activeExample && activeExample!==example ? .35 : 1;
            const points=example.patches.map(p=>drawPatch(out,p,project,ink,selected.length>0,source!==song));
            if(example.motion && points.length===2)arrow(out,points[0],points[1],ink);
            if(!anchor || example===activeExample)anchor=points[0];
          }
          out.globalAlpha=1;
          if(!examples.length && el('map-guides').checked) {
            anchor=speechGuide(out,guidesFor(symbol,globalThis.VowelLandmarks),project,ink);
          }
          if(anchor)labels.push({p:anchor,text:compact(symbol)+(source!==song?' · '+source.title:examples.length?'':' *'),ink});
        }
        labelRegions(out,labels,bounds);
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
  return {attach,color,evidence,exampleReading,guidesFor};
});
