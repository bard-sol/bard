(function(){
var state={projects:[]},currentProjectId=null,currentCampaignId=null,dataMode='local',wallet=null,provider=null;
function toast(msg,kind){var el=document.getElementById('toast');el.textContent=msg;el.className='toast is-on'+(kind?' '+kind:'');clearTimeout(toast._t);toast._t=setTimeout(function(){el.className='toast';},3200);}
function show(name){document.querySelectorAll('.page').forEach(function(p){p.classList.remove('is-on');});var page=document.getElementById('page-'+name);if(page)page.classList.add('is-on');window.scrollTo(0,0);}
function initials(s){s=(s||'?').trim();return s.slice(0,2).toUpperCase();}
function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');}
function shortMint(m){if(!m||m.length<10)return m||'—';return m.slice(0,4)+'…'+m.slice(-4);}
function shortAddr(a){if(!a)return'—';if(a.length<10)return a;return a.slice(0,4)+'…'+a.slice(-4);}
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

function formatDate(iso){try{return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}catch(e){return'—';}}
function findProject(id){return state.projects.find(function(p){return p.id===id;});}
function isPremium(p){return !!(p&&p.plan==='pro');}
function planLabel(p){return isPremium(p)?'Premium':'Starter';}

function findCampaign(pid,cid){var p=findProject(pid);if(!p)return null;return(p.campaigns||[]).find(function(c){return c.id===cid;});}
function activeCount(p){return(p.campaigns||[]).filter(function(c){return c.status==='active';}).length;}
function updateWalletUI(){var btn=document.getElementById('btn-wallet');if(wallet){btn.textContent=shortAddr(wallet);btn.classList.add('is-on');}else{btn.textContent='Connect wallet';btn.classList.remove('is-on');}var hint=document.getElementById('onboard-wallet-hint');if(hint){if(BardPlatform.feesEnabled&&BardPlatform.feesEnabled()){hint.textContent=wallet?'You will sign a 0.25 SOL transfer from '+shortAddr(wallet)+' to the platform treasury.':'Connect a wallet in the header first.';}else{hint.textContent='Fees are off for testing — create freely. Wallet optional.';}}}
async function connectWallet(){try{var p=(window.phantom&&window.phantom.solana)||window.solflare||window.solana;if(!p){toast('No Solana wallet found. Install Phantom or Solflare.','err');return;}var resp=await p.connect();wallet=(resp.publicKey&&resp.publicKey.toString())||(p.publicKey&&p.publicKey.toString());if(!wallet){toast('Could not read wallet address','err');return;}provider=p;localStorage.setItem('bard_team_wallet',wallet);updateWalletUI();toast('Wallet connected','ok');}catch(e){console.error(e);toast('Connection cancelled or failed','err');}}
function disconnectWallet(){wallet=null;provider=null;localStorage.removeItem('bard_team_wallet');updateWalletUI();}
async function refreshState(){if(window.BardPlatform){await BardPlatform.init();dataMode=BardPlatform.getMode();state.projects=await BardPlatform.listProjects();var badge=document.getElementById('data-mode');if(badge)badge.textContent=dataMode==='supabase'?'· Live DB':'· Local only';}}
function renderHome(){var list=document.getElementById('project-list');var totalCamps=0;state.projects.forEach(function(p){totalCamps+=activeCount(p);});document.getElementById('stat-projects').textContent=state.projects.length;document.getElementById('stat-campaigns').textContent=totalCamps;renderInbox();if(!state.projects.length){list.innerHTML='<div class="empty"><h3>No projects yet</h3><p>Onboard your first token to start running campaigns.</p><button class="btn btn--solid" id="empty-onboard">Onboard a project</button></div>';document.getElementById('empty-onboard').onclick=function(){show('onboard');};return;}list.innerHTML=state.projects.map(function(p){var n=(p.campaigns||[]).length;var a=activeCount(p);var feePill=p.feePaid?'<span class="pill pill--paid">Fee paid</span>':'<span class="pill pill--pending">Fee pending</span>';
    var vaultPill=p.vaultAddress?'<span class="pill pill--paid">Vault locked</span>':'';
    var planPill='<span class="pill '+(isPremium(p)?'pill--live':'pill--draft')+'">'+planLabel(p)+'</span>';return'<div class="card card--hover" data-open-project="'+p.id+'"><div class="item" style="padding:0;border:none"><span class="item__ava">'+initials(p.ticker||p.name)+'</span><div class="item__body"><div class="item__title">'+escapeHtml(p.name)+' <span class="muted">· $'+escapeHtml(p.ticker)+'</span></div><div class="item__sub">'+escapeHtml(shortMint(p.mint))+' · '+n+' campaign'+(n===1?'':'s')+'</div></div><div class="item__right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">'+(a?'<span class="pill pill--live">'+a+' active</span>':'<span class="pill pill--draft">No live</span>')+planPill+vaultPill+feePill+'</div></div></div>';}).join('');list.querySelectorAll('[data-open-project]').forEach(function(el){el.addEventListener('click',function(){openProject(el.getAttribute('data-open-project'));});});}
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
function openProject(id){var p=findProject(id);if(!p)return;currentProjectId=id;document.getElementById('proj-kicker').textContent='$'+p.ticker;document.getElementById('proj-title').textContent=p.name;document.getElementById('proj-meta').textContent=shortMint(p.mint)+' · '+planLabel(p)+(isPremium(p)?' · vault, airdrops, accumulating pools':' · raids')+' · onboarded '+formatDate(p.createdAt);renderProjectTabs('campaigns');show('project');}
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
  var starter=isPremium(p);
  el.innerHTML=vaultBadgeHtml(p)+
    '<div class="card" style="margin-bottom:12px"><p class="kicker">How it works</p>'+
    '<p style="margin:0;color:var(--body)">You and Bard each hold one key. Threshold 2. Example: lock 10M $'+escapeHtml(p.ticker)+'. When an airdrop is ready, you get a sign notice. You sign. Bard signs. Then it pays. Neither of us can move funds alone.</p></div>'+
    ((starter||addr)?'':'<div class="plan-lock" style="margin-bottom:12px">Premium (4 SOL) unlocks the vault and airdrops. Starter is raids only. <button type="button" class="btn btn--solid btn--sm" id="vault-go-starter">Upgrade to Premium</button></div>')+
    '<div class="card" style="margin-bottom:12px"><div class="form">'+
    (addr?'':'<button type="button" class="btn btn--solid" id="btn-create-vault"'+(starter?'':' disabled')+'>Create 2-of-2 vault</button><span class="hint" id="vault-create-hint">One Phantom signature. Your connected wallet pays ~0.05 SOL of rent (not the prize). We add your wallet + Bard as the two members.</span><p class="hint" id="vault-sol-line" style="margin-top:8px">Checking SOL in the connected wallet…</p>')+
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
  
  (function(){
    var line=document.getElementById('vault-sol-line');
    if(!line) return;
    if(!wallet){ line.textContent='Connect the team wallet in the header first. That wallet pays the ~0.05 SOL rent.'; return; }
    walletSol(wallet).then(function(sol){
      if(sol==null){ line.textContent='Could not read SOL for '+shortAddr(wallet)+'.'; return; }
      if(sol<0.05) line.innerHTML='Connected wallet '+escapeHtml(shortAddr(wallet))+' has <b>'+sol.toFixed(4)+' SOL</b>. Send ~0.05 SOL there before creating. This is rent, not the prize.';
      else line.textContent='Connected wallet '+shortAddr(wallet)+' · '+sol.toFixed(4)+' SOL. Ready to create.';
    });
  })();
var createBtn=document.getElementById('btn-create-vault');
  if(createBtn) createBtn.onclick=async function(){
    if(!wallet||!provider){ toast('Connect the team wallet first','err'); await connectWallet(); return; }
    if(!hasSdk){ toast('Vault toolkit failed to load — refresh','err'); return; }
    var btn=this;
    btn.disabled=true; btn.textContent='Checking SOL…';
    try{
      var sol=await walletSol(wallet);
      var line=document.getElementById('vault-sol-line');
      if(line){
        if(sol==null) line.textContent='Could not read SOL. Check the RPC and try again.';
        else if(sol<0.05) line.innerHTML='Connected wallet '+escapeHtml(shortAddr(wallet))+' has <b>'+sol.toFixed(4)+' SOL</b>. Need ~0.05 SOL of rent. Send SOL to that wallet, then retry.';
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
      return '<tr><td class="num">'+escapeHtml(shortAddr(r.wallet))+'</td><td><span class="pill '+pill+'">'+escapeHtml(r.role)+'</span></td><td>'+escapeHtml(r.note||'—')+'</td><td><button class="btn btn--ghost btn--sm" data-drop="'+escapeHtml(r.wallet)+'">Remove</button></td></tr>';
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
  var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();
  var premium=isPremium(p);
  var feeStatus=!feesOn?'<span class="pill pill--paid">waived (testing)</span>':(p.feePaid?'<span class="pill pill--paid">paid</span>':'<span class="pill pill--pending">pending</span>');
  function card(id, title, price, body, feats){
    var current=(id==='pro' && premium) || (id==='starter' && !premium);
    var btn='';
    if(current) btn='<div class="hint" style="margin-top:10px">Current plan</div>';
    else if(id==='pro') btn='<button type="button" class="btn btn--solid btn--sm" data-upgrade="pro" style="margin-top:12px">'+(feesOn?'Upgrade · 4 SOL':'Unlock Premium')+'</button>';
    return '<div class="plan '+(current?'is-on':'')+'"><strong>'+title+'</strong><div class="price">'+price+'</div><span>'+body+'</span><ul class="plan-feats">'+feats+'</ul>'+btn+'</div>';
  }
  setEl.innerHTML=
    '<div class="card" style="margin-bottom:12px"><p class="kicker">Project</p>'+
    '<div class="form"><div class="field"><label>Name</label><div>'+escapeHtml(p.name)+'</div></div>'+
    '<div class="field"><label>Ticker</label><div>$'+escapeHtml(p.ticker)+'</div></div>'+
    '<div class="field"><label>Mint</label><div class="num" style="word-break:break-all">'+escapeHtml(p.mint)+'</div></div>'+
    '<div class="field"><label>Onboard fee</label><div>'+feeStatus+'</div></div></div></div>'+
    '<div class="card"><p class="kicker">Plan</p>'+
    '<p style="margin:0 0 14px;color:var(--body);font-size:.92rem">There is no free tier. Starter is raids. Premium adds the vault, airdrops, and accumulating pools.</p>'+
    '<div class="plans">'+
      card('starter','Starter · raids','1 SOL','Drop a call. Holders smash it here.',
        '<li><span class="y">+</span> Raids, smash buttons, live board, roster</li><li><span class="n">–</span><span class="off"> No vault, no airdrops, no growing pools</span></li>')+
      card('pro','Premium · the lock','4 SOL','Everything in Starter, plus money holders can verify.',
        '<li><span class="y">+</span> 2-of-2 vault, dual-sign airdrops</li><li><span class="y">+</span> Growing / shared / top 3</li><li><span class="y">+</span> Hold, refer, custom boards</li>')+
    '</div></div>';
  setEl.querySelectorAll('[data-upgrade]').forEach(function(btn){
    btn.onclick=async function(){
      try{
        if(feesOn){
          if(!wallet||!provider){ toast('Connect a wallet first','err'); await connectWallet(); return; }
          btn.disabled=true; btn.textContent='Confirm 4 SOL…';
          await BardPlatform.payFee('pro',wallet,provider,{projectId:p.id});
        }
        await BardPlatform.setProjectPlan(p.id,'pro');
        await refreshState();
        toast('Premium unlocked','ok');
        renderProjectTabs('settings');
      }catch(e){ toast((e&&e.message)||'Upgrade failed','err'); }
      finally{ btn.disabled=false; btn.textContent=feesOn?'Upgrade · 4 SOL':'Unlock Premium'; }
    };
  });
}
function renderProjectTabs(tab){var p=findProject(currentProjectId);if(!p)return;document.querySelectorAll('#page-project .tab').forEach(function(t){t.classList.toggle('is-on',t.getAttribute('data-tab')===tab);});var campsEl=document.getElementById('proj-campaigns');var setEl=document.getElementById('proj-settings');var vaultEl=document.getElementById('proj-vault');var rosterEl=document.getElementById('proj-roster');if(tab==='roster'){campsEl.style.display='none';if(setEl)setEl.style.display='none';if(vaultEl)vaultEl.style.display='none';if(rosterEl){rosterEl.style.display='block';renderRosterPanel(p);}return;}if(tab==='vault'){campsEl.style.display='none';setEl.style.display='none';vaultEl.style.display='block';renderVaultPanel(p);return;}if(tab==='settings'){campsEl.style.display='none';if(vaultEl)vaultEl.style.display='none';if(rosterEl)rosterEl.style.display='none';setEl.style.display='block';renderSettingsPanel(p);return;}if(vaultEl)vaultEl.style.display='none';if(rosterEl)rosterEl.style.display='none';setEl.style.display='none';campsEl.style.display='block';var camps=p.campaigns||[];if(!camps.length){campsEl.innerHTML='<div class="empty"><h3>No campaigns yet</h3><p>Create a hold, raid, refer, or custom campaign for $'+escapeHtml(p.ticker)+'.</p><button class="btn btn--solid" id="empty-camp">New campaign</button></div>';document.getElementById('empty-camp').onclick=function(){resetCampaignBuilder();show('new-campaign');};return;}campsEl.innerHTML=camps.slice().reverse().map(function(c){var pill=c.status==='active'?'pill--live':(c.status==='ended'?'pill--ended':'pill--draft');var fee=c.feePaid?'<span class="pill pill--paid">fee paid</span>':'<span class="pill pill--pending">fee pending</span>';var sub=[c.type,(c.accessMode||c.access_mode)==='approval'?'approval':'open',c.rewardMode||c.reward_mode||'fixed',(c.rule||'').slice(0,48)].filter(Boolean).join(' · ');return'<div class="card card--hover" data-open-camp="'+c.id+'"><div class="item" style="padding:0;border:none"><div class="item__body"><div class="item__title">'+escapeHtml(c.title)+'</div><div class="item__sub">'+escapeHtml(sub)+((c.rule||'').length>48?'…':'')+'</div></div><div class="item__right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="pill '+pill+'">'+escapeHtml(c.status)+'</span>'+fee+'</div></div></div>';}).join('');campsEl.querySelectorAll('[data-open-camp]').forEach(function(el){el.addEventListener('click',function(){openCampaign(el.getAttribute('data-open-camp'));});});}
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
      if(!j.qualified && j.status!=='rejected') acts+='<button class="btn btn--solid btn--sm" data-js="qual" data-w="'+escapeHtml(j.wallet)+'">Qualify</button> ';
      acts+='<button class="btn btn--ghost btn--sm" data-js="trust" data-w="'+escapeHtml(j.wallet)+'">Remember</button> <button class="btn btn--ghost btn--sm" data-js="whale" data-w="'+escapeHtml(j.wallet)+'">Whale</button> <button class="btn btn--ghost btn--sm" data-js="block" data-w="'+escapeHtml(j.wallet)+'">Block</button>';
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
          if(act==='trust') await BardPlatform.upsertRoster(p.id,w,'trusted','from campaign');
          if(act==='whale') await BardPlatform.upsertRoster(p.id,w,'whale','from campaign');
          if(act==='block'){ await BardPlatform.upsertRoster(p.id,w,'blocked','from campaign'); await BardPlatform.setJoinStatus(c.id,w,'rejected'); }
          await refreshState();
          openCampaign(c.id);
        }catch(err){ toast((err&&err.message)||'Update failed','err'); }
      });
    });
  }
  var sets=[];
  try{ sets = await BardPlatform.listSettlements(c.id); }catch(e){ console.error(e); }
  renderSettleBox(p,c,joins,sets);
  renderDrawBox(p,c,joins);
}
function renderDrawBox(p,c,joins){
  var host=document.getElementById('camp-settle');
  if(!host) return;
  var wrap=document.createElement('div');
  wrap.style.marginTop='18px';
  wrap.style.paddingTop='14px';
  wrap.style.borderTop='1px solid rgba(244,244,245,.08)';
  var winners=c.drawWinners||[];
  if(c.drawSeed){
    wrap.innerHTML='<strong style="font-variation-settings:\'wght\' 620">Airdrop draw</strong>'+
      '<p class="muted" style="margin:6px 0 8px;font-size:.86rem">Provable. Seed is public. Same seed always yields the same order.</p>'+
      '<p class="num" style="font-size:.78rem;word-break:break-all;color:var(--muted)">'+escapeHtml(c.drawSeed)+'</p>'+
      '<table class="table"><thead><tr><th>#</th><th>Wallet</th></tr></thead><tbody>'+
      winners.map(function(w,i){ return '<tr><td class="num">'+(i+1)+'</td><td class="num">'+escapeHtml(shortAddr(w.wallet||w))+'</td></tr>'; }).join('')+
      '</tbody></table>';
    host.appendChild(wrap);
    return;
  }
  wrap.innerHTML='<strong style="font-variation-settings:\'wght\' 620">Airdrop draw</strong>'+
    '<p class="muted" style="margin:6px 0 10px;font-size:.86rem">Set the rules, we draw. Seed uses a Solana blockhash so nobody can pick the order.</p>'+
    '<button type="button" class="btn btn--ghost btn--sm" id="btn-draw">Draw now</button>';
  host.appendChild(wrap);
  var btn=document.getElementById('btn-draw');
  if(btn) btn.onclick=async function(){
    try{
      await BardPlatform.drawAirdrop(c.id, 0);
      toast('Draw locked. Holders can verify the seed.','ok');
      await refreshState();
      openCampaign(c.id);
    }catch(e){ toast((e&&e.message)||'Draw failed','err'); }
  };
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
function syncGrowPreview(){
  var el=document.getElementById('grow-preview');
  if(!el) return;
  var start=document.getElementById('c-grow-start').value.trim()||'—';
  var add=document.getElementById('c-grow-add').value.trim()||'—';
  var every=document.getElementById('c-grow-every').value||'week';
  var cap=document.getElementById('c-grow-cap').value.trim();
  el.textContent='Starts at '+start+', adds '+add+' every '+every+(cap?(', stops adding at '+cap):', no cap')+'. No end date — runs until someone wins or you end it.';
}
function syncCampaignBuilder(){
  var type=document.getElementById('c-type').value;
  var raidMode=document.getElementById('c-raid-mode').value;
  var rewardMode=document.getElementById('c-reward-mode').value;
  var access=document.getElementById('c-access').value;
  var days=document.getElementById('c-days').value||'7';
  document.getElementById('mod-raid').classList.toggle('is-on',type==='raid');
  document.getElementById('mod-hold').classList.toggle('is-on',type==='hold');
  document.getElementById('mod-post-url').classList.toggle('is-on',type==='raid'&&raidMode==='post');
  document.getElementById('mod-targets').classList.toggle('is-on',type==='raid'&&raidMode==='kol_list');
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
  var lockBox=document.getElementById('mod-lock-vault');
  var p=findProject(currentProjectId);
  var premium=isPremium(p);
  if(lockBox) lockBox.style.display=premium?'block':'none';
  if(rewardMode==='fixed'){
    if(rTeach) rTeach.innerHTML='<b>Fixed.</b> Every qualified holder gets the same payout. Starter can run this.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr 1fr'; }
    if(firstAmt) firstAmt.style.display='flex';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='grid';
    if(daysEl) daysEl.style.display='flex';
    if(rewardLbl) rewardLbl.textContent='Payout per winner';
    if(poolLbl) poolLbl.textContent='Max budget (optional)';
    if(poolHint) poolHint.textContent='Stop paying once this is gone.';
  } else if(rewardMode==='top3'){
    if(rTeach) rTeach.innerHTML='<b>Top 3 — Premium.</b> One prize pool. First, second, and third take the percentages you set. Rank comes from the holders table.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr'; }
    if(firstAmt) firstAmt.style.display='none';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='grid';
    if(daysEl) daysEl.style.display='flex';
    if(poolLbl) poolLbl.textContent='Total prize for the podium';
    if(poolHint) poolHint.textContent='Split by the percentages below.';
    syncTop3Total();
  } else if(rewardMode==='pool'){
    if(rTeach) rTeach.innerHTML='<b>Shared pool — Premium.</b> One pot, split equally among everyone who met the rule.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr'; }
    if(firstAmt) firstAmt.style.display='none';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='grid';
    if(daysEl) daysEl.style.display='flex';
    if(poolLbl) poolLbl.textContent='Total shared pool';
    if(poolHint) poolHint.textContent='Split among those who qualify — not a per-person amount.';
  } else if(rewardMode==='growing'){
    if(rTeach) rTeach.innerHTML='<b>Growing pool — Premium.</b> It accumulates. Starts at your starting size, then adds more every day or week. No 7-day timer. Stops when someone wins, or you end it.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr'; }
    if(firstAmt) firstAmt.style.display='none';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='none';
    if(daysEl) daysEl.style.display='none';
    syncGrowPreview();
  } else {
    if(rTeach) rTeach.innerHTML='<b>Fixed.</b> Every qualified holder gets the same payout.';
    if(amountWrap){ amountWrap.style.display='grid'; amountWrap.style.gridTemplateColumns='1fr 1fr'; }
    if(firstAmt) firstAmt.style.display='flex';
    if(unitField) unitField.style.display='flex';
    if(poolRow) poolRow.style.display='grid';
    if(daysEl) daysEl.style.display='flex';
    if(rewardLbl) rewardLbl.textContent='Payout per winner';
    if(poolLbl) poolLbl.textContent='Max budget (optional)';
    if(poolHint) poolHint.textContent='Stop paying once this is gone.';
  }
  var bits=[access==='approval'?'Approval required':'Open join', type];
  if(type==='raid') bits.push(({open:'open raid',post:'specific post',kol_list:'KOL list'})[raidMode]||raidMode);
  bits.push(({fixed:'fixed',top3:'top 3',pool:'shared pool',growing:'accumulating pool'})[rewardMode]||rewardMode);
  if(rewardMode==='growing') bits.push('no end date');
  else bits.push(days+' days');
  document.getElementById('camp-preview-text').textContent=bits.join(' · ');
  var note=document.getElementById('c-plan-note');
  if(note){
    var needPrem=(BardPlatform.isPremiumType&&BardPlatform.isPremiumType(type)) || (BardPlatform.isPremiumReward&&BardPlatform.isPremiumReward(rewardMode));
    if(p && !isPremium(p) && needPrem){
      note.style.display='block';
      note.innerHTML='Premium (4 SOL) unlocks this — vault, airdrops, accumulating pools, hold boards. Starter is raids with a fixed payout. <button type="button" class="btn btn--solid btn--sm" id="c-go-prem">Upgrade to Premium</button>';
      var go=document.getElementById('c-go-prem');
      if(go) go.onclick=function(){ show('project'); renderProjectTabs('settings'); };
    } else { note.style.display='none'; note.innerHTML=''; }
  }
}
function resetCampaignBuilder(){document.getElementById('form-campaign').reset();document.getElementById('c-type').value='raid';document.getElementById('c-access').value='open';document.getElementById('c-raid-mode').value='open';document.getElementById('c-reward-mode').value='fixed';document.getElementById('c-days').value='7';if(document.getElementById('c-top3-1')){document.getElementById('c-top3-1').value='50';document.getElementById('c-top3-2').value='30';document.getElementById('c-top3-3').value='20';}if(document.getElementById('c-grow-every'))document.getElementById('c-grow-every').value='week';setChoiceGroup('[data-access]','data-access','open','c-access');setChoiceGroup('[data-raid]','data-raid','open','c-raid-mode');setChoiceGroup('[data-reward]','data-reward','fixed','c-reward-mode');syncCampaignBuilder();}
document.querySelectorAll('[data-access]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-access]','data-access',btn.getAttribute('data-access'),'c-access');syncCampaignBuilder();});});
document.querySelectorAll('[data-raid]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-raid]','data-raid',btn.getAttribute('data-raid'),'c-raid-mode');syncCampaignBuilder();});});
document.querySelectorAll('[data-reward]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-reward]','data-reward',btn.getAttribute('data-reward'),'c-reward-mode');syncCampaignBuilder();});});
['c-top3-1','c-top3-2','c-top3-3'].forEach(function(id){ var el=document.getElementById(id); if(el) el.addEventListener('input',syncTop3Total); });
['c-grow-start','c-grow-add','c-grow-every','c-grow-cap'].forEach(function(id){ var el=document.getElementById(id); if(el) el.addEventListener('input',syncGrowPreview); if(el) el.addEventListener('change',syncGrowPreview); });
document.getElementById('c-type').addEventListener('change',syncCampaignBuilder);
document.getElementById('c-days').addEventListener('input',syncCampaignBuilder);
syncCampaignBuilder();
document.querySelectorAll('[data-plan]').forEach(function(btn){
  btn.addEventListener('click',function(){
    document.getElementById('p-plan').value=btn.getAttribute('data-plan');
    document.querySelectorAll('[data-plan]').forEach(function(b){ b.classList.toggle('is-on', b===btn); });
    var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();
    var plan=btn.getAttribute('data-plan');
    document.getElementById('onboard-fee-lbl').textContent=plan==='pro'?'Premium · vault + airdrops':'Starter · raids';
    document.getElementById('onboard-fee-amt').textContent=plan==='pro'?(feesOn?'4 SOL':'4 SOL · testing waived'):(feesOn?'1 SOL':'1 SOL · testing waived');
  });
});
document.getElementById('btn-wallet').onclick=function(){if(wallet){if(confirm('Disconnect wallet?'))disconnectWallet();}else connectWallet();};
document.getElementById('btn-new-project').onclick=function(){show('onboard');};
document.getElementById('btn-new-campaign').onclick=function(){if(!findProject(currentProjectId)){toast('Open a project first','err');return;}resetCampaignBuilder();show('new-campaign');};
document.querySelectorAll('[data-go]').forEach(function(btn){btn.addEventListener('click',function(){var go=btn.getAttribute('data-go');if(go==='home'){renderHome();show('home');}else show(go);});});
document.getElementById('back-from-campaign').onclick=function(){openProject(currentProjectId);};
document.getElementById('back-from-detail').onclick=function(){openProject(currentProjectId);};
document.querySelectorAll('#page-project .tab').forEach(function(t){t.addEventListener('click',function(){renderProjectTabs(t.getAttribute('data-tab'));});});
document.getElementById('form-onboard').addEventListener('submit',async function(e){e.preventDefault();var name=document.getElementById('p-name').value.trim();var ticker=document.getElementById('p-ticker').value.trim().replace(/^\$/,'').toUpperCase();var mint=document.getElementById('p-mint').value.trim();var plan=(document.getElementById('p-plan')&&document.getElementById('p-plan').value)||'starter';
    if(plan!=='pro') plan='starter';
    if(!name||!ticker||!mint){toast('Fill in name, ticker, and mint','err');return;}var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();if(feesOn&&(!wallet||!provider)){toast('Connect a wallet first','err');await connectWallet();return;}var btn=document.getElementById('btn-submit-onboard');btn.disabled=true;btn.textContent='Creating…';try{var project=await BardPlatform.createProject({name:name,ticker:ticker,mint:mint,admin:wallet||null,plan:plan});if(feesOn&&wallet&&provider){var feeKind=plan==='pro'?'pro':'starter';btn.textContent=plan==='pro'?'Confirm 4 SOL in wallet…':'Confirm 1 SOL in wallet…';var result=await BardPlatform.payFee(feeKind,wallet,provider,{projectId:project.id});await BardPlatform.setProjectPlan(project.id,plan);await refreshState();toast(result.ok?(plan==='pro'?'Premium live · 4 SOL paid':'Starter live · 1 SOL paid'):'Project created · payment pending','ok');}else{await refreshState();toast(plan==='pro'?'Premium unlocked (testing)':'Starter unlocked (testing)','ok');}document.getElementById('form-onboard').reset();if(document.getElementById('p-plan'))document.getElementById('p-plan').value='starter';openProject(project.id);}catch(err){console.error(err);toast((err&&err.message)||'Failed to create project','err');}finally{btn.disabled=false;btn.textContent='Create project';}});
document.getElementById('form-campaign').addEventListener('submit',async function(e){e.preventDefault();var p=findProject(currentProjectId);if(!p)return;var title=document.getElementById('c-title').value.trim();var type=document.getElementById('c-type').value;var rule=document.getElementById('c-rule').value.trim();var reward=document.getElementById('c-reward').value.trim();var unit=document.getElementById('c-unit').value;var pool=document.getElementById('c-pool').value.trim();var days=parseInt(document.getElementById('c-days').value,10)||7;var accessMode=document.getElementById('c-access').value||'open';var rewardMode=document.getElementById('c-reward-mode').value||'fixed';var raidMode=type==='raid'?(document.getElementById('c-raid-mode').value||'open'):null;var postUrl=document.getElementById('c-post-url').value.trim();var targets=document.getElementById('c-targets').value.trim();var bonusHandle=document.getElementById('c-bonus').value.trim().replace(/^@/,'');if(bonusHandle)bonusHandle='@'+bonusHandle;var minBal=document.getElementById('c-min-bal').value.trim();var holdDays=document.getElementById('c-hold-days').value.trim();var t1=document.getElementById('c-top3-1');var t2=document.getElementById('c-top3-2');var t3=document.getElementById('c-top3-3');
    if(!title||!rule){toast('Add a name and rule','err');return;}
    var needPrem=(BardPlatform.isPremiumType&&BardPlatform.isPremiumType(type))||(BardPlatform.isPremiumReward&&BardPlatform.isPremiumReward(rewardMode));
    if(!isPremium(p) && needPrem){
      toast('Premium unlocks this. Starter is raids with a fixed payout.','err'); renderProjectTabs('settings'); show('project'); return;
    }if(type==='raid'&&raidMode==='post'&&!postUrl){toast('Add the target post URL','err');return;}if(type==='raid'&&raidMode==='kol_list'&&!targets){toast('Add at least one target','err');return;}var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();if(feesOn&&!p.feePaid){toast('Pay onboard fee in Settings first','err');show('project');renderProjectTabs('settings');return;}if(feesOn&&(!wallet||!provider)){toast('Connect a wallet first','err');await connectWallet();return;}var config={};
    if(type==='hold'){if(minBal)config.minBalance=minBal;if(holdDays)config.holdDays=parseInt(holdDays,10)||null;}
    if(rewardMode==='top3'){
      config.top3First=Number((t1&&t1.value)||50);
      config.top3Second=Number((t2&&t2.value)||30);
      config.top3Third=Number((t3&&t3.value)||20);
      if(Math.round((config.top3First+config.top3Second+config.top3Third)*10)/10!==100){toast('Top 3 percentages must add to 100','err');return;}
    }
    if(rewardMode==='growing'){
      config.growStart=document.getElementById('c-grow-start').value.trim();
      config.growAdd=document.getElementById('c-grow-add').value.trim();
      config.growEvery=document.getElementById('c-grow-every').value||'week';
      config.growCap=document.getElementById('c-grow-cap').value.trim()||'';
      if(!config.growStart){toast('Set a starting pool size','err');return;}
      if(!config.growAdd){toast('Set how much the pool adds each period','err');return;}
      reward=config.growStart;
      pool=config.growCap||config.growStart;
      days=0;
    }
    if(type==='raid'&&targets)config.targetList=targets.split(/[\n,]+/).map(function(s){return s.trim();}).filter(Boolean);var btn=document.getElementById('btn-submit-campaign');btn.disabled=true;btn.textContent='Creating…';try{var camp=await BardPlatform.createCampaign(currentProjectId,{title:title,type:type,rule:rule,reward:reward,unit:unit,pool:pool,days:days,accessMode:accessMode,raidMode:raidMode,rewardMode:rewardMode,postUrl:postUrl||null,targets:targets||null,bonusHandle:bonusHandle||null,config:config});
      var lockVault=document.getElementById('c-lock-vault')&&document.getElementById('c-lock-vault').checked;
      var lockAmt=parseFloat(pool||reward||'0');
      if(rewardMode==='growing'){
        var cap=parseFloat(document.getElementById('c-grow-cap').value);
        var st=parseFloat(document.getElementById('c-grow-start').value);
        lockAmt=(cap>0)?cap:(st||0);
      }
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
