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
function renderHome(){var list=document.getElementById('project-list');var totalCamps=0;state.projects.forEach(function(p){totalCamps+=activeCount(p);});document.getElementById('stat-projects').textContent=state.projects.length;document.getElementById('stat-campaigns').textContent=totalCamps;if(!state.projects.length){list.innerHTML='<div class="empty"><h3>No projects yet</h3><p>Onboard your first token to start running campaigns.</p><button class="btn btn--solid" id="empty-onboard">Onboard a project</button></div>';document.getElementById('empty-onboard').onclick=function(){show('onboard');};return;}list.innerHTML=state.projects.map(function(p){var n=(p.campaigns||[]).length;var a=activeCount(p);var feePill=p.feePaid?'<span class="pill pill--paid">Fee paid</span>':'<span class="pill pill--pending">Fee pending</span>';
    var vaultPill=p.vaultAddress?'<span class="pill pill--paid">Vault locked</span>':'';return'<div class="card card--hover" data-open-project="'+p.id+'"><div class="item" style="padding:0;border:none"><span class="item__ava">'+initials(p.ticker||p.name)+'</span><div class="item__body"><div class="item__title">'+escapeHtml(p.name)+' <span class="muted">· $'+escapeHtml(p.ticker)+'</span></div><div class="item__sub">'+escapeHtml(shortMint(p.mint))+' · '+n+' campaign'+(n===1?'':'s')+'</div></div><div class="item__right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">'+(a?'<span class="pill pill--live">'+a+' active</span>':'<span class="pill pill--draft">No live</span>')+vaultPill+feePill+'</div></div></div>';}).join('');list.querySelectorAll('[data-open-project]').forEach(function(el){el.addEventListener('click',function(){openProject(el.getAttribute('data-open-project'));});});}
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
  el.innerHTML=vaultBadgeHtml(p)+
    '<div class="card" style="margin-bottom:12px"><p class="kicker">How it works</p>'+
    '<p style="margin:0 0 12px;color:var(--body)">Phase 1 uses <b>Squads</b> — the same trust grammar as burned LP. 2-of-2: team key + Bard key. Routine flow: you deposit → campaign assigns a prize (reserved here) → Bard proposes payouts at settlement → you co-sign once.</p>'+
    '<ol class="vault-steps">'+
    '<li>Open <a href="https://app.squads.so/" target="_blank" rel="noopener" style="color:var(--purple)">app.squads.so</a> and create a multisig.</li>'+
    '<li>Add two members: <b>your connected wallet</b> and the Bard key below. Threshold: <b>2</b>.</li>'+
    '<li>Deposit $'+escapeHtml(p.ticker)+' into the Squads vault.</li>'+
    '<li>Paste the vault address (the account that holds the tokens) and save.</li>'+
    '</ol></div>'+
    '<div class="card" style="margin-bottom:12px"><div class="form">'+
    '<div class="field"><label>Bard member key (add this in Squads)</label><div class="copy-row"><input class="inp num" id="vault-bard-key" readonly value="'+escapeHtml(bard)+'"><button type="button" class="btn btn--ghost btn--sm" id="btn-copy-bard-key">Copy</button></div><span class="hint">Holders never send here. This is only the second signer of the 2-of-2.</span></div>'+
    '<div class="field"><label for="vault-addr">Squads vault address</label><input class="inp num" id="vault-addr" placeholder="Solana address that holds the tokens" value="'+escapeHtml(addr)+'"></div>'+
    '<div class="field"><label for="vault-mint">Token mint</label><input class="inp num" id="vault-mint" value="'+escapeHtml(mint)+'"><span class="hint">Defaults to this project mint.</span></div>'+
    '<button type="button" class="btn btn--solid" id="btn-save-vault">Save vault</button>'+
    '</div></div>'+
    '<div class="grid-2" id="vault-stats">'+
    '<div class="stat"><div class="stat__lbl">On-chain balance</div><div class="stat__val p num" id="vault-bal">…</div></div>'+
    '<div class="stat"><div class="stat__lbl">Reserved for campaigns</div><div class="stat__val num" id="vault-res">'+escapeHtml(fmtAmt(reserved))+'</div></div>'+
    '</div>'+
    '<p class="muted" style="margin:12px 0 0;font-size:.82rem" id="vault-bal-meta">Reading chain…</p>';
  document.getElementById('btn-copy-bard-key').onclick=function(){
    var v=document.getElementById('vault-bard-key').value;
    if(navigator.clipboard)navigator.clipboard.writeText(v).then(function(){toast('Bard key copied','ok');}).catch(function(){toast(v,'ok');});
    else toast(v,'ok');
  };
  document.getElementById('btn-save-vault').onclick=async function(){
    var a=document.getElementById('vault-addr').value.trim();
    var m=document.getElementById('vault-mint').value.trim()||p.mint;
    var btn=this;btn.disabled=true;btn.textContent='Saving…';
    try{
      await BardPlatform.updateProjectVault(p.id,{address:a,mint:m});
      await refreshState();
      toast(a?'Vault linked — holders can verify on Solscan':'Vault cleared','ok');
      var fresh=findProject(p.id);renderVaultPanel(fresh||p);
    }catch(e){console.error(e);toast((e&&e.message)||'Could not save vault','err');}
    finally{btn.disabled=false;btn.textContent='Save vault';}
  };
  if(addr && BardPlatform.fetchVaultOnchain){
    BardPlatform.fetchVaultOnchain(addr, mint).then(function(info){
      var avail=Math.max(0, Number(info.uiAmount||0)-reserved);
      document.getElementById('vault-bal').textContent=fmtAmt(info.uiAmount)+' $'+p.ticker;
      document.getElementById('vault-bal-meta').innerHTML='Source: '+escapeHtml(info.source||'rpc')+' · available ~ '+fmtAmt(avail)+' · <a href="'+escapeHtml(info.solscan)+'" target="_blank" rel="noopener" style="color:var(--purple)">Solscan</a>';
    }).catch(function(e){
      document.getElementById('vault-bal').textContent='—';
      document.getElementById('vault-bal-meta').textContent=(e&&e.message)||'Could not read on-chain balance';
    });
  } else {
    document.getElementById('vault-bal').textContent='—';
    document.getElementById('vault-bal-meta').textContent='Link a vault address to read the on-chain balance.';
  }
}
function renderProjectTabs(tab){var p=findProject(currentProjectId);if(!p)return;document.querySelectorAll('#page-project .tab').forEach(function(t){t.classList.toggle('is-on',t.getAttribute('data-tab')===tab);});var campsEl=document.getElementById('proj-campaigns');var setEl=document.getElementById('proj-settings');var vaultEl=document.getElementById('proj-vault');if(tab==='vault'){campsEl.style.display='none';setEl.style.display='none';vaultEl.style.display='block';renderVaultPanel(p);return;}if(tab==='settings'){campsEl.style.display='none';if(vaultEl)vaultEl.style.display='none';setEl.style.display='block';var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();var feeStatus=!feesOn?'<span class="pill pill--paid">waived (testing)</span>':(p.feePaid?'<span class="pill pill--paid">paid</span>':'<span class="pill pill--pending">pending</span>');setEl.innerHTML='<div class="card"><div class="form"><div class="field"><label>Name</label><div>'+escapeHtml(p.name)+'</div></div><div class="field"><label>Ticker</label><div>$'+escapeHtml(p.ticker)+'</div></div><div class="field"><label>Mint</label><div class="num" style="word-break:break-all">'+escapeHtml(p.mint)+'</div></div><div class="field"><label>Onboard fee</label><div>'+feeStatus+'</div></div><div class="field"><label>Data mode</label><div>'+escapeHtml(dataMode)+'</div></div></div></div>';return;}if(vaultEl)vaultEl.style.display='none';setEl.style.display='none';campsEl.style.display='block';var camps=p.campaigns||[];if(!camps.length){campsEl.innerHTML='<div class="empty"><h3>No campaigns yet</h3><p>Create a hold, raid, refer, or custom campaign for $'+escapeHtml(p.ticker)+'.</p><button class="btn btn--solid" id="empty-camp">New campaign</button></div>';document.getElementById('empty-camp').onclick=function(){resetCampaignBuilder();show('new-campaign');};return;}campsEl.innerHTML=camps.slice().reverse().map(function(c){var pill=c.status==='active'?'pill--live':(c.status==='ended'?'pill--ended':'pill--draft');var fee=c.feePaid?'<span class="pill pill--paid">fee paid</span>':'<span class="pill pill--pending">fee pending</span>';var sub=[c.type,(c.accessMode||c.access_mode)==='approval'?'approval':'open',c.rewardMode||c.reward_mode||'fixed',(c.rule||'').slice(0,48)].filter(Boolean).join(' · ');return'<div class="card card--hover" data-open-camp="'+c.id+'"><div class="item" style="padding:0;border:none"><div class="item__body"><div class="item__title">'+escapeHtml(c.title)+'</div><div class="item__sub">'+escapeHtml(sub)+((c.rule||'').length>48?'…':'')+'</div></div><div class="item__right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="pill '+pill+'">'+escapeHtml(c.status)+'</span>'+fee+'</div></div></div>';}).join('');campsEl.querySelectorAll('[data-open-camp]').forEach(function(el){el.addEventListener('click',function(){openCampaign(el.getAttribute('data-open-camp'));});});}
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
  var live=sets.filter(function(s){ return s.status!=='cancelled'; })[0];
  if(!live){
    var n=(joins||[]).filter(function(j){ return j.qualified || (j.status==='approved' && (j.progress||0)>0); }).length;
    box.innerHTML='<p class="muted" style="margin:0;font-size:.88rem">'+n+' holder'+(n===1?'':'s')+' ready to pay. Propose a batch — Bard fills amounts from this campaign’s reward model.</p>';
    return;
  }
  var rows=(live.payouts||[]).map(function(x,i){
    return '<tr><td class="num">'+(i+1)+'</td><td class="num">'+escapeHtml(shortAddr(x.wallet))+'</td><td class="num">'+escapeHtml(String(x.amount))+' '+(live.unit==='SOL'?'SOL':('$'+p.ticker))+'</td></tr>';
  }).join('');
  var st=live.status;
  var actions='';
  if(st==='proposed'){
    actions='<button class="btn btn--solid btn--sm" type="button" id="btn-cosign">Co-sign with wallet</button> '+
      '<a class="btn btn--ghost btn--sm" href="https://app.squads.so/" target="_blank" rel="noopener">Open Squads</a>';
  } else if(st==='cosigned'){
    actions='<div class="field" style="max-width:420px"><label for="settle-tx">Squads / on-chain tx signature</label>'+
      '<div class="copy-row"><input class="inp num" id="settle-tx" placeholder="Paste signature after you execute in Squads">'+
      '<button class="btn btn--solid btn--sm" type="button" id="btn-exec-settle">Mark paid</button></div>'+
      '<span class="hint">2-of-2: execute the payout batch in Squads, then paste the tx. Holders are marked settled.</span></div>';
  } else if(st==='executed'){
    actions='<span class="pill pill--paid">Paid</span> '+
      (live.tx_signature?'<a href="https://solscan.io/tx/'+encodeURIComponent(live.tx_signature)+'" target="_blank" rel="noopener" style="color:var(--purple);font-size:.86rem">View tx</a>':'');
  }
  box.innerHTML='<div class="item" style="padding:0 0 10px;border:none"><span class="pill '+(st==='executed'?'pill--paid':(st==='cosigned'?'pill--live':'pill--pending'))+'">'+escapeHtml(st)+'</span>'+
    '<span class="muted" style="font-size:.82rem">Total '+escapeHtml(String(live.total))+' · hash '+escapeHtml(live.payout_hash||'')+'</span></div>'+
    '<div style="overflow-x:auto"><table class="table"><thead><tr><th>#</th><th>Wallet</th><th>Amount</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div style="margin-top:12px">'+actions+'</div>';
  var cs=document.getElementById('btn-cosign');
  if(cs) cs.onclick=function(){ cosignCurrent(live); };
  var ex=document.getElementById('btn-exec-settle');
  if(ex) ex.onclick=function(){ executeCurrent(p,c,live); };
}
async function cosignCurrent(live){
  if(!wallet||!provider){ toast('Connect the team wallet first','err'); await connectWallet(); return; }
  var msg='BARD_SETTLE:'+live.id+':'+(live.payout_hash||'');
  var sig='';
  try{
    if(provider.signMessage){
      var enc=new TextEncoder().encode(msg);
      var out=await provider.signMessage(enc,'utf8');
      sig = (out && out.signature) ? (typeof out.signature==='string'?out.signature: Array.from(out.signature).slice(0,12).join(',')) : 'signed';
    } else {
      sig = 'wallet:'+wallet;
    }
    await BardPlatform.cosignSettlement(live.id, wallet, sig);
    toast('Co-signed. Execute the batch in Squads, then paste the tx.','ok');
    openCampaign(currentCampaignId);
  }catch(e){
    if(/rejected|denied|cancel/i.test(String(e&&e.message))) toast('Signature cancelled','err');
    else toast((e&&e.message)||'Co-sign failed','err');
  }
}
async function executeCurrent(p,c,live){
  var tx=(document.getElementById('settle-tx')||{}).value;
  tx=(tx||'').trim();
  if(!tx){ toast('Paste the Squads transaction signature','err'); return; }
  try{
    await BardPlatform.executeSettlement(live.id, tx, p.id);
    toast('Vault payout recorded. Holders marked settled.','ok');
    await refreshState();
    openCampaign(c.id);
  }catch(e){ toast((e&&e.message)||'Could not record payout','err'); }
}
function setChoiceGroup(selector,attr,value,hiddenId){document.querySelectorAll(selector).forEach(function(btn){btn.classList.toggle('is-on',btn.getAttribute(attr)===value);});if(hiddenId)document.getElementById(hiddenId).value=value;}
function syncCampaignBuilder(){var type=document.getElementById('c-type').value;var raidMode=document.getElementById('c-raid-mode').value;var rewardMode=document.getElementById('c-reward-mode').value;var access=document.getElementById('c-access').value;var days=document.getElementById('c-days').value||'7';document.getElementById('mod-raid').classList.toggle('is-on',type==='raid');document.getElementById('mod-hold').classList.toggle('is-on',type==='hold');document.getElementById('mod-post-url').classList.toggle('is-on',type==='raid'&&raidMode==='post');document.getElementById('mod-targets').classList.toggle('is-on',type==='raid'&&raidMode==='kol_list');document.getElementById('mod-top3').classList.toggle('is-on',rewardMode==='top3');document.getElementById('c-reward-label').textContent=({fixed:'Reward per claim',top3:'Pool for top 3',pool:'Total shared pool',growing:'Starting pool size',vested:'Total vested amount'})[rewardMode]||'Reward amount';document.getElementById('c-pool-label').textContent=rewardMode==='fixed'?'Max pool / budget':'Total pool size';var bits=[access==='approval'?'Approval required':'Open join',type];if(type==='raid')bits.push(({open:'open raid',post:'specific post',kol_list:'KOL targets'})[raidMode]||raidMode);bits.push(({fixed:'fixed',top3:'top 3',pool:'shared pool',growing:'growing',vested:'vested'})[rewardMode]||rewardMode);bits.push(days+' days');document.getElementById('camp-preview-text').textContent=bits.join(' · ');}
function resetCampaignBuilder(){document.getElementById('form-campaign').reset();document.getElementById('c-access').value='open';document.getElementById('c-raid-mode').value='open';document.getElementById('c-reward-mode').value='fixed';document.getElementById('c-days').value='7';setChoiceGroup('[data-access]','data-access','open','c-access');setChoiceGroup('[data-raid]','data-raid','open','c-raid-mode');setChoiceGroup('[data-reward]','data-reward','fixed','c-reward-mode');syncCampaignBuilder();}
document.querySelectorAll('[data-access]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-access]','data-access',btn.getAttribute('data-access'),'c-access');syncCampaignBuilder();});});
document.querySelectorAll('[data-raid]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-raid]','data-raid',btn.getAttribute('data-raid'),'c-raid-mode');syncCampaignBuilder();});});
document.querySelectorAll('[data-reward]').forEach(function(btn){btn.addEventListener('click',function(){setChoiceGroup('[data-reward]','data-reward',btn.getAttribute('data-reward'),'c-reward-mode');syncCampaignBuilder();});});
document.getElementById('c-type').addEventListener('change',syncCampaignBuilder);
document.getElementById('c-days').addEventListener('input',syncCampaignBuilder);
syncCampaignBuilder();
document.getElementById('btn-wallet').onclick=function(){if(wallet){if(confirm('Disconnect wallet?'))disconnectWallet();}else connectWallet();};
document.getElementById('btn-new-project').onclick=function(){show('onboard');};
document.getElementById('btn-new-campaign').onclick=function(){if(!findProject(currentProjectId)){toast('Open a project first','err');return;}resetCampaignBuilder();show('new-campaign');};
document.querySelectorAll('[data-go]').forEach(function(btn){btn.addEventListener('click',function(){var go=btn.getAttribute('data-go');if(go==='home'){renderHome();show('home');}else show(go);});});
document.getElementById('back-from-campaign').onclick=function(){openProject(currentProjectId);};
document.getElementById('back-from-detail').onclick=function(){openProject(currentProjectId);};
document.querySelectorAll('#page-project .tab').forEach(function(t){t.addEventListener('click',function(){renderProjectTabs(t.getAttribute('data-tab'));});});
document.getElementById('form-onboard').addEventListener('submit',async function(e){e.preventDefault();var name=document.getElementById('p-name').value.trim();var ticker=document.getElementById('p-ticker').value.trim().replace(/^\$/,'').toUpperCase();var mint=document.getElementById('p-mint').value.trim();if(!name||!ticker||!mint){toast('Fill in name, ticker, and mint','err');return;}var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();if(feesOn&&(!wallet||!provider)){toast('Connect a wallet first','err');await connectWallet();return;}var btn=document.getElementById('btn-submit-onboard');btn.disabled=true;btn.textContent='Creating…';try{var project=await BardPlatform.createProject({name:name,ticker:ticker,mint:mint,admin:wallet||null});if(feesOn&&wallet&&provider){btn.textContent='Confirm 0.25 SOL in wallet…';var result=await BardPlatform.payFee('onboard',wallet,provider,{projectId:project.id});await refreshState();toast(result.ok?'Project created · fee paid':'Project created · fee pending','ok');}else{await refreshState();toast('Project created','ok');}document.getElementById('form-onboard').reset();openProject(project.id);}catch(err){console.error(err);toast((err&&err.message)||'Failed to create project','err');}finally{btn.disabled=false;btn.textContent=feesOn?'Create project & pay 0.25 SOL':'Create project';}});
document.getElementById('form-campaign').addEventListener('submit',async function(e){e.preventDefault();var p=findProject(currentProjectId);if(!p)return;var title=document.getElementById('c-title').value.trim();var type=document.getElementById('c-type').value;var rule=document.getElementById('c-rule').value.trim();var reward=document.getElementById('c-reward').value.trim();var unit=document.getElementById('c-unit').value;var pool=document.getElementById('c-pool').value.trim();var days=parseInt(document.getElementById('c-days').value,10)||7;var accessMode=document.getElementById('c-access').value||'open';var rewardMode=document.getElementById('c-reward-mode').value||'fixed';var raidMode=type==='raid'?(document.getElementById('c-raid-mode').value||'open'):null;var postUrl=document.getElementById('c-post-url').value.trim();var targets=document.getElementById('c-targets').value.trim();var bonusHandle=document.getElementById('c-bonus').value.trim().replace(/^@/,'');if(bonusHandle)bonusHandle='@'+bonusHandle;var minBal=document.getElementById('c-min-bal').value.trim();var holdDays=document.getElementById('c-hold-days').value.trim();var top3=document.getElementById('c-top3').value.trim();if(!title||!rule){toast('Add a name and rule','err');return;}if(type==='raid'&&raidMode==='post'&&!postUrl){toast('Add the target post URL','err');return;}if(type==='raid'&&raidMode==='kol_list'&&!targets){toast('Add at least one target','err');return;}var feesOn=BardPlatform.feesEnabled&&BardPlatform.feesEnabled();if(feesOn&&!p.feePaid){toast('Pay onboard fee in Settings first','err');show('project');renderProjectTabs('settings');return;}if(feesOn&&(!wallet||!provider)){toast('Connect a wallet first','err');await connectWallet();return;}var config={};if(type==='hold'){if(minBal)config.minBalance=minBal;if(holdDays)config.holdDays=parseInt(holdDays,10)||null;}if(rewardMode==='top3')config.top3Split=top3||'50 / 30 / 20';if(type==='raid'&&targets)config.targetList=targets.split(/[\n,]+/).map(function(s){return s.trim();}).filter(Boolean);var btn=document.getElementById('btn-submit-campaign');btn.disabled=true;btn.textContent='Creating…';try{var camp=await BardPlatform.createCampaign(currentProjectId,{title:title,type:type,rule:rule,reward:reward,unit:unit,pool:pool,days:days,accessMode:accessMode,raidMode:raidMode,rewardMode:rewardMode,postUrl:postUrl||null,targets:targets||null,bonusHandle:bonusHandle||null,config:config});
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
    await BardPlatform.proposeSettlement(p.id,c.id,c,joins);
    toast('Payout proposed — review and co-sign','ok');
    openCampaign(c.id);
  }catch(e){ toast((e&&e.message)||'Could not propose payout','err'); }
  finally{ btn.disabled=false; btn.textContent='Propose payout'; }
};
(async function(){try{await refreshState();}catch(e){console.error(e);}var saved=localStorage.getItem('bard_team_wallet');if(saved){try{var p=(window.phantom&&window.phantom.solana)||window.solflare||window.solana;if(p&&p.isConnected){wallet=(p.publicKey&&p.publicKey.toString())||saved;provider=p;}else if(saved)wallet=saved;}catch(e){}}updateWalletUI();renderHome();})();
})();
