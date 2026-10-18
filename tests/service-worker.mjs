// Runs in a disposable browser profile; changes only that profile's Cache Storage.
export default async p => {
  await p.ev(`(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Worker did not claim page')),5000);
      navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
    });
    for(const version of ['audit-a','audit-b']){
      const r=await fetch('/js/00-util.js?v='+version);if(!r.ok)throw new Error('Worker fixture fetch failed');await r.text();
      await new Promise(r=>setTimeout(r,200));
    }
    const keys=(await Promise.all((await caches.keys()).map(async name=>(await (await caches.open(name)).keys()).map(r=>r.url)))).flat();
    if(keys.some(u=>u.endsWith('/js/00-util.js?v=audit-a')) || !keys.some(u=>u.endsWith('/js/00-util.js?v=audit-b')))
      throw new Error('Worker did not evict the previous version');
    if(keys.some(u=>new URL(u).pathname==='/' || new URL(u).pathname.startsWith('/api/')))throw new Error('Worker cached document or API');
  })()`);
  const worker=(await p.send('Target.getTargets')).result.targetInfos.find(t=>t.type==='service_worker' && t.url.endsWith('/sw.js'));
  if(!worker)throw new Error('Service worker CDP target missing');
  const workerSession=(await p.send('Target.attachToTarget',{targetId:worker.targetId,flatten:true})).result.sessionId;
  await p.send('Network.enable',{},workerSession);
  await p.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},workerSession);
  await p.send('Network.enable');await p.send('Network.setCacheDisabled',{cacheDisabled:true});
  await p.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  try {
    await p.ev(`(async()=>{
      const hit=await fetch('/js/00-util.js?v=audit-b');if(!hit.ok || !(await hit.text()).includes('fetchTimeout'))throw new Error('Cached asset unavailable offline');
      for(const url of ['/?audit-document','/api/me','/js/00-util.js?v=audit-missing']){
        let failed=false;try{await fetch(url,{cache:url.startsWith('/?')?'no-store':'default',signal:AbortSignal.timeout(3000)});}catch{failed=true;}
        if(!failed)throw new Error('Offline request unexpectedly succeeded: '+url);
      }
    })()`);
    console.log('PASS service worker version eviction, offline assets, network-only document/API');
  } finally {
    await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await p.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},workerSession);
    await p.send('Target.detachFromTarget',{sessionId:workerSession});
    await p.send('Network.setCacheDisabled',{cacheDisabled:false});
  }
};
