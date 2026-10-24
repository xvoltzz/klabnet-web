// Uses a made-up artist response; opens pages and dialogs without playing or sending.
export default async p => {
  await p.ev(`(async()=>{
    setActiveTab('music');
    const original=fetchTimeout;
    fetchTimeout=(url,...args)=>{
      const path=new URL(url,location.href).pathname;
      if(path.endsWith('/getArtist'))return Promise.resolve({json:async()=>({'subsonic-response':{artist:{album:[{id:'keyboard-album',name:'Keyboard album',year:2026,coverArt:_albumsCache?.[0]?.coverArt || ''}]}}})});
      if(path.endsWith('/getArtistInfo2'))return Promise.resolve({json:async()=>({'subsonic-response':{artistInfo2:{biography:'A local fixture for keyboard navigation.'}}})});
      if(path.endsWith('/getTopSongs'))return Promise.resolve({json:async()=>({'subsonic-response':{topSongs:{song:[]}}})});
      return original(url,...args);
    };
    try {await openArtistPage('keyboard-artist','Keyboard artist');}
    finally {fetchTimeout=original;}

  })()`);
  await p.sleep(600);await p.shot('keyboard-artist');
  if (!p.baseline) {
    await p.ev(`{window.keyboardAlbumOpen=openAlbumPage;window.keyboardOpened=[];openAlbumPage=(...args)=>keyboardOpened.push(args);
      const card=document.querySelector('.ap-disc-card');
      if(card.getAttribute('role')!=='button'||card.tabIndex!==0)throw new Error('Discography card inaccessible');card.focus();}`);
    try {
      await p.key('Enter');await p.key(' ','Space');
      if(await p.ev('keyboardOpened.length')!==2)throw new Error('Discography keyboard activation failed');
    } finally {await p.ev('openAlbumPage=keyboardAlbumOpen;delete window.keyboardAlbumOpen;delete window.keyboardOpened;');}
  }
  await p.ev("closeApPanel();setActiveTab('social')");await p.sleep(600);await p.shot('keyboard-presence');
  if (!p.baseline) {
    // Online now's cards aren't shown any more (2026-10-24): nothing of theirs to reach.
    console.log('PASS discography keyboard activation');
  }
};
