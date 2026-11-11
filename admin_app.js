(function(){
var state={projects:[]},currentProjectId=null,currentCampaignId=null,dataMode='local',wallet=null,provider=null;
function toast(msg,kind){var el=document.getElementById('toast');el.textContent=msg;el.className='toast is-on'+(kind?' '+kind:'');clearTimeout(toast._t);toast._t=setTimeout(function(){el.className='toast';},3200);}
function show(name){document.querySelectorAll('.page').forEach(function(p){p.classList.remove('is-on');});var page=document.getElementById('page-'+name);if(page)page.classList.add('is-on');window.scrollTo(0,0);}
function initials(s){s=(s||'?').trim();return s.slice(0,2).toUpperCase();}
function shortMint(m){if(!m||m.length<10)return m||'—';return m.slice(0,4)+'…'+m.slice(-4);}
function shortAddr(a){return window.BardPlatform.shortWallet(a);}
function scoringOn(){return !!(window.BardPlatform&&BardPlatform.scoredCampaigns&&BardPlatform.scoredCampaigns());}
function campaignScored(c){return !!(c&&c.config&&c.config.scoreRule);}
function vaultErr(e, addr){
  var m=(e&&(e.message||e.logs&&e.logs.join(' ')||String(e)))||'';
  if(/debit an account|no record of a prior credit|insufficient/i.test(m))
    return 'Your connected wallet has no SOL (or not enough). Creating the 2-of-2 costs about 0.05 SOL of rent. Send SOL to '+(addr?shortAddr(addr):'the connected wallet')+' — that is the wallet in the header, not the vault, not the mint, not Bard’s key.';
  if(/User rejected|cancelled|denied|user reject/i.test(m)) return 'Signature cancelled';
  if(/blockhash|expired/i.test(m)) return 'Network lagged. Try again.';
  return m||'Vault create failed';
}
async function walletSol(addr){
  try{
    if(!addr||!window.solanaWeb3) return null;
    var c=new solanaWeb3.Connection(BardPlatform.getRpc(),'confirmed');
    var lam=await c.getBalance(new solanaWeb3.PublicKey(addr),'confirmed');
    return lam/1e9;
  }catch(e){ console.warn(e); return null; }
}
function vaultConfigProblem(){
  var net=BardPlatform.getSolanaProblem?BardPlatform.getSolanaProblem():'';
  if(net) return net;
  var sig=BardPlatform.getSignerProblem?BardPlatform.getSignerProblem():'';
  if(sig) return 'Bard signer is not usable: '+sig;
  var bard=BardPlatform.getVaultBardMember?BardPlatform.getVaultBardMember():'';
  if(!bard) return 'Bard has not set its signer key yet, so a 2-of-2 vault cannot be created.';
  return '';
}

function formatDate(iso){try{return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}catch(e){return'—';}}
function findProject(id){return state.projects.find(function(p){return p.id===id;});}
function findCampaign(pid,cid){var p=findProject(pid);if(!p)return null;return(p.campaigns||[]).find(function(c){return c.id===cid;});}
function activeCount(p){return(p.campaigns||[]).filter(function(c){return c.status==='active';}).length;}
function updateWalletUI(){var btn=document.getElementById('btn-wallet');if(wallet){btn.textContent=shortAddr(wallet);btn.classList.add('is-on');}else{btn.textContent='Connect wallet';btn.classList.remove('is-on');}var hint=document.getElementById('onboard-wallet-hint');if(hint){hint.textContent=wallet?'Connected '+shortAddr(wallet)+' is the team key on the vault.':'Connect the wallet that will be the team key on the vault.';}}
async function connectWallet(){try{var p=(window.phantom&&window.phantom.solana)||window.solflare||window.solana;if(!p){toast('No Solana wallet found. Install Phantom or Solflare.','err');return;}var resp=await p.connect();wallet=(resp.publicKey&&resp.publicKey.toString())||(p.publicKey&&p.publicKey.toString());if(!wallet){toast('Could not read wallet address','err');return;}provider=p;localStorage.setItem('bard_team_wallet',wallet);if(window.BardPlatform&&BardPlatform.signIn)await BardPlatform.signIn(p);updateWalletUI();toast('Wallet connected','ok');await refreshState();renderHome();}catch(e){console.error(e);toast((e&&e.message)||'Connection cancelled or failed','err');}}
function disconnectWallet(){wallet=null;provider=null;localStorage.removeItem('bard_team_wallet');if(window.BardPlatform&&BardPlatform.signOut)BardPlatform.signOut();updateWalletUI();}
// The Bard signer is the second key on every vault, so it sees every project and its payouts.
function signedInAsBard(){var me=BardPlatform.getSessionWallet&&BardPlatform.getSessionWallet();var bard=BardPlatform.getVaultBardMember&&BardPlatform.getVaultBardMember();return !!(me&&bard&&me===bard);}
async function refreshState(){if(window.BardPlatform){await BardPlatform.init();dataMode=BardPlatform.getMode();state.projects=await BardPlatform.listProjects({admin:!signedInAsBard()});var badge=document.getElementById('data-mode');if(badge)badge.textContent=dataMode==='supabase'?'· Live DB':'· Local only';}}
function renderHome(){var list=document.getElementById('project-list');var totalCamps=0;state.projects.forEach(function(p){totalCamps+=activeCount(p);});document.getElementById('stat-projects').textContent=state.projects.length;document.getElementById('stat-campaigns').textContent=totalCamps;renderInbox();if(!state.projects.length){list.innerHTML='<div class="empty"><h3>No projects yet</h3><p>Onboard your first token to start running campaigns.</p><button class="btn btn--solid" id="empty-onboard">Onboard a project</button></div>';document.getElementById('empty-onboard').onclick=function(){show('onboard');};return;}list.innerHTML=state.projects.map(function(p){var n=(p.campaigns||[]).length;var a=activeCount(p);var vaultPill=p.vaultAddress?'<span class="pill pill--paid">Vault linked</span>':'';return'<div class="card card--hover" data-open-project="'+BardPlatform.escapeHtml(p.id)+'"><div class="item" style="padding:0;border:none"><span class="item__ava">'+BardPlatform.escapeHtml(initials(p.ticker||p.name))+'</span><div class="item__body"><div class="item__title">'+BardPlatform.escapeHtml(p.name)+' <span class="muted">· $'+BardPlatform.escapeHtml(p.ticker)+'</span></div><div class="item__sub">'+BardPlatform.escapeHtml(shortMint(p.mint))+' · '+n+' campaign'+(n===1?'':'s')+'</div></div><div class="item__right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">'+(a?'<span class="pill pill--live">'+a+' active</span>':'<span class="pill pill--draft">No live</span>')+vaultPill+'</div></div></div>';}).join('');list.querySelectorAll('[data-open-project]').forEach(function(el){el.addEventListener('click',function(){openProject(el.getAttribute('data-open-project'));});});}
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
    var btn=needTeam?'<button class="btn btn--solid btn--sm" data-open-settle="'+BardPlatform.escapeHtml(s.campaign_id)+'" data-open-project-id="'+BardPlatform.escapeHtml(s.project_id)+'">Sign now</button>'
      : '<button class="btn btn--ghost btn--sm" data-open-settle="'+BardPlatform.escapeHtml(s.campaign_id)+'" data-open-project-id="'+BardPlatform.escapeHtml(s.project_id)+'">View</button>';
    return '<div class="notify"><h3>Airdrop ready · '+BardPlatform.escapeHtml(title)+'</h3><p>'+BardPlatform.escapeHtml(fmtAmt(s.total))+' $'+BardPlatform.escapeHtml(ticker)+' to '+n+' holder'+(n===1?'':'s')+'. '+line+'</p><div class="signers" style="margin-top:0;margin-bottom:12px"><div class="signer '+(team?'is-yes':'is-wait')+'"><b>You</b><span>'+(team?'Signed':'Needs your signature')+'</span></div><div class="signer '+(bard?'is-yes':'is-wait')+'"><b>Bard</b><span>'+(bard?'Signed':'Waiting')+'</span></div></div>'+btn+'</div>';
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
function openProject(id){var p=findProject(id);if(!p)return;currentProjectId=id;document.getElementById('proj-kicker').textContent='$'+p.ticker;document.getElementById('proj-title').textContent=p.name;document.getElementById('proj-meta').textContent=shortMint(p.mint)+(p.vaultAddress?' · vault linked':'')+' · onboarded '+formatDate(p.createdAt);renderProjectTabs('campaigns');show('project');}
function vaultBadgeHtml(p, extra){
  var addr=p.vaultAddress||'';
  var locked=!!addr;
  var title=locked?'Locked in 2-of-2 vault — no single party can withdraw.':'Lock rewards where holders can see them.';
  var body=locked
    ? 'Squads 2-of-2 (your key + Bard). Balance is on-chain — holders can verify on Solscan.'
    : 'Deposit once. Neither you nor Bard can move funds alone. Example: lock 10M $'+BardPlatform.escapeHtml(p.ticker||'TOKEN')+' before the board goes live.';
  var solHref=addr?BardPlatform.safeHttpUrl(BardPlatform.explorerUrl('account',addr)):'';
  var link=solHref?'<a class="btn btn--ghost btn--sm" href="'+BardPlatform.escapeHtml(solHref)+'" target="_blank" rel="noopener">View on Solscan</a>':'';
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
  var configProblem=vaultConfigProblem();
  el.innerHTML=vaultBadgeHtml(p)+
    '<div class="card" style="margin-bottom:12px"><p class="kicker">How it works</p>'+
    '<p style="margin:0;color:var(--body)">You and Bard each hold one key. Threshold 2. Example: lock 10M $'+BardPlatform.escapeHtml(p.ticker)+'. When an airdrop is ready, you get a sign notice. You sign. Then Bard signs. For now Bard’s signature is a manual check by a person, not an automatic one. Then it pays. Neither of us can move funds alone.</p></div>'+
    '<div class="card" style="margin-bottom:12px"><div class="form">'+
    (addr?'':'<button type="button" class="btn btn--solid" id="btn-create-vault">Create 2-of-2 vault</button><span class="hint" id="vault-create-hint">One Phantom signature. Your connected wallet pays ~0.05 SOL of rent (not the prize). We add your wallet + Bard as the two members.</span><p class="hint" id="vault-sol-line" style="margin-top:8px'+(configProblem?';color:#f87171':'')+'">'+(configProblem?BardPlatform.escapeHtml(configProblem):'Checking SOL in the connected wallet…')+'</p>')+
    (addr?'<p class="muted" style="margin:0 0 12px;font-size:.88rem">Vault is live. Deposit $'+BardPlatform.escapeHtml(p.ticker)+' to this address. Holders can verify on Solscan.</p>':'')+
    '<div class="field"><label>Vault address</label><div class="copy-row"><input class="inp num" id="vault-addr" value="'+BardPlatform.escapeHtml(addr)+'" placeholder="Created here, or paste a Squads vault"><button type="button" class="btn btn--ghost btn--sm" id="btn-save-vault">Save</button></div></div>'+
    '<div class="field"><label>Token mint</label><input class="inp num" id="vault-mint" value="'+BardPlatform.escapeHtml(mint)+'"></div>'+
    '<div class="field"><label>Bard key (second signer)</label><input class="inp num" id="vault-bard-key" readonly value="'+BardPlatform.escapeHtml(bard)+'"></div>'+
    '</div></div>'+
    '<div class="grid-2" id="vault-stats">'+
    '<div class="stat"><div class="stat__lbl">On-chain balance</div><div class="stat__val p num" id="vault-bal">…</div></div>'+
    '<div class="stat"><div class="stat__lbl">Reserved for campaigns</div><div class="stat__val num" id="vault-res">'+BardPlatform.escapeHtml(fmtAmt(reserved))+'</div></div>'+
    '</div>'+
    '<p class="muted" style="margin:12px 0 0;font-size:.82rem" id="vault-bal-meta">Reading chain…</p>';
  (function(){
    var line=document.getElementById('vault-sol-line');
    if(!line) return;
    if(configProblem) return;
    if(!wallet){ line.textContent='Connect the team wallet in the header first. That wallet pays the ~0.05 SOL rent.'; return; }
    walletSol(wallet).then(function(sol){
      if(sol==null){ line.textContent='Could not read SOL for '+shortAddr(wallet)+'.'; return; }
      if(sol<0.05) line.innerHTML='Connected wallet '+BardPlatform.escapeHtml(shortAddr(wallet))+' has <b>'+sol.toFixed(4)+' SOL</b>. Send ~0.05 SOL there before creating. This is rent, not the prize.';
      else line.textContent='Connected wallet '+shortAddr(wallet)+' · '+sol.toFixed(4)+' SOL. Ready to create.';
    });
  })();
var createBtn=document.getElementById('btn-create-vault');
  if(createBtn) createBtn.onclick=async function(){
    var blocked=vaultConfigProblem();
    if(blocked){ toast(blocked,'err'); return; }
    if(!wallet||!provider){ toast('Connect the team wallet first','err'); await connectWallet(); return; }
    if(!hasSdk){ toast('Vault toolkit failed to load — refresh','err'); return; }
    var btn=this;
    btn.disabled=true; btn.textContent='Checking SOL…';
    try{
      var sol=await walletSol(wallet);
      var line=document.getElementById('vault-sol-line');
      if(line){
        if(sol==null) line.textContent='Could not read SOL. Check the RPC and try again.';
        else if(sol<0.05) line.innerHTML='Connected wallet '+BardPlatform.escapeHtml(shortAddr(wallet))+' has <b>'+sol.toFixed(4)+' SOL</b>. Need ~0.05 SOL of rent. Send SOL to that wallet, then retry.';
        else line.textContent='Connected wallet '+shortAddr(wallet)+' · '+sol.toFixed(4)+' SOL. Enough to create.';
      }
      if(sol!=null && sol<0.05){
        toast('Wallet has '+sol.toFixed(4)+' SOL. Send ~0.05 SOL to '+shortAddr(wallet)+' first.','err');
        return;
      }
      btn.textContent='Confirm in wallet…';
      var rpc=BardPlatform.getRpc();
      var out=await BardVault.createTwoOfTwo(rpc, provider, wallet, bard);
      await BardPlatform.updateProjectVault(p.id,{ address:out.vault, mint:p.mint, multisig:out.multisig });
      await refreshState();
      toast('2-of-2 vault created on-chain','ok');
      renderVaultPanel(findProject(p.id)||p);
    }catch(e){
      console.error(e);
      toast(vaultErr(e,wallet),'err');
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
      var solHref=BardPlatform.safeHttpUrl(info.solscan);document.getElementById('vault-bal-meta').innerHTML=solHref?('Available ~ '+BardPlatform.escapeHtml(fmtAmt(avail))+' \u00b7 <a href="'+BardPlatform.escapeHtml(solHref)+'" target="_blank" rel="noopener" style="color:var(--purple)">Solscan</a>'):('Available ~ '+BardPlatform.escapeHtml(fmtAmt(avail)));
    }).catch(function(e){
      document.getElementById('vault-bal').textContent='—';
      document.getElementById('vault-bal-meta').textContent=(e&&e.message)||'Could not read on-chain balance';
    });
  } else {
    document.getElementById('vault-bal').textContent='—';
    document.getElementById('vault-bal-meta').textContent='Create the vault to read the on-chain balance.';
  }
}
async function renderRosterPanel(p){
  var el=document.getElementById('proj-roster');
  if(!el) return;
  el.innerHTML='<div class="card" style="margin-bottom:12px"><p class="kicker">Trusted list</p><p style="margin:0 0 12px;color:var(--body)">Your real ones, remembered across every campaign. Trusted and whales skip approval. Blocked never get in.</p>'+
    '<div class="grid-2"><div class="field"><label>Wallet</label><input class="inp num" id="roster-wallet" placeholder="Solana address"></div>'+
    '<div class="field"><label>Role</label><select class="sel" id="roster-role"><option value="trusted">Trusted — auto-approve</option><option value="whale">Whale — auto-approve, tagged</option><option value="blocked">Blocked — never join</option></select></div></div>'+
    '<div class="field" style="margin-top:10px"><label>Note (optional)</label><input class="inp" id="roster-note" placeholder="core, KOL friend, sniper…"></div>'+
    '<button type="button" class="btn btn--solid" id="btn-roster-add" style="margin-top:12px">Save to roster</button></div><div id="roster-list"></div>';
  document.getElementById('btn-roster-add').onclick=async function(){
    var w=document.getElementById('roster-wallet').value.trim();
    var role=document.getElementById('roster-role').value;
    var note=document.getElementById('roster-note').value.trim();
    if(!w){ toast('Paste a wallet','err'); return; }
    try{
      await BardPlatform.upsertRoster(p.id,w,role,note);
      toast(role==='blocked'?'Blocked for this project':'Remembered across campaigns','ok');
      renderRosterPanel(p);
    }catch(e){ toast((e&&e.message)||'Could not save','err'); }
  };
  var box=document.getElementById('roster-list');
  var rows=[];
  try{ rows=await BardPlatform.listRoster(p.id); }catch(e){}
  if(!rows.length){
    box.innerHTML='<div class="empty"><h3>Empty roster</h3><p>Add a wallet once. They stay trusted, whale, or blocked on every campaign you run.</p></div>';
    return;
  }
  box.innerHTML='<div class="card" style="padding:0 8px"><table class="table"><thead><tr><th>Wallet</th><th>Role</th><th>Note</th><th></th></tr></thead><tbody>'+
    rows.map(function(r){
      var pill=r.role==='blocked'?'pill--ended':(r.role==='whale'?'pill--live':'pill--paid');
      return '<tr><td class="num">'+BardPlatform.escapeHtml(shortAddr(r.wallet))+'</td><td><span class="pill '+pill+'">'+BardPlatform.escapeHtml(r.role)+'</span></td><td>'+BardPlatform.escapeHtml(r.note||'—')+'</td><td><button class="btn btn--ghost btn--sm" data-drop="'+BardPlatform.escapeHtml(r.wallet)+'">Remove</button></td></tr>';
    }).join('')+'</tbody></table></div>';
  box.querySelectorAll('[data-drop]').forEach(function(btn){
    btn.onclick=async function(){
      try{ await BardPlatform.removeRoster(p.id, btn.getAttribute('data-drop')); renderRosterPanel(p); }
      catch(e){ toast('Remove failed','err'); }
    };
  });
}

function renderSettingsPanel(p){
  var setEl=document.getElementById('proj-settings');
  var bps=BardPlatform.getCutBps();
  var cutWallet=BardPlatform.getCutWallet()||'';
  var cutText=BardPlatform.cutSettingText(bps)+(Number(bps)>0&&cutWallet?' · '+shortAddr(cutWallet):'');
  setEl.innerHTML=
    '<div class="card"><p class="kicker">Project</p>'+
    '<div class="form"><div class="field"><label>Name</label><div>'+BardPlatform.escapeHtml(p.name)+'</div></div>'+
    '<div class="field"><label>Ticker</label><div>$'+BardPlatform.escapeHtml(p.ticker)+'</div></div>'+
    '<div class="field"><label>Mint</label><div class="num" style="word-break:break-all">'+BardPlatform.escapeHtml(p.mint)+'</div></div>'+
    '<div class="field"><label>Vault</label><div class="num" style="word-break:break-all">'+(p.vaultAddress?BardPlatform.escapeHtml(p.vaultAddress):'Not linked')+'</div></div>'+
    '<div class="field"><label>Bard cut</label><div>'+BardPlatform.escapeHtml(cutText)+'</div>'+
    '<span class="hint">The percentage freezes on a campaign when it goes live. Changing it later does not change a running campaign.</span></div>'+
    '</div></div>';
}
function renderProjectTabs(tab){var p=findProject(currentProjectId);if(!p)return;document.querySelectorAll('#page-project .tab').forEach(function(t){t.classList.toggle('is-on',t.getAttribute('data-tab')===tab);});var campsEl=document.getElementById('proj-campaigns');var setEl=document.getElementById('proj-settings');var vaultEl=document.getElementById('proj-vault');var rosterEl=document.getElementById('proj-roster');if(tab==='roster'){campsEl.style.display='none';if(setEl)setEl.style.display='none';if(vaultEl)vaultEl.style.display='none';if(rosterEl){rosterEl.style.display='block';renderRosterPanel(p);}return;}if(tab==='vault'){campsEl.style.display='none';setEl.style.display='none';vaultEl.style.display='block';renderVaultPanel(p);return;}if(tab==='settings'){campsEl.style.display='none';if(vaultEl)vaultEl.style.display='none';if(rosterEl)rosterEl.style.display='none';setEl.style.display='block';renderSettingsPanel(p);return;}if(vaultEl)vaultEl.style.display='none';if(rosterEl)rosterEl.style.display='none';setEl.style.display='none';campsEl.style.display='block';var camps=p.campaigns||[];if(!camps.length){campsEl.innerHTML='<div class="empty"><h3>No campaigns yet</h3><p>Create your first campaign for $'+BardPlatform.escapeHtml(p.ticker)+'.</p><button class="btn btn--solid" id="empty-camp">New campaign</button></div>';document.getElementById('empty-camp').onclick=function(){resetCampaignBuilder();show('new-campaign');};return;}campsEl.innerHTML=camps.slice().reverse().map(function(c){var pill=c.status==='active'?'pill--live':(c.status==='paid'?'pill--paid':(c.status==='ended'?'pill--ended':'pill--draft'));var lockPill=(c.lockedRaw||c.locked_raw)?'<span class="pill pill--paid">prize locked</span>':'';var sub=[c.type,(c.accessMode||c.access_mode)==='approval'?'approval':'open',c.rewardMode||c.reward_mode||'fixed',(c.rule||'').slice(0,48)].filter(Boolean).join(' · ');return'<div class="card card--hover" data-open-camp="'+BardPlatform.escapeHtml(c.id)+'"><div class="item" style="padding:0;border:none"><div class="item__body"><div class="item__title">'+BardPlatform.escapeHtml(c.title)+'</div><div class="item__sub">'+BardPlatform.escapeHtml(sub)+((c.rule||'').length>48?'…':'')+'</div></div><div class="item__right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="pill '+pill+'">'+BardPlatform.escapeHtml(c.status)+'</span>'+lockPill+'</div></div></div>';}).join('');campsEl.querySelectorAll('[data-open-camp]').forEach(function(el){el.addEventListener('click',function(){openCampaign(el.getAttribute('data-open-camp'));});});}
function openCampaign(cid){var c=findCampaign(currentProjectId,cid);var p=findProject(currentProjectId);if(!c||!p)return;currentCampaignId=cid;document.getElementById('camp-kicker').textContent=p.name+' · $'+p.ticker;document.getElementById('camp-title').textContent=c.title;document.getElementById('camp-rule').textContent=c.rule;var st=document.getElementById('camp-status');st.textContent=c.status;st.className='pill '+(c.status==='active'?'pill--live':'pill--ended');var access=c.accessMode||c.access_mode||'open';var rewardMode=c.rewardMode||c.reward_mode||'fixed';var raidMode=c.raidMode||c.raid_mode||null;document.getElementById('camp-access-pill').textContent=access==='approval'?'Approval required':'Open join';document.getElementById('camp-reward-pill').textContent=({fixed:'Fixed payout',top3:'Top 3',pool:'Shared pool',growing:'Growing pool'})[rewardMode]||rewardMode;var raidPill=document.getElementById('camp-raid-pill');if(c.type==='raid'&&raidMode){raidPill.style.display='';raidPill.textContent=({open:'Open raid',post:'Specific post',kol_list:'KOL targets'})[raidMode]||raidMode;}else{raidPill.style.display='none';}var poolLabel=(c.pool||'—')+(c.unit?' '+c.unit:'');if(c.reward)poolLabel=(c.reward+' '+(c.unit||'')+' · pool '+poolLabel).trim();
    var poolLblEl=document.getElementById('camp-pool').parentElement.querySelector('.stat__lbl');
    if((c.rewardMode||c.reward_mode)==='growing' && BardPlatform.growingMeta){
      var gm=BardPlatform.growingMeta(c);
      poolLabel=String(gm.now)+(c.unit?(' '+c.unit):'');
      if(poolLblEl) poolLblEl.textContent='Pot now';
    } else if(poolLblEl) poolLblEl.textContent='Pool';
    document.getElementById('camp-pool').textContent=poolLabel;document.getElementById('camp-claims').textContent=(c.settled||0);
    var badge=document.getElementById('camp-vault-badge');
    if(badge){
      if(p.vaultAddress){
        var locked=Number(c.vaultReserved||0);
        badge.innerHTML=vaultBadgeHtml(p, locked?('<p style="margin-top:8px">This campaign has <b class="num">'+BardPlatform.escapeHtml(fmtAmt(locked))+' $'+BardPlatform.escapeHtml(p.ticker)+'</b> reserved from the vault.</p>'):'');
        badge.style.display='block';
      } else { badge.innerHTML=''; badge.style.display='none'; }
    }
    loadCampaignOps(p, c);
    document.getElementById('btn-end-campaign').style.display=c.status==='active'?'':'none';
    document.getElementById('btn-cancel-campaign').style.display=(c.status==='active'||c.status==='ended')?'':'none';show('campaign');}
function numericHoldMin(c){
  if(!c||String(c.type||'')!=='hold') return null;
  var cfg=c.config;
  if(typeof cfg==='string'){ try{ cfg=JSON.parse(cfg);}catch(e){ cfg={}; } }
  cfg=cfg||{};
  if(cfg.minBalance==null) return null;
  var text=String(cfg.minBalance).trim();
  if(!/^\d+(\.\d+)?$/.test(text)) return null;
  return text;
}
function humanAmount(text){
  var parts=String(text).split('.');
  var whole=(parts[0]||'0').replace(/^0+(?=\d)/,'')||'0';
  var frac=(parts[1]||'').replace(/0+$/,'');
  return frac?whole+'.'+frac:whole;
}
function asOfLabel(iso){
  if(!iso||!window.BardPlatform||!BardPlatform.clockDate) return '';
  var date=BardPlatform.clockDate(iso);
  var d=new Date(iso);
  if(!date||isNaN(d.getTime())) return '';
  var hh=String(d.getUTCHours()).padStart(2,'0');
  var mm=String(d.getUTCMinutes()).padStart(2,'0');
  return date+' '+hh+':'+mm+' UTC';
}
function evidenceCell(p,c,join,queueRow,decimals){
  if(!join||join.status==='rejected') return '—';
  var ev=queueRow&&queueRow.evidence;
  if(!ev) return '<span class="muted">—</span>';
  var kind=String(ev.kind||c.type||'');
  if(kind==='raid'||kind==='custom'){
    var href=BardPlatform.safeHttpUrl(ev.post_url);
    if(!href) return '<span class="muted">no link submitted</span>';
    return '<a href="'+BardPlatform.escapeHtml(href)+'" target="_blank" rel="noopener">open post</a>';
  }
  if(kind==='refer'){
    var count=Number(ev.referral_count);
    if(!isFinite(count)||count<0) count=0;
    return BardPlatform.escapeHtml(String(count))+' referrals';
  }
  if(kind==='hold'){
    if(ev.balance_raw==null||decimals==null) return '<span class="muted">balance unavailable</span>';
    var amount=BardPlatform.formatRaw(ev.balance_raw, decimals);
    if(amount==='—') return '<span class="muted">balance unavailable</span>';
    var ticker=p&&p.ticker?String(p.ticker):'TOKEN';
    var text='holds '+amount+' '+ticker;
    var when=asOfLabel(ev.balance_as_of);
    if(when) text+=' · as of '+when;
    var html=BardPlatform.escapeHtml(text);
    if(ev.meets_min===true) html+=' <span class="muted">≥ minimum</span>';
    else if(ev.meets_min===false) html+=' <span class="muted">below minimum</span>';
    return html;
  }
  return '<span class="muted">—</span>';
}
function renderQualifyMatching(p,c,queue){
  var host=document.getElementById('camp-qualify-matching');
  if(!host) return;
  host.style.display='none';
  host.textContent='';
  var min=numericHoldMin(c);
  if(!queue||!Array.isArray(queue.joins)||!min) return;
  var amount=humanAmount(min);
  var ticker=p&&p.ticker?String(p.ticker):'TOKEN';
  var count=(queue.joins||[]).filter(function(row){
    return row&&row.evidence&&row.evidence.meets_min===true&&!row.qualified&&row.status!=='rejected';
  }).length;
  host.style.display='block';
  var btn=document.createElement('button');
  btn.type='button';
  btn.className='btn btn--ghost btn--sm';
  btn.id='btn-qualify-matching';
  btn.textContent='Qualify everyone at or above '+amount+' '+ticker;
  var panel=document.createElement('div');
  panel.id='qualify-matching-confirm';
  panel.style.display='none';
  panel.style.marginTop='8px';
  var line=document.createElement('p');
  line.className='muted';
  line.style.margin='0 0 8px';
  line.textContent='Qualify '+count+' holder'+(count===1?'':'s')+' at or above '+amount+' '+ticker+'.';
  var actions=document.createElement('div');
  actions.style.display='flex';
  actions.style.gap='8px';
  var confirm=document.createElement('button');
  confirm.type='button';
  confirm.className='btn btn--solid btn--sm';
  confirm.textContent='Confirm';
  var cancel=document.createElement('button');
  cancel.type='button';
  cancel.className='btn btn--ghost btn--sm';
  cancel.textContent='Cancel';
  actions.appendChild(confirm);
  actions.appendChild(cancel);
  panel.appendChild(line);
  panel.appendChild(actions);
  host.appendChild(btn);
  host.appendChild(panel);
  btn.addEventListener('click', function(){ panel.style.display='block'; });
  cancel.addEventListener('click', function(){ panel.style.display='none'; });
  confirm.addEventListener('click', async function(){
    confirm.disabled=true;
    try{
      await BardPlatform.qualifyMatching(c.id);
      await refreshState();
      openCampaign(c.id);
    }catch(err){
      confirm.disabled=false;
      toast((err&&err.message)||'Update failed','err');
    }
  });
}
async function postScore(campaignId, leaf, body){
  var headers={'content-type':'application/json'};
  var token=BardPlatform.getSessionToken&&BardPlatform.getSessionToken();
  if(token) headers.authorization='Bearer '+token;
  var res=await fetch('/api/campaigns/'+encodeURIComponent(campaignId)+'/score/'+leaf,{method:'POST',headers:headers,body:JSON.stringify(body||{})});
  var data={};
  try{ data=await res.json(); }catch(e){ data={}; }
  if(!res.ok) throw new Error((data&&data.error)||'score update failed');
  return data;
}
function scoreField(label, id, placeholder){
  return '<label class="field" style="display:flex;flex-direction:column;gap:6px;margin:8px 0"><span class="muted">'+label+'</span><textarea class="inp" id="'+id+'" rows="3" placeholder="'+placeholder+'"></textarea></label>';
}
async function renderScoreTools(c){
  var host=document.getElementById('camp-score-tools');
  if(!host){
    host=document.createElement('div');
    host.id='camp-score-tools';
    host.style.marginTop='16px';
    var card=document.getElementById('camp-lb');
    if(card&&card.closest) card.closest('.card').appendChild(host);
  }
  host.innerHTML='<p class="muted">Loading the score…</p>';
  var body=null;
  try{
    var headers={};
    var token=BardPlatform.getSessionToken&&BardPlatform.getSessionToken();
    if(token) headers.authorization='Bearer '+token;
    var res=await fetch('/api/campaigns/'+encodeURIComponent(c.id)+'/score',{headers:headers});
    if(res.ok) body=await res.json();
  }catch(e){ body=null; }
  if(body&&Array.isArray(body.results)){
    body.results.forEach(function(row){
      var tr=document.querySelector('#camp-lb tr[data-w="'+row.wallet+'"] [data-score]');
      if(tr) tr.textContent=String(row.score_milli);
    });
  }
  var breakdown='';
  if(body&&Array.isArray(body.results)){
    breakdown=body.results.map(function(row){
      var gate=row.gate||{};
      var posts=(row.posts||[]).map(function(post){
        var why=post.kept?('kept '+post.score_milli):(post.reason||'0');
        var eng=(post.engagers||[]).map(function(item){
          return BardPlatform.escapeHtml(item.handle)+' '+BardPlatform.escapeHtml(item.kind||'')+' w '+BardPlatform.escapeHtml(String(item.weight))+(item.label?(' '+BardPlatform.escapeHtml(item.label)):'')+' '+BardPlatform.escapeHtml(item.source||'');
        }).join('<br>');
        return '<div style="margin:6px 0 0">'+BardPlatform.escapeHtml(post.post_id)+' · '+BardPlatform.escapeHtml(why)+(eng?'<div class="muted">'+eng+'</div>':'')+'</div>';
      }).join('');
      return '<div style="margin:10px 0"><b>'+BardPlatform.escapeHtml(row.handle||shortAddr(row.wallet))+'</b> · '+BardPlatform.escapeHtml(String(row.score_milli))+'<div class="muted">gate '+(gate.ok?'ok':BardPlatform.escapeHtml(gate.reason||'no'))+' · followers '+BardPlatform.escapeHtml(String(gate.followers==null?'':gate.followers))+'</div>'+posts+'</div>';
    }).join('');
  }
  var privateReasons='';
  if(body&&Array.isArray(body.reasons)&&body.reasons.length){
    privateReasons='<div style="margin:10px 0"><strong>Private reasons</strong>'+body.reasons.map(function(item){
      return '<div class="muted">'+BardPlatform.escapeHtml(item.action||'override')+' · '+BardPlatform.escapeHtml(item.handle||shortAddr(item.wallet||''))+' · '+BardPlatform.escapeHtml(item.reason||'')+' · '+BardPlatform.escapeHtml(item.at||'')+'</div>';
    }).join('')+'</div>';
  }
  host.innerHTML='<strong style="font-variation-settings:\'wght\' 620">Score breakdown</strong>'+
    (breakdown||'<p class="muted">No score yet.</p>')+
    privateReasons+
    scoreField('Accounts CSV: handle,kind,created_on,followers,following','score-accounts','honest,quote,2025-04-28,800,300')+
    '<button class="btn btn--ghost btn--sm" type="button" id="btn-score-accounts">Save accounts</button>'+
    scoreField('Posts, one JSON object per line: post_id, wallet, handle, text','score-posts','{"post_id":"1","wallet":"...","handle":"honest","text":"..."}')+
    '<button class="btn btn--ghost btn--sm" type="button" id="btn-score-posts">Save posts</button>'+
    '<label class="field" style="display:flex;flex-direction:column;gap:6px;margin:8px 0"><span class="muted">Engagement post id</span><input class="inp" id="score-eng-post" placeholder="post id"></label>'+
    scoreField('Engagements CSV: handle,kind,created_on,followers,following','score-eng','e1,repost,2024-01-01,100,100')+
    '<button class="btn btn--ghost btn--sm" type="button" id="btn-score-eng">Save engagements</button>'+
    '<div class="grid-2" style="margin-top:8px"><label class="field"><span class="muted">Override wallet</span><input class="inp" id="score-over-wallet"></label><label class="field"><span class="muted">Action</span><select class="sel" id="score-over-action"><option value="exclude_person">Exclude person</option><option value="exclude_post">Exclude post</option><option value="bot">Bot engager</option><option value="include_person">Include a person who scored 0</option></select></label></div>'+
    '<label class="field" style="display:flex;flex-direction:column;gap:6px;margin:8px 0"><span class="muted">Post id or engager handle</span><input class="inp" id="score-over-target"></label>'+
    '<label class="field" style="display:flex;flex-direction:column;gap:6px;margin:8px 0"><span class="muted">Reason (required, private)</span><input class="inp" id="score-over-reason"></label>'+
    '<button class="btn btn--ghost btn--sm" type="button" id="btn-score-over">Save override</button>';
  document.getElementById('btn-score-accounts').onclick=async function(){
    try{
      var accounts=String(document.getElementById('score-accounts').value||'').split(/\r?\n/).map(function(line){return line.trim();}).filter(Boolean).filter(function(line){return line.split(',')[0].toLowerCase()!=='handle';}).map(function(line){
        var cells=line.split(',').map(function(cell){return cell.trim();});
        var dated=cells.length>=5?cells.slice(2):cells.slice(1);
        return {handle:cells[0],created_on:dated[0],followers:Number(dated[1]),following:Number(dated[2])};
      });
      await postScore(c.id,'accounts',{accounts:accounts});
      toast('Accounts saved','ok');
      openCampaign(c.id);
    }catch(err){ toast((err&&err.message)||'Update failed','err'); }
  };
  document.getElementById('btn-score-posts').onclick=async function(){
    try{
      var posts=String(document.getElementById('score-posts').value||'').split(/\r?\n/).map(function(line){return line.trim();}).filter(Boolean).map(function(line){return JSON.parse(line);});
      await postScore(c.id,'posts',{posts:posts});
      toast('Posts saved','ok');
      openCampaign(c.id);
    }catch(err){ toast((err&&err.message)||'Update failed','err'); }
  };
  document.getElementById('btn-score-eng').onclick=async function(){
    try{
      await postScore(c.id,'engagements',{post_id:document.getElementById('score-eng-post').value.trim(),csv:document.getElementById('score-eng').value});
      toast('Engagements saved','ok');
      openCampaign(c.id);
    }catch(err){ toast((err&&err.message)||'Update failed','err'); }
  };
  document.getElementById('btn-score-over').onclick=async function(){
    try{
      var action=document.getElementById('score-over-action').value;
      var target=document.getElementById('score-over-target').value.trim();
      var payload={action:action,reason:document.getElementById('score-over-reason').value.trim(),wallet:document.getElementById('score-over-wallet').value.trim()};
      if(action==='exclude_post') payload.post_id=target;
      if(action==='bot') payload.handle=target;
      await postScore(c.id,'overrides',payload);
      toast('Override saved','ok');
      openCampaign(c.id);
    }catch(err){ toast((err&&err.message)||'Update failed','err'); }
  };
}
async function loadCampaignOps(p,c){
  var tbody=document.getElementById('camp-lb');
  var box=document.getElementById('camp-settle');
  var bulk=document.getElementById('camp-qualify-matching');
  if(bulk){ bulk.style.display='none'; bulk.textContent=''; }
  var scored=campaignScored(c);
  var progressHead=document.querySelector('#page-campaign thead th:nth-child(3)');
  if(progressHead) progressHead.textContent=scored?'Score':'Progress';
  var joinsMeta=document.getElementById('camp-joins-meta');
  if(joinsMeta) joinsMeta.textContent=scored?'Score':'Approve · +1 · Qualify';
  tbody.innerHTML='<tr><td class="muted" colspan="6">Loading holders…</td></tr>';
  if(box) box.innerHTML='';
  var joins=[];
  try{ joins = await BardPlatform.listJoinsForCampaign(c.id); }catch(e){ console.error(e); }
  var queue=null;
  try{ if(BardPlatform.fetchJoinQueue) queue=await BardPlatform.fetchJoinQueue(c.id); }catch(e){ queue=null; }
  var evidenceByWallet={};
  var decimals=queue&&queue.decimals!=null?queue.decimals:null;
  if(queue&&Array.isArray(queue.joins)){
    queue.joins.forEach(function(row){ if(row&&row.wallet) evidenceByWallet[row.wallet]=row; });
  }
  var rows=joins.slice();
  if(!rows.length&&queue&&Array.isArray(queue.joins)&&queue.joins.length){
    rows=queue.joins.map(function(row){
      return { wallet: row.wallet, x_handle: row.x_handle, qualified: !!row.qualified, status: row.status||'approved', progress: row.progress||0, note: null };
    });
  }
  if(!rows.length){
    tbody.innerHTML='<tr><td class="muted" colspan="6">No joins yet. Holders enter from the dashboard.</td></tr>';
  } else {
    tbody.innerHTML=rows.map(function(j){
      var st=j.qualified?'Qualified':(j.status||'approved');
      var pill=j.qualified?'pill--paid':(j.status==='pending'?'pill--pending':(j.status==='rejected'?'pill--ended':'pill--live'));
      var acts='';
      if(j.status==='pending') acts+='<button class="btn btn--ghost btn--sm" data-js="approve" data-w="'+BardPlatform.escapeHtml(j.wallet)+'">Approve</button> <button class="btn btn--ghost btn--sm" data-js="reject" data-w="'+BardPlatform.escapeHtml(j.wallet)+'">Reject</button> ';
      if(!scored && (j.status==='approved'||j.qualified)) acts+='<button class="btn btn--ghost btn--sm" data-js="plus" data-w="'+BardPlatform.escapeHtml(j.wallet)+'" data-p="'+BardPlatform.escapeHtml(j.progress||0)+'">+1</button> <button class="btn btn--ghost btn--sm" data-js="minus" data-w="'+BardPlatform.escapeHtml(j.wallet)+'" data-p="'+BardPlatform.escapeHtml(j.progress||0)+'">−1</button> ';
      if(!scored && !j.qualified && j.status!=='rejected') acts+='<button class="btn btn--solid btn--sm" data-js="qual" data-w="'+BardPlatform.escapeHtml(j.wallet)+'">Qualify</button> ';
      acts+='<button class="btn btn--ghost btn--sm" data-js="trust" data-w="'+BardPlatform.escapeHtml(j.wallet)+'">Remember</button> <button class="btn btn--ghost btn--sm" data-js="whale" data-w="'+BardPlatform.escapeHtml(j.wallet)+'">Whale</button> <button class="btn btn--ghost btn--sm" data-js="block" data-w="'+BardPlatform.escapeHtml(j.wallet)+'">Block</button>';
      return '<tr data-w="'+BardPlatform.escapeHtml(j.wallet)+'"><td class="num">'+BardPlatform.escapeHtml(shortAddr(j.wallet))+'</td><td>'+(function(){var h=BardPlatform.escapeHtml(j.x_handle||'—');if(j.note)h+='<div class="muted">'+BardPlatform.escapeHtml(j.note)+'</div>';return h;})()+'</td><td class="num" data-score>'+BardPlatform.escapeHtml(j.progress||0)+'</td><td><span class="pill '+pill+'">'+BardPlatform.escapeHtml(st)+'</span></td><td>'+evidenceCell(p,c,j,evidenceByWallet[j.wallet],decimals)+'</td><td style="white-space:nowrap">'+acts+'</td></tr>';
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
          if(act==='trust') await BardPlatform.upsertRoster(p.id,w,'trusted','from campaign');
          if(act==='whale') await BardPlatform.upsertRoster(p.id,w,'whale','from campaign');
          if(act==='block'){ await BardPlatform.upsertRoster(p.id,w,'blocked','from campaign'); await BardPlatform.setJoinStatus(c.id,w,'rejected'); }
          await refreshState();
          openCampaign(c.id);
        }catch(err){ toast((err&&err.message)||'Update failed','err'); }
      });
    });
  }
  if(scored) renderScoreTools(c);
  else renderQualifyMatching(p,c,queue);
  var sets=[];
  try{ sets = await BardPlatform.listSettlements(c.id); }catch(e){ console.error(e); }
  await renderSettleBox(p,c,rows,sets);
  renderBardSigns(p,c,sets);
  renderDrawBox(p,c,rows);
}
function renderDrawBox(p,c,joins){
  var host=document.getElementById('camp-settle');
  if(!host||campaignScored(c)) return;
  var wrap=document.createElement('div');
  wrap.style.marginTop='18px';
  wrap.style.paddingTop='14px';
  wrap.style.borderTop='1px solid rgba(244,244,245,.08)';
  var winners=c.drawWinners||[];
  if(c.drawSeed){
    var verdict='';
    try{
      var check=BardPlatform.verifyDraw(c, joins);
      if(check && check.ok===false) verdict='<p class="muted" style="margin:6px 0 0;font-size:.86rem">Stored winners do not match the public seed.</p>';
    }catch(e){}
    wrap.innerHTML='<strong style="font-variation-settings:\'wght\' 620">Airdrop draw</strong>'+
      '<p class="muted" style="margin:6px 0 8px;font-size:.86rem">Provable. Seed is public. Same seed always yields the same order.</p>'+
      '<p class="num" style="font-size:.78rem;word-break:break-all;color:var(--muted)">'+BardPlatform.escapeHtml(c.drawSeed)+'</p>'+
      (c.drawSlot?'<p class="muted" style="margin:0 0 8px;font-size:.78rem">Committed slot '+BardPlatform.escapeHtml(String(c.drawSlot))+(c.drawSeedSlot?' · block '+BardPlatform.escapeHtml(String(c.drawSeedSlot)):'')+'</p>':'')+
      '<table class="table"><thead><tr><th>#</th><th>Wallet</th></tr></thead><tbody>'+
      winners.map(function(w,i){ return '<tr><td class="num">'+(i+1)+'</td><td class="num">'+BardPlatform.escapeHtml(shortAddr(w.wallet||w))+'</td></tr>'; }).join('')+
      '</tbody></table>'+verdict;
    host.appendChild(wrap);
    return;
  }
  if(c.drawSlot){
    wrap.innerHTML='<strong style="font-variation-settings:\'wght\' 620">Airdrop draw</strong>'+
      '<p class="muted" style="margin:6px 0 10px;font-size:.86rem">Committed to slot '+BardPlatform.escapeHtml(String(c.drawSlot))+'. Reveal runs once that slot is final. The seed is that blockhash.</p>'+
      '<button type="button" class="btn btn--ghost btn--sm" id="btn-draw-final">Reveal winners</button>';
    host.appendChild(wrap);
    var fin=document.getElementById('btn-draw-final');
    if(fin) fin.onclick=async function(){
      try{
        await BardPlatform.finalizeDraw(c.id);
        toast('Draw locked. Holders can verify the seed.','ok');
        await refreshState();
        openCampaign(c.id);
      }catch(e){ toast((e&&e.message)||'Draw failed','err'); }
    };
    return;
  }
  wrap.innerHTML='<strong style="font-variation-settings:\'wght\' 620">Airdrop draw</strong>'+
    '<p class="muted" style="margin:6px 0 10px;font-size:.86rem">Commit to a future Solana slot first. Nobody can pick the order after that.</p>'+
    '<button type="button" class="btn btn--ghost btn--sm" id="btn-draw">Commit draw slot</button>';
  host.appendChild(wrap);
  var btn=document.getElementById('btn-draw');
  if(btn) btn.onclick=async function(){
    try{
      await BardPlatform.commitDraw(c.id, 0);
      toast('Slot committed. Reveal after it is final.','ok');
      await refreshState();
      openCampaign(c.id);
    }catch(e){ toast((e&&e.message)||'Draw failed','err'); }
  };
}
function cutRowHtml(live, ticker){
  if(!live) return '';
  if(live.cut_waived) return '<tr><td></td><td>Bard cut</td><td class="num">waived</td></tr>';
  if(live.cut_raw==null||String(live.cut_raw)==='0') return '';
  return '<tr><td></td><td class="num">'+BardPlatform.escapeHtml(shortAddr(live.cut_wallet))+'</td><td class="num">'+BardPlatform.escapeHtml(String(live.cut_raw))+' raw cut</td></tr>';
}
function verifyLine(report){
  if(report&&report.matches) return 'Vault transaction matches this payout.';
  var diff=(report&&report.diff)||{};
  if(diff.reason) return 'Does not match: '+diff.reason;
  try{ return 'Does not match: '+JSON.stringify(diff).slice(0,500); }catch(e){ return 'Does not match this payout.'; }
}
// The payout's cut as the vault builder takes it, or null when there is none.
function cutArgOf(live){
  if(!live.cut_waived&&live.cut_wallet&&String(live.cut_raw||'0')!=='0') return {wallet:live.cut_wallet,amountRaw:String(live.cut_raw)};
  return null;
}
// How many vault transactions the payout needs (6 lines each, holders and the cut).
function batchCountOf(live){
  if(!(window.BardVault&&BardVault.payoutBatchCount)) return 1;
  try{ return BardVault.payoutBatchCount(live.payouts||[], cutArgOf(live)); }catch(e){ return 1; }
}
// Where each batch of a payout stands: signed by each key, paid.
function batchStates(rows,count){
  var out=[];
  for(var n=0;n<count;n++){
    var row=(rows||[]).filter(function(r){ return Number(r.batch)===n; })[0]||null;
    out.push({n:n,row:row,team:!!(row&&row.team_signed),bard:!!(row&&row.bard_signed),paid:!!(row&&String(row.tx_signature||'').trim())});
  }
  return out;
}
function batchStatusText(b){
  if(b.paid) return 'Paid';
  if(b.team&&b.bard) return 'Ready to pay';
  if(b.team) return 'Waiting for Bard';
  return 'Needs your signature';
}
// Paying needs both keys on the vault transaction: name the missing one instead of sending it.
function payRefusal(team,bard,label){
  if(team&&bard) return '';
  var missing=!team&&!bard?'your signature and Bard\'s':(!team?'your signature':'Bard\'s signature');
  return label+' cannot be paid yet: both keys must sign first. Missing '+missing+'.';
}
async function executeCurrent(p,c,live){
  var count=batchCountOf(live);
  var rows=count>1?await BardPlatform.listSettlementBatches(live.id):[];
  var why=count>1
    ? batchStates(rows,count).filter(function(b){ return !b.paid; }).map(function(b){ return payRefusal(b.team,b.bard,'Batch '+(b.n+1)); }).filter(Boolean)[0]
    : payRefusal(!!live.team_signed,!!live.bard_signed,'This payout');
  if(why){ toast(why,'err'); return; }
  if(!wallet||!provider){ toast('Connect the wallet that will execute','err'); await connectWallet(); return; }
  if(!window.BardVault||!BardVault.executePayout){ toast('Vault toolkit failed to load — refresh','err'); return; }
  var ms=p.vaultMultisig||live.vault_multisig;
  if(!ms||live.tx_index==null){ toast('The vault transaction is not recorded yet','err'); return; }
  if(count>1){
    // Each batch is executed and recorded on its own; the payout closes on the last record.
    var open=rows.filter(function(r){ return !r.tx_signature; });
    // Every batch is recorded but the payout did not close (an interrupted close): record batch 0 again.
    if(!open.length&&rows.length) await BardPlatform.executeSettlement(live.id, rows[0].tx_signature, p.id, Number(rows[0].batch));
    for(var i=0;i<open.length;i++){
      toast('Executing transaction '+(Number(open[i].batch)+1)+' of '+count,'ok');
      var part=await BardVault.executePayout(BardPlatform.getRpc(), provider, wallet, ms, open[i].tx_index);
      if(!part){ toast('No transaction signature','err'); return; }
      await BardPlatform.executeSettlement(live.id, part, p.id, Number(open[i].batch));
    }
    toast('Payout executed','ok');
    await refreshState();
    openCampaign(c.id);
    return;
  }
  var sig=await BardVault.executePayout(BardPlatform.getRpc(), provider, wallet, ms, live.tx_index);
  if(!sig){ toast('No transaction signature','err'); return; }
  await BardPlatform.executeSettlement(live.id, sig, p.id);
  toast('Payout executed','ok');
  await refreshState();
  openCampaign(c.id);
}
async function renderSettleBox(p,c,joins,sets){
  var box=document.getElementById('camp-settle');
  if(!box) return;
  var live=sets.filter(function(s){ return s.status!=='cancelled' && s.status!=='executed'; })[0];
  var done=sets.filter(function(s){ return s.status==='executed'; })[0];
  if(done && !live){
    var txHref=done.tx_signature?BardPlatform.safeHttpUrl(BardPlatform.explorerUrl('tx',done.tx_signature)):'';
    var receiptHref='/c/'+encodeURIComponent(c.id)+'/receipt';
    box.innerHTML='<div class="signers"><div class="signer is-yes"><b>You</b><span>Signed</span></div><div class="signer is-yes"><b>Bard</b><span>Signed</span></div></div><p class="muted" style="margin:0">Paid'
      +(txHref?(' · <a href="'+BardPlatform.escapeHtml(txHref)+'" target="_blank" rel="noopener" style="color:var(--purple)">tx</a>'):'')
      +' · <a href="'+BardPlatform.escapeHtml(receiptHref)+'" style="color:var(--purple)">receipt</a>.</p>';
    return;
  }
  if(!live){
    var n=(joins||[]).filter(function(j){ return j.qualified || (j.status==='approved' && (j.progress||0)>0); }).length;
    box.innerHTML='<p class="muted" style="margin:0;font-size:.88rem">'+n+' holder'+(n===1?'':'s')+' ready. Propose the payout from the stored joins. Then both keys sign here.</p>';
    return;
  }
  var team=!!live.team_signed;
  var bard=!!live.bard_signed;
  var batches=batchCountOf(live);
  var rows=(live.payouts||[]).map(function(x,i){
    return '<tr><td class="num">'+(i+1)+'</td><td class="num">'+BardPlatform.escapeHtml(shortAddr(x.wallet))+'</td><td class="num">'+BardPlatform.escapeHtml(String(x.amount))+' $'+BardPlatform.escapeHtml(p.ticker)+'</td></tr>';
  }).join('')+cutRowHtml(live, p.ticker);
  var sdkReady=!!(window.BardVault&&BardVault.executePayout);
  var actions='';
  if(!team){
    actions='<button class="btn btn--solid" type="button" id="btn-cosign">Sign this payout</button> '
      +(batches>1?'<p class="muted" style="margin:6px 0 0;font-size:.88rem">This payout is '+batches+' vault transactions. Your wallet asks you to confirm each one, or sign them one at a time below.</p>':'');
  } else if(!bard){
    actions='<p class="muted" style="margin:0 0 8px;font-size:.88rem">You signed. Waiting for Bard to sign the other key.</p>';
  }
  // Execute stays on screen before both signatures so pressing it explains what is missing.
  if(!sdkReady){
    actions+='<button class="btn btn--solid" type="button" id="btn-execute-payout" disabled>Execute payout</button><p class="muted" id="execute-sdk-reason">Vault toolkit failed to load — refresh</p>';
  } else {
    actions+='<button class="btn '+(team&&bard?'btn--solid':'btn--ghost')+'" type="button" id="btn-execute-payout">Execute payout</button>';
  }
  var batchTable='';
  if(batches>1){
    var states=[];
    try{ states=batchStates(await BardPlatform.listSettlementBatches(live.id),batches); }
    catch(e){ console.error(e); states=batchStates([],batches); }
    if(currentCampaignId!==c.id) return;
    batchTable='<div style="overflow-x:auto;margin-top:12px"><table class="table" id="batch-table"><thead><tr><th>Batch</th><th>You</th><th>Bard</th><th>Status</th><th></th></tr></thead><tbody>'+
      states.map(function(b){
        return '<tr data-batch="'+b.n+'"><td class="num">'+(b.n+1)+' of '+batches+'</td><td>'+(b.team?'Signed':'—')+'</td><td>'+(b.bard?'Signed':'—')+'</td>'
          +'<td class="batch-status">'+batchStatusText(b)+'</td><td style="white-space:nowrap;text-align:right">'
          +(b.team?'':'<button class="btn btn--ghost btn--sm" type="button" data-sign-batch="'+b.n+'">Sign</button> ')
          +(b.paid?'':'<button class="btn '+(b.team&&b.bard?'btn--solid':'btn--ghost')+' btn--sm" type="button" data-pay-batch="'+b.n+'"'+(sdkReady?'':' disabled')+'>Pay</button>')
          +'</td></tr>';
      }).join('')+'</tbody></table></div>';
  }
  var cutNote=live.cut_waived?'Bard\'s cut is waived.':(live.cut_raw?('Bard\'s cut '+BardPlatform.escapeHtml(String(live.cut_raw))+' raw.'):'');
  box.innerHTML='<p style="margin:0 0 8px;font-size:.92rem">Payout · <b class="num">'+BardPlatform.escapeHtml(fmtAmt(live.total))+' $'+BardPlatform.escapeHtml(p.ticker)+'</b> to '+(live.payouts||[]).length+' holders'+(batches>1?(' in '+batches+' vault transactions'):'')+'. '+cutNote+'</p>'+
    '<div class="signers"><div class="signer '+(team?'is-yes':'is-wait')+'"><b>You</b><span>'+(team?'Signed':'Needs your signature')+'</span></div><div class="signer '+(bard?'is-yes':'is-wait')+'"><b>Bard</b><span>'+(bard?'Signed':'Waiting')+'</span></div></div>'+
    '<div style="overflow-x:auto"><table class="table" id="payout-table"><thead><tr><th>#</th><th>Wallet</th><th>Amount</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    batchTable+
    '<div style="margin-top:12px">'+actions+'</div>';
  var cs=document.getElementById('btn-cosign');
  if(cs) cs.onclick=function(){ cosignCurrent(p,c,live); };
  var ex=document.getElementById('btn-execute-payout');
  if(ex) ex.onclick=async function(){
    ex.disabled=true;
    try{ await executeCurrent(p,c,live); }
    catch(e){ toast((e&&e.message)||'Execute failed','err'); }
    finally{ ex.disabled=false; }
  };
  box.querySelectorAll('[data-sign-batch]').forEach(function(btn){
    btn.onclick=async function(){
      btn.disabled=true;
      try{ await signBatch(p,c,live,Number(btn.getAttribute('data-sign-batch'))); }
      finally{ btn.disabled=false; }
    };
  });
  box.querySelectorAll('[data-pay-batch]').forEach(function(btn){
    btn.onclick=async function(){
      btn.disabled=true;
      try{ await payBatch(p,c,live,Number(btn.getAttribute('data-pay-batch'))); }
      catch(e){ toast((e&&e.message)||'Pay failed','err'); }
      finally{ btn.disabled=false; }
    };
  });
}
// Sign one batch with the team key: propose its vault transaction, approve it, record it.
async function signBatch(p,c,live,n){
  if(!wallet||!provider){ toast('Connect the team wallet first','err'); await connectWallet(); return; }
  if(!window.BardVault||!BardVault.proposePayoutBatches){ toast('Vault toolkit failed to load — refresh','err'); return; }
  var ms=p.vaultMultisig||live.vault_multisig;
  if(!ms){ toast('Link a vault first','err'); return; }
  try{
    var b=batchStates(await BardPlatform.listSettlementBatches(live.id),batchCountOf(live))[n];
    if(b.team){ toast('Batch '+(n+1)+' is already signed','ok'); }
    else{
      toast('Confirm batch '+(n+1)+' in your wallet','ok');
      await BardVault.proposePayoutBatches(BardPlatform.getRpc(), provider, wallet, ms, p.vaultMint||p.mint, live.payouts, cutArgOf(live), {
        only: [n],
        onBatch: function(out){
          return BardPlatform.signSettlement(live.id,'team',{sig:out.signature,txIndex:out.transactionIndex,wallet:wallet,multisig:ms,batch:out.batch});
        }
      });
      toast('Batch '+(n+1)+' signed. Waiting for Bard.','ok');
    }
    await refreshState();
    openCampaign(c.id);
  }catch(e){
    if(/rejected|denied|cancel/i.test(String(e&&e.message))) toast('Signature cancelled','err');
    else toast((e&&e.message)||'Sign failed','err');
  }
}
// Pay one batch: refused on screen until both keys signed it.
async function payBatch(p,c,live,n){
  var count=batchCountOf(live);
  var b=batchStates(await BardPlatform.listSettlementBatches(live.id),count)[n];
  if(b.paid){ toast('Batch '+(n+1)+' is already paid','ok'); return; }
  var why=payRefusal(b.team,b.bard,'Batch '+(n+1));
  if(why){ toast(why,'err'); return; }
  if(!wallet||!provider){ toast('Connect the wallet that will execute','err'); await connectWallet(); return; }
  if(!window.BardVault||!BardVault.executePayout){ toast('Vault toolkit failed to load — refresh','err'); return; }
  var ms=p.vaultMultisig||live.vault_multisig;
  toast('Executing batch '+(n+1)+' of '+count,'ok');
  var sig=await BardVault.executePayout(BardPlatform.getRpc(), provider, wallet, ms, b.row.tx_index);
  if(!sig){ toast('No transaction signature','err'); return; }
  await BardPlatform.executeSettlement(live.id, sig, p.id, n);
  toast('Batch '+(n+1)+' of '+count+' paid','ok');
  await refreshState();
  openCampaign(c.id);
}
async function renderBardSigns(p,c,sets){
  var host=document.getElementById('bard-signs');
  if(!host) return;
  var signer=(BardPlatform.getVaultBardMember&&BardPlatform.getVaultBardMember())||'';
  var me=(BardPlatform.getSessionWallet&&BardPlatform.getSessionWallet())||wallet||'';
  if(!signer||me!==signer){
    host.style.display='none';
    host.innerHTML='';
    return;
  }
  var live=(sets||[]).filter(function(s){ return s.status!=='cancelled' && s.status!=='executed'; })[0];
  host.style.display='block';
  if(!live){
    host.innerHTML='<p class="kicker">Bard signs</p><p class="muted" style="margin:0">No open payout for this campaign.</p>';
    return;
  }
  host.innerHTML='<p class="kicker">Bard signs</p><p class="muted" id="bard-verify-line">Reading the vault transaction…</p><div id="bard-sign-actions" style="margin-top:12px"></div>';
  var report={matches:false,diff:{reason:'could not read the vault transaction'}};
  try{ report=await BardPlatform.verifySettlement(live.id); }
  catch(e){ report={matches:false,diff:{reason:(e&&e.message)||'could not read the vault transaction'}}; }
  if(currentCampaignId!==c.id) return;
  var line=document.getElementById('bard-verify-line');
  var actions=document.getElementById('bard-sign-actions');
  if(!line||!actions) return;
  line.textContent=verifyLine(report);
  var html='';
  if(!live.bard_signed){
    html+='<button type="button" class="btn btn--solid btn--sm" id="btn-bard-approve"'+(report.matches?'':' disabled')+'>Approve</button> ';
  }
  if(live.team_signed&&live.bard_signed){
    var sdkReady=!!(window.BardVault&&BardVault.executePayout);
    html+='<button type="button" class="btn btn--solid btn--sm" id="btn-bard-execute"'+(report.matches&&sdkReady?'':' disabled')+'>Execute</button>';
    if(!sdkReady) html+='<p class="muted">Vault toolkit failed to load — refresh</p>';
  }
  html+=' <button type="button" class="btn btn--ghost btn--sm" id="btn-bard-cancel-vote">Vote to cancel</button>';
  var count=batchCountOf(live);
  if(count>1){
    // Each batch is checked against its own lines and approved on its own once the team signed it.
    var states=batchStates([],count);
    try{ states=batchStates(await BardPlatform.listSettlementBatches(live.id),count); }catch(e){ console.error(e); }
    if(currentCampaignId!==c.id) return;
    var checks=(report&&report.batches)||[];
    html+='<div style="overflow-x:auto;margin-top:12px"><table class="table" id="bard-batch-table"><thead><tr><th>Batch</th><th>Vault transaction</th><th>Team</th><th>Bard</th><th></th></tr></thead><tbody>'+
      states.map(function(b){
        var check=checks.filter(function(r){ return Number(r.batch)===b.n; })[0]||null;
        var matches=!!(check&&check.matches);
        var line=!b.row?'Not proposed yet':(matches?'Matches':('Does not match'+(check&&check.diff&&check.diff.reason?': '+check.diff.reason:'')));
        var can=b.team&&matches&&!b.paid;
        return '<tr data-batch="'+b.n+'"><td class="num">'+(b.n+1)+' of '+count+'</td><td>'+BardPlatform.escapeHtml(line)+'</td><td>'+(b.team?'Signed':'—')+'</td>'
          +'<td class="batch-status">'+(b.paid?'Paid':(b.bard?'Signed':'—'))+'</td><td style="text-align:right">'
          +(b.bard?'':'<button type="button" class="btn btn--solid btn--sm" data-bard-approve-batch="'+b.n+'"'+(can?'':' disabled')+'>Approve</button>')
          +'</td></tr>';
      }).join('')+'</tbody></table></div>';
  }
  actions.innerHTML=html;
  actions.querySelectorAll('[data-bard-approve-batch]').forEach(function(btn){
    btn.onclick=async function(){
      var n=Number(btn.getAttribute('data-bard-approve-batch'));
      if(!window.BardVault||!BardVault.bardApprove){ toast('Vault toolkit failed to load — refresh','err'); return; }
      if(!provider){ toast('Connect the Bard signer wallet','err'); await connectWallet(); return; }
      btn.disabled=true;
      try{
        // Read the batch again: approve only the vault transaction the check above matched.
        var b=batchStates(await BardPlatform.listSettlementBatches(live.id),count)[n];
        var check=((await BardPlatform.verifySettlement(live.id)).batches||[]).filter(function(r){ return Number(r.batch)===n; })[0];
        if(!b.team){ toast('Batch '+(n+1)+' is not signed by the team yet','err'); return; }
        if(!(check&&check.matches)){ toast('Batch '+(n+1)+' does not match this payout','err'); return; }
        var sig=await BardVault.bardApprove(BardPlatform.getRpc(), provider, wallet, p.vaultMultisig||live.vault_multisig, b.row.tx_index);
        await BardPlatform.signSettlement(live.id,'bard',{sig:sig,txIndex:b.row.tx_index,wallet:wallet,batch:n});
        toast('Bard signed batch '+(n+1),'ok');
        await refreshState();
        openCampaign(c.id);
      }catch(e){
        toast((e&&e.message)||'Approve failed','err');
      }finally{ btn.disabled=false; }
    };
  });
  var cancelVote=document.getElementById('btn-bard-cancel-vote');
  if(cancelVote) cancelVote.onclick=async function(){
    if(!window.BardVault||!BardVault.cancelPayoutProposal){ toast('Vault toolkit failed to load — refresh','err'); return; }
    if(!provider){ toast('Connect the Bard signer wallet','err'); await connectWallet(); return; }
    if(!confirm('Vote to cancel this payout? The team can then cancel the campaign and release its prize.')) return;
    var ms=p.vaultMultisig||live.vault_multisig;
    cancelVote.disabled=true;
    try{
      var txs=batchCountOf(live)>1?(await BardPlatform.listSettlementBatches(live.id)).map(function(r){ return r.tx_index; }):[live.tx_index];
      for(var i=0;i<txs.length;i++){
        if(txs[i]==null||String(txs[i])==='') continue;
        await BardVault.cancelPayoutProposal(BardPlatform.getRpc(), provider, wallet, ms, txs[i]);
      }
      toast('Bard voted to cancel','ok');
    }catch(e){
      toast((e&&e.message)||'Cancel vote failed','err');
    }finally{ cancelVote.disabled=false; }
  };
  var approve=document.getElementById('btn-bard-approve');
  if(approve) approve.onclick=async function(){
    if(!report.matches){ toast('The vault transaction does not match this payout','err'); return; }
    if(!window.BardVault||!BardVault.bardApprove){ toast('Vault toolkit failed to load — refresh','err'); return; }
    if(!provider){ toast('Connect the Bard signer wallet','err'); await connectWallet(); return; }
    var ms=p.vaultMultisig||live.vault_multisig;
    approve.disabled=true;
    try{
      if(batchCountOf(live)>1){
        // The check above covered every batch; Bard approves each one still unsigned.
        var parts=await BardPlatform.listSettlementBatches(live.id);
        // Every batch carries Bard's approval already: record batch 0 again so the payout catches up.
        if(parts.length&&parts.every(function(r){ return r.bard_signed; })) await BardPlatform.signSettlement(live.id,'bard',{txIndex:parts[0].tx_index,wallet:wallet,batch:Number(parts[0].batch)});
        for(var i=0;i<parts.length;i++){
          if(parts[i].bard_signed) continue;
          var partSig=await BardVault.bardApprove(BardPlatform.getRpc(), provider, wallet, ms, parts[i].tx_index);
          await BardPlatform.signSettlement(live.id,'bard',{sig:partSig,txIndex:parts[i].tx_index,wallet:wallet,batch:Number(parts[i].batch)});
        }
        toast('Bard signed','ok');
        await refreshState();
        openCampaign(c.id);
        return;
      }
      var sig=await BardVault.bardApprove(BardPlatform.getRpc(), provider, wallet, ms, live.tx_index);
      await BardPlatform.signSettlement(live.id,'bard',{sig:sig,txIndex:live.tx_index,wallet:wallet});
      toast('Bard signed','ok');
      await refreshState();
      openCampaign(c.id);
    }catch(e){
      toast((e&&e.message)||'Approve failed','err');
      approve.disabled=false;
    }
  };
  var exec=document.getElementById('btn-bard-execute');
  if(exec) exec.onclick=async function(){
    if(!report.matches){ toast('The vault transaction does not match this payout','err'); return; }
    exec.disabled=true;
    try{ await executeCurrent(p,c,live); }
    catch(e){ toast((e&&e.message)||'Execute failed','err'); exec.disabled=false; }
  };
}
async function cosignCurrent(p,c,live){
  if(!wallet||!provider){ toast('Connect the team wallet first','err'); await connectWallet(); return; }
  if(!window.BardVault||!BardVault.proposePayouts){ toast('Vault toolkit failed to load — refresh','err'); return; }
  var ms=p.vaultMultisig||live.vault_multisig;
  if(!ms){ toast('Link a vault first','err'); return; }
  try{
    var mint=p.vaultMint||p.mint;
    var cutArg=cutArgOf(live);
    var count=batchCountOf(live);
    if(count>1){
      if(!BardVault.proposePayoutBatches){ toast('Vault toolkit failed to load — refresh','err'); return; }
      // One vault transaction per batch; a batch already signed is not proposed again.
      var have=(await BardPlatform.listSettlementBatches(live.id)).filter(function(r){ return r.team_signed; });
      var signed=have.map(function(r){ return Number(r.batch); });
      var todo=[];
      for(var n=0;n<count;n++) if(signed.indexOf(n)<0) todo.push(n);
      // Every batch carries the team's approval already: record batch 0 again so the payout catches up.
      if(!todo.length&&have.length) await BardPlatform.signSettlement(live.id,'team',{txIndex:have[0].tx_index,wallet:wallet,multisig:ms,batch:Number(have[0].batch)});
      toast('Confirm '+todo.length+' vault transaction'+(todo.length===1?'':'s')+' in your wallet','ok');
      await BardVault.proposePayoutBatches(BardPlatform.getRpc(), provider, wallet, ms, mint, live.payouts, cutArg, {
        only: todo,
        onBatch: function(out){
          return BardPlatform.signSettlement(live.id,'team',{sig:out.signature,txIndex:out.transactionIndex,wallet:wallet,multisig:ms,batch:out.batch});
        }
      });
      toast('You signed. Waiting for Bard.','ok');
      await refreshState();
      openCampaign(c.id);
      return;
    }
    toast('Confirm the payout in your wallet','ok');
    var out=await BardVault.proposePayouts(BardPlatform.getRpc(), provider, wallet, ms, mint, live.payouts, cutArg);
    await BardPlatform.signSettlement(live.id,'team',{sig:out.signature,txIndex:out.transactionIndex,wallet:wallet,multisig:ms});
    toast('You signed. Waiting for Bard.','ok');
    await refreshState();
    openCampaign(c.id);
  }catch(e){
    if(/rejected|denied|cancel/i.test(String(e&&e.message))) toast('Signature cancelled','err');
    else toast((e&&e.message)||'Sign failed','err');
  }
}
function setChoiceGroup(selector,attr,value,hiddenId){document.querySelectorAll(selector).forEach(function(btn){btn.classList.toggle('is-on',btn.getAttribute(attr)===value);});var hidden=hiddenId?document.getElementById(hiddenId):null;if(hidden)hidden.value=value;}
function fieldValue(id,fallback){var el=document.getElementById(id);return el?el.value:fallback;}
function toggleOn(id,on){var el=document.getElementById(id);if(el)el.classList.toggle('is-on',on);}
function applyOfferedTypes(){
  var offered=BardPlatform.OFFERED_CAMPAIGN_TYPES||[];
  var sel=document.getElementById('c-type');
  Array.prototype.slice.call(sel.options).forEach(function(opt){if(offered.indexOf(opt.value)<0)sel.removeChild(opt);});
  var raid=document.getElementById('mod-raid');
  if(offered.indexOf('raid')<0&&raid&&raid.parentNode)raid.parentNode.removeChild(raid);
}
applyOfferedTypes();
function syncTop3Total(){
  var a=Number(document.getElementById('c-top3-1').value||0);
  var b=Number(document.getElementById('c-top3-2').value||0);
  var c=Number(document.getElementById('c-top3-3').value||0);
  var el=document.getElementById('c-top3-total');
  if(!el) return a+b+c;
  var t=Math.round((a+b+c)*10)/10;
  el.textContent=t===100?(t+'% — looks good'):(t+'% — should add to 100');
  el.className='place-total '+(t===100?'is-ok':'is-bad');
  return t;
}
function humanToRaw(text, decimals){
  var t=String(text||'').trim();
  if(!/^\d+(\.\d+)?$/.test(t)) return null;
  var parts=t.split('.');
  var frac=parts[1]||'';
  if(frac.length>decimals) return null;
  while(frac.length<decimals) frac+='0';
  try{ return BigInt(decimals?parts[0]+frac:parts[0]); }catch(e){ return null; }
}
function rawToHuman(raw, decimals){
  var text=raw.toString();
  if(!decimals) return text;
  while(text.length<=decimals) text='0'+text;
  var whole=text.slice(0, text.length-decimals);
  var frac=text.slice(text.length-decimals).replace(/0+$/,'');
  return whole+(frac?'.'+frac:'');
}
function previewPrizeRaw(){
  var mode=document.getElementById('c-reward-mode').value||'fixed';
  var decimals=6;
  if(mode==='growing'){
    var capEl=document.getElementById('c-grow-cap');
    var cap=capEl?capEl.value.trim():'';
    if(!cap) return null;
    return humanToRaw(cap, decimals);
  }
  if(mode==='fixed'){
    var reward=document.getElementById('c-reward').value.trim();
    var count=document.getElementById('c-holder-count').value.trim();
    if(reward&&/^\d+$/.test(count)){
      var each=humanToRaw(reward, decimals);
      if(each==null) return null;
      return each*BigInt(count);
    }
  }
  var pool=document.getElementById('c-pool').value.trim();
  if(!pool) return null;
  return humanToRaw(pool, decimals);
}
function syncLockPreview(){
  var el=document.getElementById('lock-preview');
  if(!el) return;
  var bps=(window.BardPlatform&&BardPlatform.getCutBps)?Number(BardPlatform.getCutBps()):500;
  if(!Number.isFinite(bps)||bps<0) bps=500;
  var raw=previewPrizeRaw();
  if(raw==null){
    el.textContent='Enter the prize. It locks with Bard\'s cut before the campaign can go live. Preview uses 6 decimals; the server checks the mint.';
    return;
  }
  var cut=(raw*BigInt(Math.round(bps))+9999n)/10000n;
  var pct=bps/100;
  el.textContent='Preview (6 decimals): locks '+rawToHuman(raw,6)+' + '+rawToHuman(cut,6)+' (Bard '+pct+'%) = '+rawToHuman(raw+cut,6)+'. The server checks the mint.';
}
function syncGrowPreview(){
  var el=document.getElementById('grow-preview');
  if(!el) return;
  var start=document.getElementById('c-grow-start').value.trim()||'—';
  var add=document.getElementById('c-grow-add').value.trim()||'—';
  var every=document.getElementById('c-grow-every').value||'week';
  var cap=document.getElementById('c-grow-cap').value.trim();
  el.textContent='Starts at '+start+', adds '+add+' every '+every+(cap?(', locks the cap '+cap):', needs a cap before it can lock')+'.';
  syncLockPreview();
}
function syncCampaignBuilder(){
  var type=document.getElementById('c-type').value;
  var raidMode=fieldValue('c-raid-mode','open');
  var rewardMode=document.getElementById('c-reward-mode').value;
  var access=document.getElementById('c-access').value;
  var days=document.getElementById('c-days').value||'7';
  toggleOn('mod-raid',type==='raid');
  toggleOn('mod-hold',type==='hold');
  toggleOn('rule-qualify-hint',type==='hold');
  toggleOn('mod-post-url',type==='raid'&&raidMode==='post');
  toggleOn('mod-targets',type==='raid'&&raidMode==='kol_list');
  var top3=document.getElementById('mod-top3');
  if(top3) top3.classList.toggle('is-on',rewardMode==='top3');
  var grow=document.getElementById('mod-growing');
  if(grow) grow.classList.toggle('is-on',rewardMode==='growing');
  var amountWrap=document.getElementById('mod-reward-amount');
  var poolRow=document.getElementById('mod-pool-row');
  var daysEl=document.getElementById('mod-days');
  var rewardLbl=document.getElementById('c-reward-label');
  var poolLbl=document.getElementById('c-pool-label');
  var poolHint=document.getElementById('c-pool-hint');
  var rTeach=document.getElementById('reward-teach');
  var firstAmt=amountWrap?amountWrap.querySelector('.field'):null;
  var unitField=document.getElementById('c-unit')?document.getElementById('c-unit').closest('.field'):null;
  var countField=document.getElementById('c-holder-count')?document.getElementById('c-holder-count').closest('.field'):null;
  if(countField) countField.style.display=rewardMode==='fixed'?'flex':'none';
  if(rewardMode==='fixed'){
    if(rTeach) rTeach.innerHTML='<b>Fixed.</b> Every qualified holder gets the same payout.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr 1fr 1fr'; }
    if(firstAmt) firstAmt.style.display='flex';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='grid';
    if(daysEl) daysEl.style.display='flex';
    if(rewardLbl) rewardLbl.textContent='Payout per winner';
    if(poolLbl) poolLbl.textContent='Prize pool (optional)';
    if(poolHint) poolHint.textContent='Used when expected holders is blank. Otherwise the lock is payout times holders.';
  } else if(rewardMode==='top3'){
    if(rTeach) rTeach.innerHTML='<b>Top 3.</b> One prize pool. First, second, and third take the percentages you set. Rank comes from the holders table.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr'; }
    if(firstAmt) firstAmt.style.display='none';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='grid';
    if(daysEl) daysEl.style.display='flex';
    if(poolLbl) poolLbl.textContent='Total prize for the podium';
    if(poolHint) poolHint.textContent='Split by the percentages below. Shares must add to 100.';
    syncTop3Total();
  } else if(rewardMode==='pool'){
    if(rTeach) rTeach.innerHTML='<b>Shared pool.</b> One pot, split equally among everyone who met the rule.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr'; }
    if(firstAmt) firstAmt.style.display='none';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='grid';
    if(daysEl) daysEl.style.display='flex';
    if(poolLbl) poolLbl.textContent='Total shared pool';
    if(poolHint) poolHint.textContent='Split among those who qualify. This amount locks with Bard\'s cut.';
  } else if(rewardMode==='growing'){
    if(rTeach) rTeach.innerHTML='<b>Growing pool.</b> It accumulates up to the cap. The cap plus Bard\'s cut is what locks.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr'; }
    if(firstAmt) firstAmt.style.display='none';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='none';
    if(daysEl) daysEl.style.display=scoringOn()?'flex':'none';
    syncGrowPreview();
  } else {
    if(rTeach) rTeach.innerHTML='<b>Fixed.</b> Every qualified holder gets the same payout.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr 1fr'; }
    if(firstAmt) firstAmt.style.display='flex';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='grid';
    if(daysEl) daysEl.style.display='flex';
    if(rewardLbl) rewardLbl.textContent='Payout per winner';
  }
  var bits=[access==='approval'?'Approval required':'Open join', type];
  if(type==='raid') bits.push(({open:'open raid',post:'specific post',kol_list:'KOL list'})[raidMode]||raidMode);
  bits.push(({fixed:'fixed',top3:'top 3',pool:'shared pool',growing:'accumulating pool'})[rewardMode]||rewardMode);
  if(rewardMode==='growing' && !scoringOn()) bits.push('no end date');
  else bits.push(days+' days');
  var bestBox=document.getElementById('mod-best-n');
  if(bestBox) bestBox.style.display=scoringOn()?'block':'none';
  document.getElementById('camp-preview-text').textContent=bits.join(' · ');
  syncLockPreview();
}
function resetCampaignBuilder(){
  document.getElementById('form-campaign').reset();
  document.getElementById('c-type').value='hold';
  document.getElementById('c-access').value='open';
  document.getElementById('c-reward-mode').value='fixed';
  document.getElementById('c-days').value='7';
  if(document.getElementById('c-top3-1')){
    document.getElementById('c-top3-1').value='50';
    document.getElementById('c-top3-2').value='30';
    document.getElementById('c-top3-3').value='20';
  }
  if(document.getElementById('c-grow-every')) document.getElementById('c-grow-every').value='week';
  setChoiceGroup('[data-access]','data-access','open','c-access');
  setChoiceGroup('[data-raid]','data-raid','open','c-raid-mode');
  setChoiceGroup('[data-reward]','data-reward','fixed','c-reward-mode');
  syncCampaignBuilder();
}
document.querySelectorAll('[data-access]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-access]','data-access',btn.getAttribute('data-access'),'c-access');syncCampaignBuilder();});});
document.querySelectorAll('[data-raid]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-raid]','data-raid',btn.getAttribute('data-raid'),'c-raid-mode');syncCampaignBuilder();});});
document.querySelectorAll('[data-reward]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-reward]','data-reward',btn.getAttribute('data-reward'),'c-reward-mode');syncCampaignBuilder();});});
['c-top3-1','c-top3-2','c-top3-3'].forEach(function(id){ var el=document.getElementById(id); if(el) el.addEventListener('input',syncTop3Total); });
['c-grow-start','c-grow-add','c-grow-every','c-grow-cap'].forEach(function(id){ var el=document.getElementById(id); if(el) el.addEventListener('input',syncGrowPreview); if(el) el.addEventListener('change',syncGrowPreview); });
document.getElementById('c-type').addEventListener('change',syncCampaignBuilder);
document.getElementById('c-days').addEventListener('input',syncCampaignBuilder);
syncCampaignBuilder();
['c-reward','c-pool','c-holder-count','c-grow-cap'].forEach(function(id){
  var el=document.getElementById(id);
  if(el) el.addEventListener('input', syncLockPreview);
});
document.getElementById('btn-wallet').onclick=function(){if(wallet){if(confirm('Disconnect wallet?'))disconnectWallet();}else connectWallet();};
document.getElementById('btn-new-project').onclick=function(){show('onboard');};
document.getElementById('btn-new-campaign').onclick=function(){if(!findProject(currentProjectId)){toast('Open a project first','err');return;}resetCampaignBuilder();show('new-campaign');};
document.querySelectorAll('[data-go]').forEach(function(btn){btn.addEventListener('click',function(){var go=btn.getAttribute('data-go');if(go==='home'){renderHome();show('home');}else show(go);});});
document.getElementById('back-from-campaign').onclick=function(){openProject(currentProjectId);};
document.getElementById('back-from-detail').onclick=function(){openProject(currentProjectId);};
document.querySelectorAll('#page-project .tab').forEach(function(t){t.addEventListener('click',function(){renderProjectTabs(t.getAttribute('data-tab'));});});
document.getElementById('form-onboard').addEventListener('submit',async function(e){
  e.preventDefault();
  var name=document.getElementById('p-name').value.trim();
  var ticker=document.getElementById('p-ticker').value.trim().replace(/^\$/,'').toUpperCase();
  var mint=document.getElementById('p-mint').value.trim();
  if(!name||!ticker||!mint){toast('Fill in name, ticker, and mint','err');return;}
  if(BardPlatform.getMode&&BardPlatform.getMode()==='supabase'&&!(BardPlatform.getSessionWallet&&BardPlatform.getSessionWallet())){
    toast('Connect and sign in with your wallet first','err');
    await connectWallet();
    if(!(BardPlatform.getSessionWallet&&BardPlatform.getSessionWallet())) return;
  }
  var btn=document.getElementById('btn-submit-onboard');
  btn.disabled=true;
  btn.textContent='Creating…';
  try{
    var project=await BardPlatform.createProject({name:name,ticker:ticker,mint:mint,admin:wallet||null});
    await refreshState();
    toast('Project created','ok');
    document.getElementById('form-onboard').reset();
    openProject(project.id);
  }catch(err){
    console.error(err);
    toast((err&&err.message)||'Failed to create project','err');
  }finally{
    btn.disabled=false;
    btn.textContent='Create project';
  }
});
document.getElementById('form-campaign').addEventListener('submit',async function(e){
  e.preventDefault();
  var p=findProject(currentProjectId);
  if(!p) return;
  var title=document.getElementById('c-title').value.trim();
  var type=document.getElementById('c-type').value;
  var rule=document.getElementById('c-rule').value.trim();
  var reward=document.getElementById('c-reward').value.trim();
  var unit=document.getElementById('c-unit').value;
  var pool=document.getElementById('c-pool').value.trim();
  var days=parseInt(document.getElementById('c-days').value,10)||7;
  var accessMode=document.getElementById('c-access').value||'open';
  var rewardMode=document.getElementById('c-reward-mode').value||'fixed';
  var raidMode=type==='raid'?(fieldValue('c-raid-mode','open')||'open'):null;
  var postUrl=fieldValue('c-post-url','').trim();
  var targets=fieldValue('c-targets','').trim();
  var bonusHandle=fieldValue('c-bonus','').trim().replace(/^@/,'');
  if(bonusHandle) bonusHandle='@'+bonusHandle;
  var minBal=document.getElementById('c-min-bal').value.trim();
  var holdDays=document.getElementById('c-hold-days').value.trim();
  var holderCount=document.getElementById('c-holder-count').value.trim();
  if(!title||!rule){toast('Add a name and rule','err');return;}
  if(type==='raid'&&raidMode==='post'&&!postUrl){toast('Add the target post URL','err');return;}
  if(type==='raid'&&raidMode==='kol_list'&&!targets){toast('Add at least one target','err');return;}
  if(BardPlatform.getMode&&BardPlatform.getMode()==='supabase'&&!(BardPlatform.getSessionWallet&&BardPlatform.getSessionWallet())){
    toast('Connect and sign in with your wallet first','err');
    await connectWallet();
    if(!(BardPlatform.getSessionWallet&&BardPlatform.getSessionWallet())) return;
  }
  var config={};
  if(type==='hold'){
    if(minBal) config.minBalance=minBal;
    if(holdDays) config.holdDays=parseInt(holdDays,10)||null;
  }
  var prize=null;
  if(rewardMode==='top3'){
    var t1=document.getElementById('c-top3-1');
    var t2=document.getElementById('c-top3-2');
    var t3=document.getElementById('c-top3-3');
    config.top3First=Number((t1&&t1.value)||50);
    config.top3Second=Number((t2&&t2.value)||30);
    config.top3Third=Number((t3&&t3.value)||20);
    if(Math.round((config.top3First+config.top3Second+config.top3Third)*10)/10!==100){
      toast('Top 3 percentages must add to 100','err');
      return;
    }
    if(!pool){toast('Enter the prize holders will share','err');return;}
    prize=pool;
  }
  if(rewardMode==='pool'){
    if(!pool){toast('Enter the prize holders will share','err');return;}
    prize=pool;
  }
  if(rewardMode==='fixed'){
    if(holderCount) config.holderCount=holderCount;
    if(reward&&holderCount) prize=null;
    else if(pool) prize=pool;
    else if(reward){toast('Set the expected holders so the prize can lock','err');return;}
    else {toast('Enter the prize holders will share','err');return;}
  }
  if(rewardMode==='growing'){
    config.growStart=document.getElementById('c-grow-start').value.trim();
    config.growAdd=document.getElementById('c-grow-add').value.trim();
    config.growEvery=document.getElementById('c-grow-every').value||'week';
    config.growCap=document.getElementById('c-grow-cap').value.trim();
    if(!config.growStart){toast('Set a starting pool size','err');return;}
    if(!config.growAdd){toast('Set how much the pool adds each period','err');return;}
    if(!config.growCap){toast('A growing pool needs a cap before it can lock','err');return;}
    reward=config.growStart;
    pool=config.growCap;
    prize=config.growCap;
    if(!scoringOn()) days=0;
    else if(!(days>=1)){toast('A scored campaign needs an end','err');return;}
  }
  var bestN=null;
  if(scoringOn()){
    bestN=parseInt(document.getElementById('c-best-n').value,10);
    if(!bestN||bestN<1||bestN>10) bestN=5;
  }
  if(type==='raid'&&targets) config.targetList=targets.split(/[\n,]+/).map(function(s){return s.trim();}).filter(Boolean);
  var btn=document.getElementById('btn-submit-campaign');
  btn.disabled=true;
  btn.textContent='Creating…';
  try{
    var camp=await BardPlatform.createCampaign(currentProjectId,{
      title:title,type:type,rule:rule,reward:reward,unit:unit,pool:pool,prize:prize,
      days:days,accessMode:accessMode,raidMode:raidMode,rewardMode:rewardMode,
      postUrl:postUrl||null,targets:targets||null,bonusHandle:bonusHandle||null,config:config,
      bestN:bestN
    });
    await refreshState();
    toast('Campaign live','ok');
    resetCampaignBuilder();
    openCampaign(camp.id);
  }catch(err){
    console.error(err);
    toast((err&&err.message)||'Failed to create campaign','err');
  }finally{
    btn.disabled=false;
    btn.textContent='Create campaign';
  }
});
// Cancel a campaign that is not paid (TRAA-2331). The worker refuses while a payout proposal can
// still execute: the team closes each one with its wallet, then asks again. An approved proposal
// also needs Bard's cancel vote, cast from the Bard signs panel.
async function cancelCampaignFlow(c){
  try{ return await BardPlatform.cancelCampaign(c.id); }
  catch(err){
    if(!err||err.reason!=='open_proposals') throw err;
    if(!window.BardVault||!BardVault.cancelPayoutProposal){ toast('Vault toolkit failed to load — refresh','err'); return null; }
    if(!provider){ toast('Connect the team wallet','err'); await connectWallet(); return null; }
    for(var i=0;i<err.proposals.length;i++){
      var open=err.proposals[i];
      await BardVault.cancelPayoutProposal(BardPlatform.getRpc(), provider, wallet, open.multisig, open.txIndex);
    }
  }
  try{ return await BardPlatform.cancelCampaign(c.id); }
  catch(err){
    if(err&&err.reason==='open_proposals'){ toast('Your cancel vote is in. Bard must cancel the approved payout too, then cancel again.','err'); return null; }
    throw err;
  }
}
document.getElementById('btn-cancel-campaign').onclick=async function(){var c=findCampaign(currentProjectId,currentCampaignId);if(!c)return;if(!confirm('Cancel this campaign? Nobody is paid, and its locked prize is released for new campaigns.'))return;var btn=this;btn.disabled=true;try{var out=await cancelCampaignFlow(c);if(out){await refreshState();toast('Campaign cancelled; the locked prize is released','ok');openCampaign(c.id);}}catch(err){console.error(err);toast((err&&err.message)||'Failed to cancel campaign','err');}finally{btn.disabled=false;}};
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
