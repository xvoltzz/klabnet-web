export default async p => {
  const check = async (name, body) => {
    await p.ev(`(async () => { const assert = (ok, why) => { if (!ok) throw new Error(why); };
      const pause = ms => new Promise(r => setTimeout(r, ms)); ${body} })()`);
    console.log('PASS', name);
  };
  await p.goto();
  if (p.smoke || p.variant === 'light') await p.ev(`applyTheme('${p.variant === 'light' ? 'light' : 'dark'}')`);
  if (p.variant === 'side') await p.ev("document.querySelector('#navStyle [data-v=side]').click()");
  if (p.smoke) {
    await check('desktop layout stays desktop', `assert(!matchMedia(KLAB_PHONE_MQ).matches,'Phone UI in a desktop window');`);
    for (const tab of ['home','feed','chat','music','photos']) {
      await p.ev(`setActiveTab('${tab}')`); await p.sleep(1200); await p.shot(tab);
      await check('dock controls stay inside the dock on ' + tab, `
        const dock=document.getElementById('playerDock'), bounds=dock.getBoundingClientRect();
        for(const b of dock.querySelectorAll('button')){const r=b.getBoundingClientRect();
          if(r.width)assert(r.left>=bounds.left-1 && r.right<=bounds.right+1,'Dock button escaped: '+(b.id||b.title));}
      `);
    }
    await p.ev("setActiveTab('music')"); await p.sleep(600);
    for (const section of ['albums','artists','songs','requests']) {
      await p.ev(`document.querySelector('.picker-tab[data-tab="${section}"]').click()`);
      await p.sleep(1800); await p.shot('music-' + section);
    }
    await p.ev('openMusicRequestModal()'); await p.sleep(200); await p.shot('request-dialog');
    await check('secondary and selected button styles', `
      const button=document.querySelector('.music-req-type-btn');const style=getComputedStyle(button);
      assert(style.height===getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim(),'Request button height differs from Music');
      assert(style.borderTopWidth==='1px','Request button hairline missing');
      assert(style.textTransform==='none','Request button uppercase');
    `);
    await p.ev('closeChatModal();openSettings()'); await p.sleep(300); await p.shot('settings');
    console.log('PASS', p.variant, 'screens and dialogs'); return;
  }
  await check('local identity and shared Home feed', `
    assert(KLAB_USER.username === 'tester', 'Tests require the isolated local API');
    assert(klabFeedPosts()?.length > 0, 'Seed local posts before running');
    assert(!performance.getEntriesByType('resource').some(r => r.name.endsWith('/api/posts?limit=8')), 'Home downloaded a second feed');
    const requests = performance.getEntriesByType('resource').filter(r => r.name.endsWith('/api/posts?limit=50')).length;
    await Promise.all([klabLoadFeed(), klabLoadFeed()]);
    assert(performance.getEntriesByType('resource').filter(r => r.name.endsWith('/api/posts?limit=50')).length === requests, 'Fresh feed refetched');
  `);
  for (const tab of ['home', 'feed', 'chat', 'music', 'photos']) {
    await p.ev(`setActiveTab('${tab}')`); await p.sleep(900); await p.shot(tab);
  }
  await check('Back and Forward between tabs', `
    setActiveTab('home'); await pause(50); setActiveTab('feed'); await pause(50);
    const length = history.length; history.back(); await pause(150);
    assert(document.querySelector('.tab-panel.active').dataset.tabPanel === 'home', 'Back did not restore Home');
    history.forward(); await pause(150);
    assert(document.querySelector('.tab-panel.active').dataset.tabPanel === 'feed', 'Forward did not restore Feed');
    assert(history.length === length, 'Restoration pushed another entry');
  `);
  await p.ev("setActiveTab('music');document.querySelector('.picker-tab[data-tab=albums]').click()");
  await p.sleep(2500);
  await check('album Back preserves its underlying list', `
    const row=pickerList.querySelector('.picker-item'), album=row?._album;
    assert(album,'Local music library did not load albums');
    const before=pickerList.firstElementChild; pickerList.scrollTop=200; const scroll=pickerList.scrollTop;
    await window.openAlbumPage(album.id,album.name); await pause(100);
    assert(document.getElementById('apPanel').classList.contains('open'),'Album did not open');
    document.getElementById('apBack').click(); await pause(150);
    assert(!document.getElementById('apPanel').classList.contains('open'),'Album Back did not close it');
    assert(pickerList.firstElementChild===before && pickerList.scrollTop===scroll,'Album Back rebuilt or scrolled the list');
  `);
  await p.ev('openSettings(); document.getElementById("sfxToggle").focus()');
  const before = await p.ev('_settings.sfxEnabled');
  await p.key(' ', 'Space'); await p.sleep(100);
  if (await p.ev('_settings.sfxEnabled') === before) throw new Error('Space did not operate the Settings switch');
  await check('native Settings switches', `
    for (const b of document.querySelectorAll('#settingsBackdrop .s-toggle')) {
      assert(b.tagName === 'BUTTON', 'Switch is not keyboard reachable');
      assert(b.getAttribute('aria-checked') === String(b.classList.contains('on')), 'Switch accessible state stale');
    }
  `);
  await p.shot('settings'); await p.ev('closeSettings()');
  await check('slider controls and mute from zero', `
    volSlider.setPct(0.4); playerState.volume = playerState.audio.volume = 0.4;
    const slider = document.getElementById('volSlider');
    slider.focus(); slider.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true, cancelable:true}));
    assert(Math.abs(playerState.audio.volume - 0.45) < .001, 'Arrow did not adjust volume');
    assert(document.getElementById('volFill').style.width === '100%', 'Fill changed layout width');
    assert(document.getElementById('volFill').style.transform.includes('scaleX(0.45)'), 'Fill transform wrong');
    playerState.volume = playerState.audio.volume = 0; volSlider.setPct(0); fsVolSlider.setPct(0);
    document.getElementById('volIcon').closest('button').click();
    assert(playerState.audio.volume > 0 && !playerState.audio.muted, 'Unmute from zero stayed silent');
    assert(document.getElementById('volIcon').closest('button').getAttribute('aria-label') === 'Mute', 'Mute accessible label stale');
  `);

  // Model server events at the SDK boundary. No Matrix login or real sends.
  await p.ev(`window.testEvents = []; window.testRooms = new Map();
    window.testEvent = (id, body = id, extra = {}) => ({ sender: {name:'Tester'}, status:null,
      getId:()=>id, getType:()=> 'm.room.message', getTs:()=> 1759752000000,
      getSender:()=> '@tester:local', getRelation:()=> null, isRedacted:()=> false,
      getContent:()=> ({msgtype:'m.text',body}), replacingEvent:()=> null, ...extra });
    window.testRoom = (id, events) => ({roomId:id,name:'Regression room',oldState:{paginationToken:null},
      getLiveTimeline:()=>({getEvents:()=>events}), getMyMembership:()=> 'join', getMember:()=>null,
      getJoinedMembers:()=> [], getJoinedMemberCount:()=> 0, hasUserReadEvent:()=>false,
      currentState:{getStateEvents:()=> null}, findEventById:key=>events.find(e=>e.getId()===key)});
    window.testClient = {getUserId:()=> '@tester:local',getRoom:id=>testRooms.get(id),getRooms:()=>[...testRooms.values()],
      getProfileInfo:async()=>({}),getAccountData:()=>null,sendReadReceipt:async()=>{},setAccountData:async()=>{}};
    Object.defineProperty(MatrixChat,'client',{value:testClient,configurable:true});
    _chatSyncSettled = true; document.getElementById('chatConnect').hidden = true; document.getElementById('chatApp').hidden = false;
    testRooms.set('!test:local',testRoom('!test:local',testEvents));
    chooseChatRoom('!test:local'); setActiveTab('chat'); setChatMobileView('convo');`);
  await p.sleep(200);
  await check('chat append, edits, redactions and timeline reset', `
    testEvents.push(...Array.from({length:60},(_,i)=>testEvent('$'+i)));
    _lastTimelineRenderKey=null; renderTimeline(); await pause(40);
    const timeline=document.getElementById('chatTimeline'); const first=timeline.querySelector('.chat-msg');
    timeline.scrollTop=120; const anchor=timeline.querySelector('[data-event-id="$8"]');
    const top=anchor.getBoundingClientRect().top;
    testEvents.push(testEvent('$new')); renderTimeline();
    assert(timeline.querySelector('.chat-msg')===first, 'Appending recreated old messages');
    assert(Math.abs(anchor.getBoundingClientRect().top-top)<2, 'Append moved reading position');
    assert(timeline.lastElementChild.dataset.eventId==='$new', 'Message not appended at the end');
    testEvents[0]=testEvent('$0','edited',{replacingEvent:()=>({getId:()=>'$edit'})}); renderTimeline();
    assert(timeline.querySelector('.chat-msg-text').textContent.startsWith('edited'), 'Edit not rebuilt');
    testEvents[0]=testEvent('$0','',{isRedacted:()=>true}); renderTimeline();
    assert(timeline.querySelector('.chat-msg-text').textContent==='Message deleted', 'Redaction not rebuilt');
    testEvents.splice(0,testEvents.length,testEvent('$reset')); renderTimeline();
    assert(timeline.querySelectorAll('.chat-msg').length===1, 'Limited timeline kept removed rows');
  `);
  await check('read receipt retry and event selection', `
    _lastSentReadEventId.clear(); _readReceiptPending.clear(); const sent=[]; let fail=true;
    testClient.sendReadReceipt=async ev=>{sent.push(ev.getId()); if(fail)throw new Error('offline');};
    testEvents.splice(0,testEvents.length,testEvent('$server'),testEvent('$edit','',{getRelation:()=>({rel_type:'m.replace'})}),testEvent('~pending','',{status:'sending'}));
    const room=testRooms.get('!test:local'); readActiveChatRoom(room); await pause(20);
    assert(sent.join(',')==='$server', 'Receipted an edit or a local echo');
    fail=false; readActiveChatRoom(room); await pause(20); readActiveChatRoom(room); await pause(20);
    assert(sent.length===2, 'Failure was permanently suppressed or success repeated');
  `);
  await check('pagination guards each room independently', `
    const a=testRooms.get('!test:local'), b=testRoom('!b:local',[]); testRooms.set(b.roomId,b);
    a.oldState.paginationToken=b.oldState.paginationToken='older';
    const requests=[]; testClient.scrollback=room=>new Promise(resolve=>requests.push({room,resolve}));
    document.getElementById('chatTimeline').scrollTop=0; chooseChatRoom(a.roomId); const one=maybeLoadOlderMessages();
    chooseChatRoom(b.roomId); const two=maybeLoadOlderMessages(); chooseChatRoom(a.roomId);
    maybeLoadOlderMessages(); assert(requests.length===2,'Returning to A duplicated its pending pagination');
    a.oldState.paginationToken=b.oldState.paginationToken=null; requests[0].resolve(); requests[1].resolve(); await Promise.all([one,two]);
  `);
  await check('drafts and failed sends stay in their conversation', `
    const a=testRooms.get('!test:local'), b=testRooms.get('!b:local');
    chooseChatRoom(a.roomId); renderTimeline();
    const input=document.getElementById('chatComposerInput'); input.value='draft for A';
    const file=new File(['picture'],'draft.png',{type:'image/png'}); setChatImage(file);
    chooseChatRoom(b.roomId); renderTimeline();
    assert(input.value==='' && !_pendingChatImage,'Draft followed into B');
    input.value='draft for B'; chooseChatRoom(a.roomId); renderTimeline();
    assert(input.value==='draft for A' && _pendingChatImage===file,'A draft was lost');
    clearChatImage(); let reject; testClient.sendTyping=async()=>{};
    testClient.sendMessage=()=>new Promise((_,no)=>{reject=no;});
    const send=sendChatMessage(); chooseChatRoom(b.roomId); renderTimeline();
    reject(new Error('expected offline test')); await send;
    assert(input.value==='draft for B','A failed send was restored into B');
    chooseChatRoom(a.roomId); renderTimeline(); assert(input.value==='draft for A','Failed text lost from A');
  `);
  await check('DM invites and bookkeeping retry after transient failure', `
    const room=testRoom('!invite:local',[]); let inviter=null, joins=0, writes=0, saved=null;
    room.getMyMembership=()=> 'invite'; room.getMember=()=>({getDMInviter:()=>inviter});
    testRooms.set(room.roomId,room); testClient.joinRoom=async()=>{joins++;if(joins===1)throw new Error('offline');};
    testClient.setAccountData=async(_type,content)=>{writes++;if(writes===1)throw new Error('offline');saved=content;};
    acceptDmInvites(); ensureDmBookkeeping(); assert(joins===0 && writes===0,'Incomplete invite was attempted');
    inviter='@friend:local'; acceptDmInvites(); await pause(20);
    assert(joins===1 && writes===1,'Invite was permanently marked checked too early');
    _dmInviteRetryAt.set(room.roomId,0); acceptDmInvites(); ensureDmBookkeeping(); await pause(20);
    assert(joins===2 && writes===2 && saved[inviter].includes(room.roomId),'Transient failure did not retry');
    testRooms.delete(room.roomId);
  `);
  await check('image viewer cancels originals', `
    const original=MatrixChat.mxcToBlobUrl; let signal;
    MatrixChat.mxcToBlobUrl=(_mxc,opts)=>{signal=opts.signal;return new Promise(()=>{});};
    openImageViewer({thumbSrc:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',mxc:'mxc://local/test'});
    document.querySelector('.img-view-backdrop [data-act="close"]').click();
    assert(signal.aborted,'Original fetch survived closing'); MatrixChat.mxcToBlobUrl=original;
  `);
  await p.shot('chat-fixture');
  await check('Music avatar updates preserve rows and observer cleanup', `
    setActiveTab('music'); pickerTab='requests'; const resolve=window.klabResolveUserAvatar;
    window.klabResolveUserAvatar=()=>null; _musicRequests=[{id:123,username:'tester',title:'Test request',artist:'Test artist',req_type:'album',status:'pending'}];
    renderMusicRequestsList(); const row=pickerList.querySelector('.picker-item');
    window.klabResolveUserAvatar=()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    refreshRequestAvatars(); assert(pickerList.querySelector('.picker-item')===row && row.querySelector('.picker-item-requester img'),'Avatar update rebuilt the row');
    window.klabResolveUserAvatar=resolve;
    const album=_albumArtIO.unobserve.bind(_albumArtIO), artist=_artistThumbObserver.unobserve.bind(_artistThumbObserver);
    let released=0; _albumArtIO.unobserve=node=>{released++;album(node);}; _artistThumbObserver.unobserve=node=>{released++;artist(node);};
    const node=document.createElement('div'); pickerList.append(node); _albumArtIO.observe(node); _artistThumbObserver.observe(node); node.remove(); await pause(20);
    assert(released>=2,'Removed Music rows stayed observed'); _albumArtIO.unobserve=album; _artistThumbObserver.unobserve=artist;
  `);
  await check('slideshow close/reopen discards old asynchronous work', `
    const photos=window.klabPhotos, OriginalImage=window.Image, fullscreen=HTMLElement.prototype.requestFullscreen;
    const wakeDescriptor=Object.getOwnPropertyDescriptor(navigator,'wakeLock'); const decodes=[], fulls=[], wakes=[], selected=[];
    const items=['a','b','c'].map(id=>({ph:{id},post:{username:id,created:'2026-10-06 12:00:00',photos:[],text:id}}));
    window.klabPhotos={items:()=>items,current:()=> 'a',url:ph=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=#'+ph.id,
      hasOlder:()=>false,avatarHTML:()=>'',fmtShot:()=>'',stopSong(){},releaseMusic(){},holdMusic(){},show:id=>selected.push(id)};
    window.Image=class { decode(){return new Promise((resolve,reject)=>decodes.push({resolve,reject,id:this.src.split('#').at(-1)}));} };
    HTMLElement.prototype.requestFullscreen=function(){return new Promise(resolve=>fulls.push(resolve));};
    Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{request:()=>new Promise(resolve=>wakes.push(resolve))}});
    klabSlideshow.open(); klabSlideshow.close(); klabSlideshow.open();
    let released=0; wakes[0]({release(){released++;}}); fulls[0](); decodes[0].reject(new Error('old picture failed'));
    await pause(20); assert(released===1 && decodes.length===2,'Old lifecycle affected the reopened slideshow');
    wakes[1]({released:false,release(){released++;}}); fulls[1](); decodes[1].resolve(); await pause(30);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}));
    assert(decodes.length===4,'Rapid Next did not load both candidates');
    decodes[3].resolve(); await pause(20); decodes[2].resolve(); await pause(20);
    klabSlideshow.close(); assert(selected.at(-1)===decodes[3].id,'Older decode replaced the last Next');
    window.Image=OriginalImage; window.klabPhotos=photos; HTMLElement.prototype.requestFullscreen=fullscreen;
    if(wakeDescriptor)Object.defineProperty(navigator,'wakeLock',wakeDescriptor);else delete navigator.wakeLock;
    await pause(450);
  `);
  await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await check('phone Chat Back/Forward', `
    assert(matchMedia(KLAB_PHONE_MQ).matches,'Phone emulation not active');
    setActiveTab('home'); await pause(100); setActiveTab('chat'); await pause(100); setChatMobileView('convo'); await pause(100);
    const at=history.state.klabAt, length=history.length;
    setChatMobileView('rooms'); await pause(150);
    assert(document.body.classList.contains('chat-rooms-view'),'Phone Back did not show the room list');
    assert(history.state.klabAt===at-1 && history.length===length,'Phone Back pushed a new entry');
    history.forward(); await pause(150);
    assert(!document.body.classList.contains('chat-rooms-view'),'Forward did not restore conversation');
  `);
  await p.shot('phone-chat');
};
