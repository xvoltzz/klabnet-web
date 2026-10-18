// Opt-in diagnostic run: ~/tools/nodeb tests/browser.mjs --url=http://localhost:8793/ --audit=true
// Counts are diagnostic, not leak assertions: listeners on collected nodes disappear after GC.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import regressions from './browser-regressions.mjs';
import serviceWorker from './service-worker.mjs';
export default async p => {
  const report = { events: [], stages: [], metrics: [] };
  // CDP events coexist with the driver's exception collector.
  await p.send('Network.enable'); await p.send('Log.enable'); await p.send('Performance.enable');
  await p.send('Page.addScriptToEvaluateOnNewDocument', {source: `(() => {
    const refs=[], intervals=new Map(), blobs=new Set(), tasks=[], rejections=[];
    const add=EventTarget.prototype.addEventListener, remove=EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener=function(type,fn,opts){
      if(fn && !refs.some(r=>r.target.deref()===this && r.fn.deref()===fn && r.type===type && r.capture===!!(typeof opts==='boolean'?opts:opts?.capture)))
        refs.push({target:new WeakRef(this),fn:new WeakRef(fn),type,capture:!!(typeof opts==='boolean'?opts:opts?.capture)});
      return add.call(this,type,fn,opts);
    };
    EventTarget.prototype.removeEventListener=function(type,fn,opts){
      const i=refs.findIndex(r=>r.target.deref()===this && r.fn.deref()===fn && r.type===type && r.capture===!!(typeof opts==='boolean'?opts:opts?.capture));
      if(i>=0)refs.splice(i,1); return remove.call(this,type,fn,opts);
    };
    const si=setInterval, ci=clearInterval;
    window.setInterval=(fn,ms,...args)=>{const id=si(fn,ms,...args);intervals.set(id,{ms,source:String(fn).slice(0,180)});return id;};
    window.clearInterval=id=>{intervals.delete(id);ci(id);};
    const create=URL.createObjectURL, revoke=URL.revokeObjectURL;
    URL.createObjectURL=obj=>{const url=create(obj);blobs.add(url);return url;};
    URL.revokeObjectURL=url=>{blobs.delete(url);return revoke(url);};
    const observers=new Set(), MO=MutationObserver;
    window.MutationObserver=class extends MO {
      constructor(fn){super(fn);this.auditRef=new WeakRef(this);}
      observe(...args){observers.add(this.auditRef);return super.observe(...args);}
      disconnect(){observers.delete(this.auditRef);return super.disconnect();}
    };
    new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({at:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
    add.call(window,'unhandledrejection',e=>rejections.push(String(e.reason?.stack||e.reason)));
    window.auditSnapshot=()=>({listeners:refs.filter(r=>r.target.deref() && r.fn.deref()).length,
      intervals:[...intervals.values()],observers:[...observers].filter(r=>r.deref()).length,
      blobs:blobs.size,nodes:document.querySelectorAll('*').length,longTasks:[...tasks],rejections:[...rejections],
      pressables:[...document.querySelectorAll('div,span,i,img')].filter(e=>e.getBoundingClientRect().width && (e.onclick || getComputedStyle(e).cursor==='pointer') && !e.closest('button,a,input,[role=button],[role=switch],[role=slider]')).slice(0,80).map(e=>({tag:e.tagName,id:e.id,class:e.className}))});
  })();`});
  // Driver offers a CDP subscription so diagnostics include console and network failures.
  const requests = new Map();
  const stop = p.onEvent((method, params) => {
    if (method === 'Network.requestWillBeSent') requests.set(params.requestId, params.request.url);
    if (method === 'Runtime.consoleAPICalled' && ['warning','error'].includes(params.type))
      report.events.push({stage:p.auditStage,type:params.type,args:params.args.map(a=>a.value||a.description)});
    if (method === 'Log.entryAdded' && ['warning','error'].includes(params.entry.level))
      report.events.push({stage:p.auditStage,...params.entry});
    if (method === 'Network.loadingFailed') report.events.push({stage:p.auditStage,kind:'network',url:requests.get(params.requestId),...params});
    if (method === 'Network.responseReceived' && params.response.status >= 400)
      report.events.push({stage:p.auditStage,type:'http',url:params.response.url,status:params.response.status});
  });
  const sample = async name => {
    await p.send('HeapProfiler.collectGarbage');
    const metrics=(await p.send('Performance.getMetrics')).result.metrics;
    report.metrics.push({name,values:Object.fromEntries(metrics.map(m=>[m.name,m.value]))});
    report.stages.push({name,...await p.ev('auditSnapshot()')});
  };
  try {
    p.auditStage='boot';await p.goto(); await sample('boot');
    for(const tab of ['home','feed','chat','music','photos']) {
      p.auditStage=tab;await p.ev(`setActiveTab('${tab}')`);await p.sleep(1000);await sample(tab);await p.shot('audit-'+tab);
    }
    for(const section of ['albums','artists','songs','requests']) {
      p.auditStage='music-'+section;await p.ev(`setActiveTab('music');document.querySelector('.picker-tab[data-tab="${section}"]').click()`);
      await p.sleep(2000);await sample(p.auditStage);
    }
    for(const [name,open,close] of [
      ['settings','openSettings()','closeSettings()'],
      ['request','openMusicRequestModal()','closeChatModal()'],
      ['confirm',"showConfirmDialog('Audit','Read-only dialog','Confirm')",'closeChatModal()'],
      ['input',"showInputDialog('Audit','Name','Name','')",'closeChatModal()']]) {
      p.auditStage=name;await p.ev(open+';void 0');await p.sleep(200);await p.shot('audit-'+name);await sample(name);await p.ev(close);
    }
    // Warm the same route set first. Compare two identical 20-switch loops after GC.
    for(let round=0;round<3;round++) {
      p.auditStage='switch-'+round;
      for(let i=0;i<20;i++){await p.ev(`setActiveTab('${['home','feed','chat','music','photos'][i%5]}')`);await p.sleep(120);}
      await p.sleep(800);await sample(p.auditStage);
    }
    p.auditStage='hot-paths';
    await p.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReportEvents'});
    const trace=[];const untrace=p.onEvent((method,params)=>{if(method==='Tracing.dataCollected')trace.push(...params.value);});
    await p.ev(`for(let i=0;i<100;i++){playerState.audio.dispatchEvent(new Event('timeupdate'));document.dispatchEvent(new MouseEvent('mousemove',{clientX:i,clientY:i}));pickerList.dispatchEvent(new Event('scroll'));}`);
    await p.sleep(400);await p.send('Tracing.end');await p.sleep(500);untrace();
    report.layoutEvents=trace.filter(e=>['Layout','UpdateLayoutTree'].includes(e.name));
    await sample('hot-paths');
    // Same SDK fakes and assertions as the normal suite; snapshots label each check.
    p.checkpoint=async name=>{p.auditStage=name;await sample('fixture: '+name);};
    await regressions(p);
    delete p.checkpoint;
    await p.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await p.send('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await p.ev('testClient.publicRooms=async()=>({chunk:[]})');
    for(const [name,open] of [
      ['feedback','openFeedbackModal()'],['profile','openProfileModal()'],
      ['playlist','openPlaylistEditor(null)'],['browse','openBrowseModal()'],
      ['create-channel','openCreateModal()'],['choice',"showChoiceDialog('Choose',[{label:'Local fixture',value:'local'}])"]]) {
      p.auditStage=name;await p.ev(open+';void 0');await p.sleep(600);
      await p.shot('audit-'+name);await sample(name);await p.ev('closeChatModal()');
    }
    p.auditStage='worker-offline (expected network failures)';await serviceWorker(p);
    p.auditStage='hidden';
    await p.ev(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));`);
    await p.sleep(1000);await sample('hidden');
    await p.ev(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));`);
  } finally {
    stop();writeFileSync(join(p.output,'audit.json'),JSON.stringify(report,null,2));
    console.log('Audit report:',join(p.output,'audit.json'));
    console.log('Audit samples:',JSON.stringify(report.stages.map(s=>({name:s.name,listeners:s.listeners,intervals:s.intervals.length,observers:s.observers,blobs:s.blobs,nodes:s.nodes,rejections:s.rejections}))));
  }
};
