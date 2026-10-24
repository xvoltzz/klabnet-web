// Drive the real poll/render path with a local response, without changing server presence.
export default async p => {
  await p.ev(`window.presenceFetch=fetchTimeout;window.presenceMinutes=7;
    fetchTimeout=(url,opts,...rest)=>{
      if(new URL(url,location.href).pathname==='/api/presence' && (!opts?.method || opts.method==='GET'))
        return Promise.resolve({ok:true,json:async()=>({listeners:[{username:'away-fixture',away:true,
          awaySince:new Date(Date.now()-presenceMinutes*60000).toISOString().slice(0,19).replace('T',' ')}],roster:[]})});
      return presenceFetch(url,opts,...rest);
    };
    window.presencePoll=()=>{
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));
    };setActiveTab('home');presencePoll();`);
  try {
    await p.sleep(350);
    await p.ev(`window.presenceShelf=document.querySelector('#hmListen .hm-cards');
      window.presenceFace=document.querySelector('#presenceList [data-username="away-fixture"]');
      window.presenceCard=document.querySelector('#hmListen [data-username="away-fixture"]');
      if(!presenceCard || !presenceCard.textContent.includes('Away 7m'))throw new Error('Away fixture did not render');
      presenceCard.focus();presenceMinutes=8;presencePoll();`);
    await p.sleep(350);
    if(!p.baseline) await p.ev(`if(presenceShelf!==document.querySelector('#hmListen .hm-cards') ||
      presenceFace!==document.querySelector('#presenceList [data-username="away-fixture"]') || document.activeElement!==presenceCard)
        throw new Error('Elapsed away time rebuilt the cards or lost focus');
      if(!presenceCard.textContent.includes('Away 8m') || !presenceFace.textContent.includes('Away 8m'))throw new Error('Away text stale');`);
    // Screenshots compare unfocused styling; focus preservation is asserted above.
    await p.ev('document.activeElement.blur()');await p.shot('away-presence');
    console.log('PASS elapsed away text',p.baseline?'baseline capture':'preserves card identity and focus');
  } finally {
    await p.ev('fetchTimeout=presenceFetch;presencePoll();delete window.presenceFetch;delete window.presencePoll;delete window.presenceMinutes;delete window.presenceShelf;delete window.presenceFace;delete window.presenceCard;');
    await p.sleep(300);
  }
};
