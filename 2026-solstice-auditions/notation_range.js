/* An excerpt ambitus, engraved by alphaTab without adding playback beats. */
(() => {
  function extremes(staff) {
    const notes=staff.bars.flatMap(bar=>bar.voices.flatMap(voice=>voice.beats.flatMap(beat=>beat.notes)))
      .filter(note=>!note.isPercussion && Number.isFinite(note.realValue));
    if(!notes.length)return [];
    return [notes.reduce((a,b)=>a.realValue<=b.realValue?a:b),notes.reduce((a,b)=>a.realValue>=b.realValue?a:b)];
  }
  function nearestNote(points,x,y) {
    let distance=Infinity,result=null;
    for(const {box,system,note} of points){
      if(x<system.x||x>system.x+system.w||y<system.y||y>system.y+system.h)continue;
      const next=Math.hypot(x-box.x-box.w/2,y-box.y-box.h/2);
      if(next<distance){distance=next;result=note;}
    }
    return result;
  }
  function install(factory,model) {
    const create=factory.create;
    factory.create=function(...args){
      const renderer=create.apply(this,args);
      if(renderer.bar.index!==0)return renderer;
      const before=renderer.createPreBeatGlyphs;
      renderer.createPreBeatGlyphs=function(){
        before.call(this);
        const notes=extremes(this.bar.staff);
        if(notes.length)this.addPreBeatGlyph(new RangeGlyph(notes,model));
      };
      return renderer;
    };
  }
  class RangeGlyph {
    x=0;y=0;width=0;height=0;items=[];
    constructor(notes,model){this.notes=notes;this.model=model;}
    doLayout(){
      const r=this.renderer,m=r.smuflMetrics,s=this.model.MusicFontSymbol;
      const headWidth=m.glyphWidths.get(s.NoteheadBlack),headHeight=m.glyphHeights.get(s.NoteheadBlack);
      this.items=this.notes.map((note,index)=>{
        // An isolated accidental helper preserves the real melody's accidental state.
        const helper=new r.accidentalHelper.constructor(r),copy=Object.create(note);
        copy.isTieDestination=false;
        const accidental=helper.applyAccidental(copy),step=helper.getNoteSteps(copy);
        const symbol=s['Accidental'+this.model.AccidentalType[accidental]];
        return {index,step,y:r.getScoreY(step),symbol,headWidth,headHeight};
      });
      const accidentalWidth=Math.max(...this.items.map(n=>n.symbol?m.glyphWidths.get(n.symbol)+m.accidentalPadding:0));
      for(const item of this.items)item.x=m.oneStaffSpace+accidentalWidth;
      this.width=m.oneStaffSpace+accidentalWidth+headWidth+m.oneStaffSpace*1.6;
      this.height=this.getBoundingBoxBottom()-this.getBoundingBoxTop();
    }
    getBoundingBoxTop(){return Math.min(...this.items.map(n=>n.y-n.headHeight));}
    getBoundingBoxBottom(){return Math.max(...this.items.map(n=>n.y+n.headHeight));}
    paint(cx,cy,canvas){
      const r=this.renderer,m=r.smuflMetrics,s=this.model.MusicFontSymbol;
      for(const n of this.items){
        const x=cx+this.x+n.x,y=cy+this.y;
        canvas.beginGroup('melete-range-'+(n.index?'high':'low'));
        // SMuFL text boxes include the font's full ascent; use the actual
        // notehead height so stacked notes have separate, predictable targets.
        const separation=Math.abs(this.items[0].y-this.items[1].y);
        const padding=Math.max(0,Math.min(8,(separation-n.headHeight)/2-1)),colour=canvas.color;
        canvas.beginGroup('range-hit');canvas.color=new this.model.Color(0,0,0,0);
        canvas.fillRect(x-5,y+n.y-n.headHeight/2-padding,n.headWidth+10,n.headHeight+padding*2);
        canvas.color=colour;canvas.endGroup();
        if(n.symbol)canvas.fillMusicFontSymbol(x-m.accidentalPadding-m.glyphWidths.get(n.symbol),y+n.y,1,n.symbol,false);
        const bottom=2*(r.drawnLineCount-1),extension=m.oneStaffSpace*.4;
        for(let step=n.step<0?-2:bottom+2;n.step<0?step>=n.step:step<=n.step;step+=n.step<0?-2:2)
          canvas.fillRect(x-extension,y+r.getScoreY(step)-m.staffLineThickness/2,n.headWidth+2*extension,m.staffLineThickness);
        canvas.fillMusicFontSymbol(x,y+n.y,1,s.NoteheadBlack,false);
        canvas.endGroup();
      }
    }
  }
  const api={extremes,nearestNote,install};
  if(typeof module!=='undefined')module.exports=api;
  if(typeof window!=='undefined')window.MeleteNotationRange=api;
})();
