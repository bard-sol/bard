(function(){
var state={projects:[]},currentProjectId=null,currentCampaignId=null,dataMode='local',wallet=null,provider=null;
function toast(msg,kind){var el=document.getElementById('toast');el.textContent=msg;el.className='toast is-on'+(kind?' '+kind:'');clearTimeout(toast._t);toast._t=setTimeout(function(){el.className='toast';},3200);}
function show(name){document.querySelectorAll('.page').forEach(function(p){p.classList.remove('is-on');});var page=document.getElementById('page-'+name);if(page)page.classList.add('is-on');window.scrollTo(0,0);}
function initials(s){s=(s||'?').trim();return s.slice(0,2).toUpperCase();}
function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');}
function shortMint(m){if(!m||m.length<10)return m||'—';return m.slice(0,4)+'…'+m.slice(-4);}
function shortAddr(a){if(!a)return'—';if(a.length<10)return a;return a.slice(0,4)+'…'+a.slice(-4);}
function formatDate(iso){try{return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}catch(e){return'—';}}
function findProject(id){return state.projects.find(function(p){return p.id===id;});}
function findCampaign(pid,cid){var p=findProject(pid);if(!p)return null;return(p.campaigns||[]).find(function(c){return c.id===cid;});}
function activeCount(p){return(p.campaigns||[]).filter(function(c){return c.status==='active';}).length;}
function updateWalletUI(){var btn=document.getElementById('btn-wallet');if(wallet){btn.textContent=shortAddr(wallet);btn.classList.add('is-on');}else{btn.textContent='Connect wallet';btn.classList.remove('is-on');}var hint=document.getElementById('onboard-wallet-hint');if(hint){if(BardPlatform.feesEnabled&&BardPlatform.feesEnabled()){hint.textContent=wallet?'You will sign a 0.25 SOL transfer from '+shortAddr(wallet)+' to the platform treasury.':'Connect a wallet in the header first.';}else{hint.textContent='Fees are off for testing — create freely. Wallet optional.';}}}
async function connectWallet(){try{var p=(window.phantom&&window.phantom.solana)||window.solflare||window.solana;if(!p){toast('No Solana wallet found. Install Phantom or Solflare.','err');return;}var resp=await p.connect();wallet=(resp.publicKey&&resp.publicKey.toString())||(p.publicKey&&p.publicKey.toString());if(!wallet){toast('Could not read wallet address','err');return;}provider=p;localStorage.setItem('bard_team_wallet',wallet);updateWalletUI();toast('Wallet connected','ok');}catch(e){console.error(e);toast('Connection cancelled or failed','err');}}
function disconnectWallet(){wallet=null;provider=null;localStorage.removeItem('bard_team_wallet');updateWalletUI();}
async function refreshState(){if(window.BardPlatform){await BardPlatform.init();dataMode=BardPlatform.getMode();state.projects=await BardPlatform.listProjects();var badge=document.getElementById('data-mode');if(badge)badge.textContent=dataMode==='supabase'?'· Live DB':'· Local only';}}
function renderHome(){var list=document.getElementById('project-list');var totalCamps=0;state.projects.forEach(function(p){totalCamps+=activeCount(p);});document.getElementById('stat-projects').textContent=state.projects.length;document.getElementById('stat-campaigns').textContent=totalCamps;renderInbox();if(!state.projects.length){list.innerHTML='<div class="empty"><h3>No projects yet</h3><p>Onboard your first token to start running campaigns.</p><button class="btn btn--solid" id="empty-onboard">Onboard a project</button></div>';document.getElementById('empty-onboard').onclick=function(){show('onboard');};return;}list.innerHTML=state.projects.map(function(p){var n=(p.campaigns||[]).length;var a=activeCount(p);var feePill=p.feePaid?'<span class="pill pill--paid">Fee paid</span>':'<span class="pill pill--pending">Fee pending</span>';
    var vaultPill=p.vaultAddress?'<span class="pill pill--paid">Vault locked</span>':'';
    var planPill=p.plan==='starter'||p.plan==='pro'?'<span class="pill pill--live">'+(p.plan==='pro'?'Pro':'Starter')+'</span>':'<span class="pill pill--draft">Free</span>';return'<div class="card card--hover" data-open-project="'+p.id+'"><div class="item" style="padding:0;border:none"><span class="item__ava">'+initials(p.ticker||p.name)+'</span><div class="item__body"><div class="item__title">'+escapeHtml(p.name)+' <span class="muted">· $'+escapeHtml(p.ticker)+'</span></div><div class="item__sub">'+escapeHtml(shortMint(p.mint))+' · '+n+' campaign'+(n===1?'':'s')+'</div></div><div class="item__right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">'+(a?'<span class="pill pill--live">'+a+' active</span>':'<span class="pill pill--draft">No live</span>')+planPill+vaultPill+feePill+'</div></div></div>';}).join('');list.querySelectorAll('[data-open-project]').forEach(function(el){el.addEventListener('click',function(){openProject(el.getAttribute('data-open-project'));});});}
async function renderInbox(){
  var box=document.getElementById('home-inbox');
  if(!box) return;
  box.innerHTML='';
  if(!BardPlatform.listOpenSettlements) return;
  var rows=[];
  try{ rows = await BardPlatform.listOpenSettlements(); }catch(e){ return; }
  if(!rows.length) return;
  box.innerHTML=rows.map(function(s){
    var p=state.projects.find(function(x){ return x.id===s.project_id; });
    var c=(p&&p.campaigns||[]).find(function(x){ return x.id===s.campaign_id; });
    var ticker=p?p.ticker:'TOKEN';
    var title=c?c.title:'Airdrop';
    var n=(s.payouts||[]).length;
    var team=!!s.team_signed;
    var bard=!!s.bard_signed;
    var needTeam=!team;
    var line=needTeam
      ? 'Sign to release this airdrop. Bard signs the other key.'
      : (bard ? 'Both signed — paying.' : 'You signed. Waiting for Bard to sign.');
    var btn=needTeam?'<button class="btn btn--solid btn--sm" data-open-settle="'+s.campaign_id+'" data-open-project-id="'+s.project_id+'">Sign now</button>'
      : '<button class="btn btn--ghost btn--sm" data-open-settle="'+s.campaign_id+'" data-open-project-id="'+s.project_id+'">View</button>';
    return '<div class="notify"><h3>Airdrop ready · '+escapeHtml(title)+'</h3><p>'+escapeHtml(fmtAmt(s.total))+' $'+escapeHtml(ticker)+' to '+n+' holder'+(n===1?'':'s')+'. '+line+'</p><div class="signers" style="margin-top:0;margin-bottom:12px"><div class="signer '+(team?'is-yes':'is-wait')+'"><b>You</b><span>'+(team?'Signed':'Needs your signature')+'</span></div><div class="signer '+(bard?'is-yes':'is-wait')+'"><b>Bard</b><span>'+(bard?'Signed':'Waiting')+'</span></div></div>'+btn+'</div>';
  }).join('');
  box.querySelectorAll('[data-open-settle]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var pid=btn.getAttribute('data-open-project-id');
      var cid=btn.getAttribute('data-open-settle');
      currentProjectId=pid;
      openCampaign(cid);
    });
  });
}
function openProject(id){var p=findProject(id);if(!p)return;currentProjectId=id;document.getElementById('proj-kicker').textContent='$'+p.ticker;document.getElementById('proj-title').textContent=p.name;document.getElementById('proj-meta').textContent=shortMint(p.mint)+' · onboarded '+formatDate(p.createdAt);renderProjectTabs('campaigns');show('project');}
function vaultBadgeHtml(p, extra){
  var addr=p.vaultAddress||'';
  var locked=!!addr;
  var title=locked?'Locked in 2-of-2 vault — no single party can withdraw.':'Lock rewards where holders can see them.';
  var body=locked
    ? 'Squads 2-of-2 (your key + Bard). Balance is on-chain — holders can verify on Solscan.'
    : 'Deposit once. Neither you nor Bard can move funds alone. Example: lock 10M $'+escapeHtml(p.ticker||'TOKEN')+' before the board goes live.';
  var link=addr?'<a class="btn btn--ghost btn--sm" href="https://solscan.io/account/'+encodeURIComponent(addr)+'" target="_blank" rel="noopener">View on Solscan</a>':'';
  return '<div class="vault-badge"><div class="vault-badge__mark"><img src="/transparentbardsmile.png" alt=""></div><div style="flex:1;min-width:0"><strong>'+title+'</strong><p>'+body+'</p>'+(extra||'')+'</div>'+link+'</div>';
}
function fmtAmt(n){if(n==null||n===''||isNaN(Number(n)))return'—';var x=Number(n);if(x>=1e6)return(x/1e6).toFixed(2)+'M';if(x>=1e3)return(x/1e3).toFixed(2)+'k';return String(x);}
async function renderVaultPanel(p){
  var el=document.getElementById('proj-vault');
  var bard=BardPlatform.getVaultBardMember?BardPlatform.getVaultBardMember():'';
  var addr=p.vaultAddress||'';
  var mint=p.vaultMint||p.mint||'';
  var reserved=Number(p.vaultReserved||0);
  var hasSdk=!!(window.BardVault&&BardVault.createTwoOfTwo);
  var starter=(p.plan||'free')!=='free';
  el.innerHTML=vaultBadgeHtml(p)+
    '<div class="card" style="margin-bottom:12px"><p class="kicker">How it works</p>'+
    '<p style="margin:0;color:var(--body)">You and Bard each hold one key. Threshold 2. Example: lock 10M $'+escapeHtml(p.ticker)+'. When an airdrop is ready, you get a sign notice. You sign. Bard signs. Then it pays. Neither of us can move funds alone.</p></div>'+
    (starter?'':'<div class="plan-lock" style="margin-bottom:12px">Starter unlocks the vault. Free plan is raids only. <button type="button" class="btn btn--solid btn--sm" id="vault-go-starter">Unlock Starter</button></div>')+
    '<div class="card" style="margin-bottom:12px"><div class="form">'+
    (addr?'':'<button type="button" class="btn btn--solid" id="btn-create-vault"'+(starter?'':' disabled')+'>Create 2-of-2 vault</button><span class="hint">One Phantom signature. We add your wallet + Bard as the two members.</span>')+
    (addr?'<p class="muted" style="margin:0 0 12px;font-size:.88rem">Vault is live. Deposit $'+escapeHtml(p.ticker)+' to this address. Holders can verify on Solscan.</p>':'')+
    '<div class="field"><label>Vault address</label><div class="copy-row"><input class="inp num" id="vault-addr" value="'+escapeHtml(addr)+'" placeholder="Created here, or paste a Squads vault"><button type="button" class="btn btn--ghost btn--sm" id="btn-save-vault">Save</button></div></div>'+
    '<div class="field"><label>Token mint</label><input class="inp num" id="vault-mint" value="'+escapeHtml(mint)+'"></div>'+
    '<div class="field"><label>Bard key (second signer)</label><input class="inp num" id="vault-bard-key" readonly value="'+escapeHtml(bard)+'"></div>'+
    '</div></div>'+
    '<div class="grid-2" id="vault-stats">'+
    '<div class="stat"><div class="stat__lbl">On-chain balance</div><div class="stat__val p num" id="vault-bal">…</div></div>'+
    '<div class="stat"><div class="stat__lbl">Reserved for campaigns</div><div class="stat__val num" id="vault-res">'+escapeHtml(fmtAmt(reserved))+'</div></div>'+
    '</div>'+
    '<p class="muted" style="margin:12px 0 0;font-size:.82rem" id="vault-bal-meta">Reading chain…</p>';
  var goS=document.getElementById('vault-go-starter');
  if(goS) goS.onclick=function(){ renderProjectTabs('settings'); };
  var createBtn=document.getElementById('btn-create-vault');
  if(createBtn) createBtn.onclick=async function(){
    if(!wallet||!provider){ toast('Connect the team wallet first','err'); await connectWallet(); return; }
    if(!hasSdk){ toast('Vault toolkit failed to load — refresh','err'); return; }
    var btn=this; btn.disabled=true; btn.textContent='Confirm in wallet…';
    try{
      var rpc=BardPlatform.getRpc();
      var out=await BardVault.createTwoOfTwo(rpc, provider, wallet, bard);
      await BardPlatform.updateProjectVault(p.id,{ address:out.vault, mint:p.mint, multisig:out.multisig });
      await refreshState();
      toast('2-of-2 vault created on-chain','ok');
      renderVaultPanel(findProject(p.id)||p);
    }catch(e){
      console.error(e);
      toast((e&&e.message)||'Vault create cancelled','err');
    }finally{ btn.disabled=false; btn.textContent='Create 2-of-2 vault'; }
  };
  document.getElementById('btn-save-vault').onclick=async function(){
    var a=document.getElementById('vault-addr').value.trim();
    var m=document.getElementById('vault-mint').value.trim()||p.mint;
    var btn=this;btn.disabled=true;btn.textContent='Saving…';
    try{
      await BardPlatform.updateProjectVault(p.id,{address:a,mint:m,multisig:p.vaultMultisig||null});
      await refreshState();
      toast(a?'Vault saved':'Vault cleared','ok');
      renderVaultPanel(findProject(p.id)||p);
    }catch(e){toast((e&&e.message)||'Could not save vault','err');}
    finally{btn.disabled=false;btn.textContent='Save';}
  };
  if(addr && BardPlatform.fetchVaultOnchain){
    BardPlatform.fetchVaultOnchain(addr, mint).then(function(info){
      var avail=Math.max(0, Number(info.uiAmount||0)-reserved);
      document.getElementById('vault-bal').textContent=fmtAmt(info.uiAmount)+' $'+p.ticker;
      document.getElementById('vault-bal-meta').innerHTML='Available ~ '+fmtAmt(avail)+' · <a href="'+escapeHtml(info.solscan)+'" target="_blank" rel="noopener" style="color:var(--purple)">Solscan</a>';
    }).catch(function(e){
      document.getElementById('vault-bal').textContent='—';
      document.getElementById('vault-bal-meta').textContent=(e&&e.message)||'Could not read on-chain balance';
    });
  } else {
    document.getElementById('vault-bal').textContent='—';
    document.getElementById('vault-bal-meta').textContent='Create the vault to read the on-chain balance.';
  }
}
function renderProjectTabs(tab){var p=findProject(currentProjectId);if(!p)return;document.querySelectorAll('#page-project .tab').forEach(function(t){t.classList.toggle('is-on',t.getAttribute('data-tab')===tab);});var campsEl=document.getElementById('proj-campaigns');var setEl=document.getElementById('proj-settings');var vaultEl=document.getElementById('proj-vault');if(tab==='vault'){campsEl.style.display='none';setEl.style.display='none';vaultEl.style.display='block';renderVaultPanel(p);return;}if(tab==='settings'){campsEl.style.display='none';if(vaultEl)vaultEl.style.display='none';setEl.style.display='block';var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();var feeStatus=!feesOn?'<span class="pill pill--paid">waived (testing)</span>':(p.feePaid?'<span class="pill pill--paid">paid</span>':'<span class="pill pill--pending">pending</span>');setEl.innerHTML='<div class="card"><div class="form"><div class="field"><label>Name</label><div>'+escapeHtml(p.name)+'</div></div><div class="field"><label>Ticker</label><div>$'+escapeHtml(p.ticker)+'</div></div><div class="field"><label>Mint</label><div class="num" style="word-break:break-all">'+escapeHtml(p.mint)+'</div></div><div class="field"><label>Plan</label><div>'+escapeHtml((p.plan||'free'))+(p.plan==='free'?' · raids only':' · vault, boards, pools, airdrops')+'</div>'+(p.plan==='free'?'<button type="button" class="btn btn--solid btn--sm" id="btn-upgrade-starter" style="margin-top:10px">Upgrade to Starter (1 SOL)</button>':'')+'</div><div class="field"><label>Onboard fee</label><div>'+feeStatus+'</div></div><div class="field"><label>Data mode</label><div>'+escapeHtml(dataMode)+'</div></div></div></div>';
      var up=document.getElementById('btn-upgrade-starter');
      if(up) up.onclick=async function(){
        var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();
        try{
          if(feesOn){
            if(!wallet||!provider){ toast('Connect a wallet first','err'); await connectWallet(); return; }
            up.disabled=true; up.textContent='Confirm 1 SOL…';
            await BardPlatform.payFee('starter',wallet,provider,{projectId:p.id});
          }
          await BardPlatform.setProjectPlan(p.id,'starter');
          await refreshState();
          toast('Starter unlocked','ok');
          renderProjectTabs('settings');
        }catch(e){ toast((e&&e.message)||'Upgrade failed','err'); }
        finally{ up.disabled=false; up.textContent='Upgrade to Starter (1 SOL)'; }
      };
      return;}if(vaultEl)vaultEl.style.display='none';setEl.style.display='none';campsEl.style.display='block';var camps=p.campaigns||[];if(!camps.length){campsEl.innerHTML='<div class="empty"><h3>No campaigns yet</h3><p>Create a hold, raid, refer, or custom campaign for $'+escapeHtml(p.ticker)+'.</p><button class="btn btn--solid" id="empty-camp">New campaign</button></div>';document.getElementById('empty-camp').onclick=function(){resetCampaignBuilder();show('new-campaign');};return;}campsEl.innerHTML=camps.slice().reverse().map(function(c){var pill=c.status==='active'?'pill--live':(c.status==='ended'?'pill--ended':'pill--draft');var fee=c.feePaid?'<span class="pill pill--paid">fee paid</span>':'<span class="pill pill--pending">fee pending</span>';var sub=[c.type,(c.accessMode||c.access_mode)==='approval'?'approval':'open',c.rewardMode||c.reward_mode||'fixed',(c.rule||'').slice(0,48)].filter(Boolean).join(' · ');return'<div class="card card--hover" data-open-camp="'+c.id+'"><div class="item" style="padding:0;border:none"><div class="item__body"><div class="item__title">'+escapeHtml(c.title)+'</div><div class="item__sub">'+escapeHtml(sub)+((c.rule||'').length>48?'…':'')+'</div></div><div class="item__right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="pill '+pill+'">'+escapeHtml(c.status)+'</span>'+fee+'</div></div></div>';}).join('');campsEl.querySelectorAll('[data-open-camp]').forEach(function(el){el.addEventListener('click',function(){openCampaign(el.getAttribute('data-open-camp'));});});}
function openCampaign(cid){var c=findCampaign(currentProjectId,cid);var p=findProject(currentProjectId);if(!c||!p)return;currentCampaignId=cid;document.getElementById('camp-kicker').textContent=p.name+' · $'+p.ticker;document.getElementById('camp-title').textContent=c.title;document.getElementById('camp-rule').textContent=c.rule;var st=document.getElementById('camp-status');st.textContent=c.status;st.className='pill '+(c.status==='active'?'pill--live':'pill--ended');var access=c.accessMode||c.access_mode||'open';var rewardMode=c.rewardMode||c.reward_mode||'fixed';var raidMode=c.raidMode||c.raid_mode||null;document.getElementById('camp-access-pill').textContent=access==='approval'?'Approval required':'Open join';document.getElementById('camp-reward-pill').textContent=({fixed:'Fixed payout',top3:'Top 3',pool:'Shared pool',growing:'Growing pool',vested:'Vested'})[rewardMode]||rewardMode;var raidPill=document.getElementById('camp-raid-pill');if(c.type==='raid'&&raidMode){raidPill.style.display='';raidPill.textContent=({open:'Open raid',post:'Specific post',kol_list:'KOL targets'})[raidMode]||raidMode;}else{raidPill.style.display='none';}var poolLabel=(c.pool||'—')+(c.unit?' '+c.unit:'');if(c.reward)poolLabel=(c.reward+' '+(c.unit||'')+' · pool '+poolLabel).trim();document.getElementById('camp-pool').textContent=poolLabel;document.getElementById('camp-claims').textContent=(c.settled||0);
    var badge=document.getElementById('camp-vault-badge');
    if(badge){
      if(p.vaultAddress){
        var locked=Number(c.vaultReserved||0);
        badge.innerHTML=vaultBadgeHtml(p, locked?('<p style="margin-top:8px">This campaign has <b class="num">'+escapeHtml(fmtAmt(locked))+' $'+escapeHtml(p.ticker)+'</b> reserved from the vault.</p>'):'');
        badge.style.display='block';
      } else { badge.innerHTML=''; badge.style.display='none'; }
    }
    loadCampaignOps(p, c);
    document.getElementById('btn-end-campaign').style.display=c.status==='active'?'':'none';show('campaign');}
async function loadCampaignOps(p,c){
  var tbody=document.getElementById('camp-lb');
  var box=document.getElementById('camp-settle');
  tbody.innerHTML='<tr><td class="muted" colspan="5">Loading holders…</td></tr>';
  if(box) box.innerHTML='';
  var joins=[];
  try{ joins = await BardPlatform.listJoinsForCampaign(c.id); }catch(e){ console.error(e); }
  if(!joins.length){
    tbody.innerHTML='<tr><td class="muted" colspan="5">No joins yet. Holders enter from the dashboard.</td></tr>';
  } else {
    tbody.innerHTML=joins.map(function(j){
      var st=j.qualified?'Qualified':(j.status||'approved');
      var pill=j.qualified?'pill--paid':(j.status==='pending'?'pill--pending':(j.status==='rejected'?'pill--ended':'pill--live'));
      var acts='';
      if(j.status==='pending') acts+='<button class="btn btn--ghost btn--sm" data-js="approve" data-w="'+escapeHtml(j.wallet)+'">Approve</button> <button class="btn btn--ghost btn--sm" data-js="reject" data-w="'+escapeHtml(j.wallet)+'">Reject</button> ';
      if(j.status==='approved'||j.qualified) acts+='<button class="btn btn--ghost btn--sm" data-js="plus" data-w="'+escapeHtml(j.wallet)+'" data-p="'+(j.progress||0)+'">+1</button> <button class="btn btn--ghost btn--sm" data-js="minus" data-w="'+escapeHtml(j.wallet)+'" data-p="'+(j.progress||0)+'">−1</button> ';
      if(!j.qualified && j.status!=='rejected') acts+='<button class="btn btn--solid btn--sm" data-js="qual" data-w="'+escapeHtml(j.wallet)+'">Qualify</button>';
      return '<tr><td class="num">'+escapeHtml(shortAddr(j.wallet))+'</td><td>'+escapeHtml(j.x_handle||'—')+'</td><td class="num">'+(j.progress||0)+'</td><td><span class="pill '+pill+'">'+escapeHtml(st)+'</span></td><td style="white-space:nowrap">'+acts+'</td></tr>';
    }).join('');
    tbody.querySelectorAll('[data-js]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var w=btn.getAttribute('data-w'); var act=btn.getAttribute('data-js'); var prog=parseInt(btn.getAttribute('data-p')||'0',10);
        try{
          if(act==='approve') await BardPlatform.setJoinStatus(c.id,w,'approved');
          if(act==='reject') await BardPlatform.setJoinStatus(c.id,w,'rejected');
          if(act==='plus') await BardPlatform.setJoinProgress(c.id,w,prog+1);
          if(act==='minus') await BardPlatform.setJoinProgress(c.id,w,Math.max(0,prog-1));
          if(act==='qual') await BardPlatform.markQualified(p.id,c.id,w);
          await refreshState();
          openCampaign(c.id);
        }catch(err){ toast((err&&err.message)||'Update failed','err'); }
      });
    });
  }
  var sets=[];
  try{ sets = await BardPlatform.listSettlements(c.id); }catch(e){ console.error(e); }
  renderSettleBox(p,c,joins,sets);
}
function renderSettleBox(p,c,joins,sets){
  var box=document.getElementById('camp-settle');
  if(!box) return;
  var live=sets.filter(function(s){ return s.status!=='cancelled' && s.status!=='executed'; })[0];
  var done=sets.filter(function(s){ return s.status==='executed'; })[0];
  if(done && !live){
    box.innerHTML='<div class="signers"><div class="signer is-yes"><b>You</b><span>Signed</span></div><div class="signer is-yes"><b>Bard</b><span>Signed</span></div></div><p class="muted" style="margin:0">Paid'+(done.tx_signature?' · <a href="https://solscan.io/tx/'+encodeURIComponent(done.tx_signature)+'" target="_blank" rel="noopener" style="color:var(--purple)">tx</a>':'')+'.</p>';
    return;
  }
  if(!live){
    var n=(joins||[]).filter(function(j){ return j.qualified || (j.status==='approved' && (j.progress||0)>0); }).length;
    box.innerHTML='<p class="muted" style="margin:0;font-size:.88rem">'+n+' holder'+(n===1?'':'s')+' ready. Propose the airdrop — Bard fills amounts. Then you both sign here.</p>';
    return;
  }
  var team=!!live.team_signed;
  var bard=!!live.bard_signed;
  var rows=(live.payouts||[]).map(function(x,i){
    return '<tr><td class="num">'+(i+1)+'</td><td class="num">'+escapeHtml(shortAddr(x.wallet))+'</td><td class="num">'+escapeHtml(String(x.amount))+' $'+escapeHtml(p.ticker)+'</td></tr>';
  }).join('');
  var actions='';
  if(!team){
    actions='<button class="btn btn--solid" type="button" id="btn-cosign">Sign this airdrop</button>';
  } else if(!bard){
    actions='<p class="muted" style="margin:0;font-size:.88rem">You signed. Waiting for Bard to sign the other key.</p>';
  } else {
    actions='<button class="btn btn--solid" type="button" id="btn-exec-settle">Release payment</button>';
  }
  box.innerHTML='<p style="margin:0 0 8px;font-size:.92rem">Airdrop · <b class="num">'+escapeHtml(fmtAmt(live.total))+' $'+escapeHtml(p.ticker)+'</b> to '+(live.payouts||[]).length+' holders</p>'+
    '<div class="signers"><div class="signer '+(team?'is-yes':'is-wait')+'"><b>You</b><span>'+(team?'Signed':'Needs your signature')+'</span></div><div class="signer '+(bard?'is-yes':'is-wait')+'"><b>Bard</b><span>'+(bard?'Signed':'Waiting')+'</span></div></div>'+
    '<div style="overflow-x:auto"><table class="table"><thead><tr><th>#</th><th>Wallet</th><th>Amount</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div style="margin-top:12px">'+actions+'</div>';
  var cs=document.getElementById('btn-cosign');
  if(cs) cs.onclick=function(){ cosignCurrent(p,c,live); };
  var ex=document.getElementById('btn-exec-settle');
  if(ex) ex.onclick=function(){ executeCurrent(p,c,live); };
}
async function pingBardSign(live){
  try{
    var res=await fetch('/api/vault/bard-sign',{ method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ settlementId: live.id, multisig: live.vault_multisig, txIndex: live.tx_index }) });
    var data=await res.json();
    if(data && data.ok){
      await BardPlatform.signSettlement(live.id,'bard',{});
      return true;
    }
  }catch(e){}
  return false;
}
async function cosignCurrent(p,c,live){
  if(!wallet||!provider){ toast('Connect the team wallet first','err'); await connectWallet(); return; }
  try{
    var rpc=BardPlatform.getRpc && BardPlatform.getRpc();
    var extra={ wallet: wallet, sig: 'team' };
    if(window.BardVault && BardVault.proposePayouts && (p.vaultMultisig || live.vault_multisig) && live.payouts && live.payouts.length){
      var ms=p.vaultMultisig || live.vault_multisig;
      var mint=p.vaultMint || p.mint;
      toast('Confirm the payout in your wallet','ok');
      var out=await BardVault.proposePayouts(rpc, provider, wallet, ms, mint, live.payouts);
      extra.sig=out.signature;
      extra.txIndex=out.transactionIndex;
      extra.multisig=ms;
    } else if(provider.signMessage){
      var enc=new TextEncoder().encode('BARD_SETTLE:'+live.id+':'+(live.payout_hash||''));
      var outm=await provider.signMessage(enc,'utf8');
      extra.sig=(outm&&outm.signature)?'signed':'signed';
    }
    await BardPlatform.signSettlement(live.id,'team',extra);
    toast('You signed. Waiting for Bard.','ok');
    pingBardSign(Object.assign({}, live, extra)).then(function(ok){
      if(ok) toast('Bard signed. Both keys are on.','ok');
      openCampaign(c.id);
    });
    openCampaign(c.id);
  }catch(e){
    if(/rejected|denied|cancel/i.test(String(e&&e.message))) toast('Signature cancelled','err');
    else toast((e&&e.message)||'Sign failed','err');
  }
}
async function executeCurrent(p,c,live){
  try{
    var tx='released';
    if(window.BardVault && BardVault.executePayout && (p.vaultMultisig||live.vault_multisig) && live.tx_index && wallet && provider){
      tx=await BardVault.executePayout(BardPlatform.getRpc(), provider, wallet, p.vaultMultisig||live.vault_multisig, live.tx_index);
    }
    await BardPlatform.executeSettlement(live.id, tx, p.id);
    toast('Paid. Holders settled.','ok');
    await refreshState();
    openCampaign(c.id);
  }catch(e){ toast((e&&e.message)||'Could not release payment','err'); }
}
function setChoiceGroup(selector,attr,value,hiddenId){document.querySelectorAll(selector).forEach(function(btn){btn.classList.toggle('is-on',btn.getAttribute(attr)===value);});if(hiddenId)document.getElementById(hiddenId).value=value;}
function syncCampaignBuilder(){var type=document.getElementById('c-type').value;var raidMode=document.getElementById('c-raid-mode').value;var rewardMode=document.getElementById('c-reward-mode').value;var access=document.getElementById('c-access').value;var days=document.getElementById('c-days').value||'7';document.getElementById('mod-raid').classList.toggle('is-on',type==='raid');document.getElementById('mod-hold').classList.toggle('is-on',type==='hold');document.getElementById('mod-post-url').classList.toggle('is-on',type==='raid'&&raidMode==='post');document.getElementById('mod-targets').classList.toggle('is-on',type==='raid'&&raidMode==='kol_list');document.getElementById('mod-top3').classList.toggle('is-on',rewardMode==='top3');document.getElementById('c-reward-label').textContent=({fixed:'Reward per claim',top3:'Pool for top 3',pool:'Total shared pool',growing:'Starting pool size',vested:'Total vested amount'})[rewardMode]||'Reward amount';document.getElementById('c-pool-label').textContent=rewardMode==='fixed'?'Max pool / budget':'Total pool size';var bits=[access==='approval'?'Approval required':'Open join',type];if(type==='raid')bits.push(({open:'open raid',post:'specific post',kol_list:'KOL targets'})[raidMode]||raidMode);bits.push(({fixed:'fixed',top3:'top 3',pool:'shared pool',growing:'growing',vested:'vested'})[rewardMode]||rewardMode);bits.push(days+' days');document.getElementById('camp-preview-text').textContent=bits.join(' · ');
  var p=findProject(currentProjectId); var note=document.getElementById('c-plan-note');
  if(note){
    var premium=BardPlatform.isPremiumType&&BardPlatform.isPremiumType(type);
    if(p && (p.plan||'free')==='free' && premium){
      note.style.display='block';
      note.innerHTML='Starter unlocks this. Raids stay free. <button type="button" class="btn btn--solid btn--sm" id="c-go-starter">Unlock Starter</button>';
      var go=document.getElementById('c-go-starter');
      if(go) go.onclick=function(){ show('project'); renderProjectTabs('settings'); };
    } else { note.style.display='none'; note.innerHTML=''; }
  }
}
function resetCampaignBuilder(){document.getElementById('form-campaign').reset();document.getElementById('c-type').value='raid';document.getElementById('c-access').value='open';document.getElementById('c-raid-mode').value='open';document.getElementById('c-reward-mode').value='fixed';document.getElementById('c-days').value='7';setChoiceGroup('[data-access]','data-access','open','c-access');setChoiceGroup('[data-raid]','data-raid','open','c-raid-mode');setChoiceGroup('[data-reward]','data-reward','fixed','c-reward-mode');syncCampaignBuilder();}
document.querySelectorAll('[data-access]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-access]','data-access',btn.getAttribute('data-access'),'c-access');syncCampaignBuilder();});});
document.querySelectorAll('[data-raid]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-raid]','data-raid',btn.getAttribute('data-raid'),'c-raid-mode');syncCampaignBuilder();});});
document.querySelectorAll('[data-reward]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-reward]','data-reward',btn.getAttribute('data-reward'),'c-reward-mode');syncCampaignBuilder();});});
document.getElementById('c-type').addEventListener('change',syncCampaignBuilder);
document.getElementById('c-days').addEventListener('input',syncCampaignBuilder);
syncCampaignBuilder();
document.querySelectorAll('[data-plan]').forEach(function(btn){
  btn.addEventListener('click',function(){
    document.getElementById('p-plan').value=btn.getAttribute('data-plan');
    document.querySelectorAll('[data-plan]').forEach(function(b){ b.classList.toggle('is-on', b===btn); });
    var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();
    var plan=btn.getAttribute('data-plan');
    document.getElementById('onboard-fee-lbl').textContent=plan==='starter'?'Starter pack':'Raids';
    document.getElementById('onboard-fee-amt').textContent=plan==='starter'?(feesOn?'1 SOL':'free while testing'):'0 SOL';
  });
});
document.getElementById('btn-wallet').onclick=function(){if(wallet){if(confirm('Disconnect wallet?'))disconnectWallet();}else connectWallet();};
document.getElementById('btn-new-project').onclick=function(){show('onboard');};
document.getElementById('btn-new-campaign').onclick=function(){if(!findProject(currentProjectId)){toast('Open a project first','err');return;}resetCampaignBuilder();show('new-campaign');};
document.querySelectorAll('[data-go]').forEach(function(btn){btn.addEventListener('click',function(){var go=btn.getAttribute('data-go');if(go==='home'){renderHome();show('home');}else show(go);});});
document.getElementById('back-from-campaign').onclick=function(){openProject(currentProjectId);};
document.getElementById('back-from-detail').onclick=function(){openProject(currentProjectId);};
document.querySelectorAll('#page-project .tab').forEach(function(t){t.addEventListener('click',function(){renderProjectTabs(t.getAttribute('data-tab'));});});
document.getElementById('form-onboard').addEventListener('submit',async function(e){e.preventDefault();var name=document.getElementById('p-name').value.trim();var ticker=document.getElementById('p-ticker').value.trim().replace(/^\$/,'').toUpperCase();var mint=document.getElementById('p-mint').value.trim();var plan=(document.getElementById('p-plan')&&document.getElementById('p-plan').value)||'free';
    if(!name||!ticker||!mint){toast('Fill in name, ticker, and mint','err');return;}var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();if(feesOn&&plan==='starter'&&(!wallet||!provider)){toast('Connect a wallet first','err');await connectWallet();return;}var btn=document.getElementById('btn-submit-onboard');btn.disabled=true;btn.textContent='Creating…';try{var project=await BardPlatform.createProject({name:name,ticker:ticker,mint:mint,admin:wallet||null,plan:plan});if(feesOn&&plan==='starter'&&wallet&&provider){btn.textContent='Confirm 1 SOL in wallet…';var result=await BardPlatform.payFee('starter',wallet,provider,{projectId:project.id});await BardPlatform.setProjectPlan(project.id,'starter');await refreshState();toast(result.ok?'Starter live · 1 SOL paid':'Project created · payment pending','ok');}else{await refreshState();toast(plan==='starter'?'Starter unlocked (testing)':'Project created · free raids','ok');}document.getElementById('form-onboard').reset();openProject(project.id);}catch(err){console.error(err);toast((err&&err.message)||'Failed to create project','err');}finally{btn.disabled=false;btn.textContent=feesOn?'Create project & pay 0.25 SOL':'Create project';}});
document.getElementById('form-campaign').addEventListener('submit',async function(e){e.preventDefault();var p=findProject(currentProjectId);if(!p)return;var title=document.getElementById('c-title').value.trim();var type=document.getElementById('c-type').value;var rule=document.getElementById('c-rule').value.trim();var reward=document.getElementById('c-reward').value.trim();var unit=document.getElementById('c-unit').value;var pool=document.getElementById('c-pool').value.trim();var days=parseInt(document.getElementById('c-days').value,10)||7;var accessMode=document.getElementById('c-access').value||'open';var rewardMode=document.getElementById('c-reward-mode').value||'fixed';var raidMode=type==='raid'?(document.getElementById('c-raid-mode').value||'open'):null;var postUrl=document.getElementById('c-post-url').value.trim();var targets=document.getElementById('c-targets').value.trim();var bonusHandle=document.getElementById('c-bonus').value.trim().replace(/^@/,'');if(bonusHandle)bonusHandle='@'+bonusHandle;var minBal=document.getElementById('c-min-bal').value.trim();var holdDays=document.getElementById('c-hold-days').value.trim();var top3=document.getElementById('c-top3').value.trim();if(!title||!rule){toast('Add a name and rule','err');return;}
    if((p.plan||'free')==='free' && BardPlatform.isPremiumType && BardPlatform.isPremiumType(type)){
      toast('Starter unlocks this. Raids stay free.','err'); renderProjectTabs('settings'); show('project'); return;
    }if(type==='raid'&&raidMode==='post'&&!postUrl){toast('Add the target post URL','err');return;}if(type==='raid'&&raidMode==='kol_list'&&!targets){toast('Add at least one target','err');return;}var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();if(feesOn&&!p.feePaid){toast('Pay onboard fee in Settings first','err');show('project');renderProjectTabs('settings');return;}if(feesOn&&(!wallet||!provider)){toast('Connect a wallet first','err');await connectWallet();return;}var config={};if(type==='hold'){if(minBal)config.minBalance=minBal;if(holdDays)config.holdDays=parseInt(holdDays,10)||null;}if(rewardMode==='top3')config.top3Split=top3||'50 / 30 / 20';if(type==='raid'&&targets)config.targetList=targets.split(/[\n,]+/).map(function(s){return s.trim();}).filter(Boolean);var btn=document.getElementById('btn-submit-campaign');btn.disabled=true;btn.textContent='Creating…';try{var camp=await BardPlatform.createCampaign(currentProjectId,{title:title,type:type,rule:rule,reward:reward,unit:unit,pool:pool,days:days,accessMode:accessMode,raidMode:raidMode,rewardMode:rewardMode,postUrl:postUrl||null,targets:targets||null,bonusHandle:bonusHandle||null,config:config});
      var lockVault=document.getElementById('c-lock-vault')&&document.getElementById('c-lock-vault').checked;
      var lockAmt=parseFloat(pool||reward||'0');
      if(lockVault){
        if(!p.vaultAddress){toast('Link a vault on the Vault tab first','err');}
        else if(!(lockAmt>0)){toast('Set a pool amount to lock','err');}
        else {
          try{await BardPlatform.reserveVault(p.id,camp.id,lockAmt);toast('Prize reserved in vault','ok');}
          catch(re){toast((re&&re.message)||'Campaign live — vault reserve failed','err');}
        }
      }if(feesOn&&wallet&&provider){btn.textContent='Confirm 0.25 SOL in wallet…';var result=await BardPlatform.payFee('campaign',wallet,provider,{projectId:p.id,campaignId:camp.id});await refreshState();toast(result.ok?'Campaign live · fee paid':'Campaign live · fee pending','ok');}else{await refreshState();toast('Campaign live','ok');}resetCampaignBuilder();openCampaign(camp.id);}catch(err){console.error(err);toast((err&&err.message)||'Failed to create campaign','err');}finally{btn.disabled=false;btn.textContent=feesOn?'Create campaign & pay 0.25 SOL':'Create campaign';}});
document.getElementById('btn-end-campaign').onclick=async function(){var c=findCampaign(currentProjectId,currentCampaignId);if(!c)return;if(!confirm('End this campaign? New claims will stop.'))return;try{await BardPlatform.updateCampaignStatus(c.id,'ended');await refreshState();toast('Campaign ended','ok');openCampaign(c.id);}catch(err){console.error(err);toast('Failed to end campaign','err');}};
document.getElementById('btn-propose-settle').onclick=async function(){
  var p=findProject(currentProjectId); var c=findCampaign(currentProjectId,currentCampaignId);
  if(!p||!c) return;
  if(!p.vaultAddress){ toast('Link a vault first','err'); renderProjectTabs('vault'); return; }
  var btn=this; btn.disabled=true; btn.textContent='Proposing…';
  try{
    var joins=await BardPlatform.listJoinsForCampaign(c.id);
    await BardPlatform.proposeSettlement(p.id,c.id,Object.assign({},c,{vaultMultisig:p.vaultMultisig||''}),joins);
    toast('Airdrop proposed — sign it','ok');
    openCampaign(c.id);
  }catch(e){ toast((e&&e.message)||'Could not propose payout','err'); }
  finally{ btn.disabled=false; btn.textContent='Propose payout'; }
};
(async function(){try{await refreshState();}catch(e){console.error(e);}var saved=localStorage.getItem('bard_team_wallet');if(saved){try{var p=(window.phantom&&window.phantom.solana)||window.solflare||window.solana;if(p&&p.isConnected){wallet=(p.publicKey&&p.publicKey.toString())||saved;provider=p;}else if(saved)wallet=saved;}catch(e){}}updateWalletUI();renderHome();})();
})();
