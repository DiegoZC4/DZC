(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RehearsalRoute=api;
})(typeof self!=='undefined'?self:globalThis,()=>{
  function resolve(recordings,href){
    const url=new URL(href),legacy=new URLSearchParams(url.hash.slice(1));
    const params=legacy.has('recording')?legacy:url.searchParams;
    const id=params.get('recording'),song=params.get('song'),date=params.get('date');
    const matches=recordings.filter(r=>(!id||r.id===id)&&(!song||r.song===song)&&(!date||r.date===date));
    if(!matches.length)throw Error('No recording matches this link');
    const recording=song&&!date&&!id?[...matches].sort((a,b)=>b.date.localeCompare(a.date))[0]:matches[0];
    const channel=recording.channels.find(c=>c.id===params.get('mic'))||recording.channels[0];
    return {recording,channel};
  }
  function urlFor(href,recording,channel){
    const url=new URL(href);
    for(const key of ['recording','song','date','mic'])url.searchParams.delete(key);
    url.searchParams.set('song',recording.song);url.searchParams.set('date',recording.date);
    if(recording.channels.length>1)url.searchParams.set('mic',channel.id);
    url.hash='';
    return url.href;
  }
  return {resolve,urlFor};
});
