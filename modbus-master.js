// ─── State ───────────────────────────────────────────
var port=null,writer=null,connected=false,currentFC=1,pollingTimer=null,isPolling=false;
var logEntries=0,lastResponse=null,registerTypes={},activeProfile=null,pendingMultiWrites=null;
var writePickerEntries=[];

var DATA_TYPES={int8:{label:'8-bit INT',regSpan:1},int16:{label:'16-bit INT',regSpan:1},int32:{label:'32-bit INT',regSpan:2},uint8:{label:'8-bit UINT',regSpan:1},uint16:{label:'16-bit UINT',regSpan:1},uint32:{label:'32-bit UINT',regSpan:2},uint64:{label:'64-bit UINT',regSpan:4},float32:{label:'32-bit Float',regSpan:2},float64:{label:'64-bit Float',regSpan:4},string4:{label:'String4',regSpan:2},string6:{label:'String6',regSpan:3},string8:{label:'String8',regSpan:4},string12:{label:'String12',regSpan:6},string16:{label:'String16',regSpan:8}};
var FC_TO_ENTRY={1:'coil',2:'discrete',3:'holding',4:'input',5:'coil',6:'holding',15:'coil',16:'holding'};
var fcNames={1:'Read Coils',2:'Read Discrete Inputs',3:'Read Holding Registers',4:'Read Input Registers',5:'Write Single Coil',6:'Write Single Register',15:'Write Multiple Coils',16:'Write Multiple Registers'};
var writeFCs=[5,6,15,16];
var FC_BASE_ADDR={1:1,2:10001,3:40001,4:30001,5:1,6:40001,15:1,16:40001};

function $(id){return document.getElementById(id)}

// ─── Byte Reorder & Decode ───────────────────────────
function getByteOrder(){return $('byteOrder').value}
function reorderBytes(regs,bo){var b=[];for(var r=0;r<regs.length;r++)b.push((regs[r]>>8)&0xFF,regs[r]&0xFF);if(bo==='AB')return b;if(bo==='BA'){var o=[];for(var i=0;i<b.length;i+=2)o.push(b[i+1],b[i]);return o}if(bo==='CDAB'){var o2=[].concat(b);for(var i2=0;i2+3<o2.length;i2+=4){var t0=o2[i2],t1=o2[i2+1];o2[i2]=o2[i2+2];o2[i2+1]=o2[i2+3];o2[i2+2]=t0;o2[i2+3]=t1}return o2}if(bo==='DCBA'){var o3=[].concat(b);for(var i3=0;i3+3<o3.length;i3+=4){var a=o3[i3],b2=o3[i3+1],c=o3[i3+2],d=o3[i3+3];o3[i3]=d;o3[i3+1]=c;o3[i3+2]=b2;o3[i3+3]=a}return o3}return b}
function decodeValue(type,regs,bo){var def=DATA_TYPES[type];if(!def||regs.length<def.regSpan)return'N/A';var bytes=reorderBytes(regs.slice(0,def.regSpan),bo);var buf=new ArrayBuffer(Math.max(bytes.length,8));var v=new DataView(buf);for(var i=0;i<bytes.length;i++)v.setUint8(i,bytes[i]);switch(type){case'int8':return v.getInt8(0)+'';case'int16':return v.getInt16(0)+'';case'int32':return v.getInt32(0)+'';case'uint8':return v.getUint8(0)+'';case'uint16':return v.getUint16(0)+'';case'uint32':return v.getUint32(0)+'';case'uint64':return((BigInt(v.getUint32(0))<<32n)|BigInt(v.getUint32(4)))+'';case'float32':{var f=v.getFloat32(0);return(isNaN(f)||!isFinite(f))?'NaN/Inf':f.toPrecision(7)}case'float64':{var f2=v.getFloat64(0);return(isNaN(f2)||!isFinite(f2))?'NaN/Inf':f2.toPrecision(10)}default:if(type.indexOf('string')===0){var s='';for(var j=0;j<bytes.length;j++)s+=(bytes[j]>=32&&bytes[j]<=126)?String.fromCharCode(bytes[j]):(bytes[j]===0?'':'\u00B7');return'"'+s+'"'}return'?'}}

// ─── CRC16 ───────────────────────────────────────────
function crc16(buf){var c=0xFFFF;for(var i=0;i<buf.length;i++){c^=buf[i];for(var j=0;j<8;j++)c=(c&1)?(c>>1)^0xA001:c>>1}return c}
function appendCRC(f){var c=crc16(f),o=new Uint8Array(f.length+2);o.set(f);o[f.length]=c&0xFF;o[f.length+1]=(c>>8)&0xFF;return o}
function verifyCRC(d){if(d.length<4)return false;return crc16(d.slice(0,d.length-2))===(d[d.length-2]|(d[d.length-1]<<8))}

// ─── Offset ──────────────────────────────────────────
function getWireAddress(a){if(!$('minusOffsetEnabled').checked)return a;return Math.max(0,Math.min(65535,a-(parseInt($('minusOffset').value)||0)))}
function updateOffsetUI(){var en=$('minusOffsetEnabled').checked,o=parseInt($('minusOffset').value)||0,ind=$('offsetIndicator');if(en&&o){ind.classList.add('visible');$('offsetDisplay').textContent='\u2212'+o}else ind.classList.remove('visible');updateWirePreview()}
function updateWirePreview(){var en=$('minusOffsetEnabled').checked,p=$('wireAddrPreview');if(!en){p.classList.remove('visible');return}var a=parseInt($('startAddr').value)||0,w=getWireAddress(a);p.classList.add('visible');p.innerHTML='Display: <b>'+a+'</b> \u2192 Wire: <b>'+w+'</b> (0x'+w.toString(16).toUpperCase().padStart(4,'0')+')'}

// ─── Frame Builders ──────────────────────────────────
function mkFrame(s,fc,w,q){var f=new Uint8Array(6);f[0]=s;f[1]=fc;f[2]=(w>>8)&0xFF;f[3]=w&0xFF;f[4]=(q>>8)&0xFF;f[5]=q&0xFF;return appendCRC(f)}
function mkWCoil(s,w,v){var f=new Uint8Array(6);f[0]=s;f[1]=5;f[2]=(w>>8)&0xFF;f[3]=w&0xFF;f[4]=v?0xFF:0;f[5]=0;return appendCRC(f)}
function mkWReg(s,w,v){var f=new Uint8Array(6);f[0]=s;f[1]=6;f[2]=(w>>8)&0xFF;f[3]=w&0xFF;f[4]=(v>>8)&0xFF;f[5]=v&0xFF;return appendCRC(f)}
function mkWCoils(s,w,vs){var q=vs.length,bc=Math.ceil(q/8),f=new Uint8Array(7+bc);f[0]=s;f[1]=15;f[2]=(w>>8)&0xFF;f[3]=w&0xFF;f[4]=(q>>8)&0xFF;f[5]=q&0xFF;f[6]=bc;for(var i=0;i<q;i++)if(vs[i])f[7+(i>>3)]|=1<<(i&7);return appendCRC(f)}
function mkWRegs(s,w,vs){var q=vs.length,f=new Uint8Array(7+q*2);f[0]=s;f[1]=16;f[2]=(w>>8)&0xFF;f[3]=w&0xFF;f[4]=(q>>8)&0xFF;f[5]=q&0xFF;f[6]=q*2;for(var i=0;i<q;i++){f[7+i*2]=(vs[i]>>8)&0xFF;f[8+i*2]=vs[i]&0xFF}return appendCRC(f)}

// ─── Serial ──────────────────────────────────────────
function toggleConnection(){if(connected)return;if(!('serial' in navigator)){addLog('err','Web Serial not supported.');return}navigator.serial.requestPort().then(function(p){port=p;var br=+$('baudRate').value,db=+$('dataBits').value,sb=+$('stopBits').value,pa=$('parity').value;return port.open({baudRate:br,dataBits:db,stopBits:sb,parity:pa}).then(function(){writer=port.writable.getWriter();connected=true;updateConnUI(true);addLog('tx','Connected @ '+br+' '+db+pa[0].toUpperCase()+sb)})}).catch(function(e){addLog('err','Connect fail: '+e.message)})}
function disconnect(){try{if(isPolling)stopPolling();if(writer){writer.releaseLock();writer=null}if(port){port.close().catch(function(){});port=null}connected=false;updateConnUI(false);addLog('err','Disconnected')}catch(e){addLog('err','Disconnect err: '+e.message);connected=false;updateConnUI(false)}}
function updateConnUI(c){$('statusDot').classList.toggle('connected',c);$('statusText').textContent=c?'Connected':'Disconnected';$('btnConnect').style.display=c?'none':'flex';$('btnDisconnect').style.display=c?'flex':'none'}
function readResp(expMin){return new Promise(function(resolve){var to=+$('timeout').value||1000,buf=[],rd=port.readable.getReader(),done=false;var tm=setTimeout(function(){done=true},to);function read(){if(done){clearTimeout(tm);rd.releaseLock();resolve(new Uint8Array(buf));return}Promise.race([rd.read(),new Promise(function(r){setTimeout(function(){r({value:null,done:true})},to)})]).then(function(result){if(result.done||!result.value){clearTimeout(tm);rd.releaseLock();resolve(new Uint8Array(buf));return}buf.push.apply(buf,result.value);if(buf.length>=expMin){setTimeout(function(){Promise.race([rd.read(),new Promise(function(r){setTimeout(function(){r({value:null,done:true})},80)})]).then(function(r2){if(r2.value)buf.push.apply(buf,r2.value);clearTimeout(tm);rd.releaseLock();resolve(new Uint8Array(buf))})},50)}else read()})}read()})}

// ─── Sections ────────────────────────────────────────
function toggleSection(id){$(id).classList.toggle('collapsed')}

// ─── Profile System ──────────────────────────────────
function getProfileLabel(fc,addr){if(!activeProfile)return null;var et=FC_TO_ENTRY[fc];var e=activeProfile.entries.find(function(x){return x.type===et&&x.address===addr});return e?e.label:null}
function getProfileDataType(fc,addr){if(!activeProfile)return null;var et=FC_TO_ENTRY[fc];var e=activeProfile.entries.find(function(x){return x.type===et&&x.address===addr});return(e&&e.dataType&&e.dataType!=='default')?e.dataType:null}
function applyProfileTypes(rc,dsa,fc){for(var i=0;i<rc;i++){var pt=getProfileDataType(fc,dsa+i);if(pt)registerTypes[i]=pt;else if(!registerTypes[i])registerTypes[i]='uint16'}}

function addProfileEntry(type,address,label,dataType){
  var list=$('profileEntryList'),div=document.createElement('div');
  div.className='profile-entry';
  var tOpts=['coil','discrete','holding','input'].map(function(t){return'<option value="'+t+'"'+(t===(type||'holding')?' selected':'')+'>'+t[0].toUpperCase()+t.slice(1)+'</option>'}).join('');
  var dOpts='<option value="default">Default</option>'+Object.entries(DATA_TYPES).map(function(kv){return'<option value="'+kv[0]+'"'+(kv[0]===dataType?' selected':'')+'>'+kv[1].label+'</option>'}).join('');
  div.innerHTML='<select>'+tOpts+'</select><input type="number" value="'+(address||0)+'" min="0" max="65535"><input type="text" value="'+esc(label||'')+'" placeholder="Label..." style="font-family:Outfit,sans-serif"><select>'+dOpts+'</select><button class="pe-del">\u2715</button>';
  list.appendChild(div);
}
function collectEntries(){var entries=[];document.querySelectorAll('#profileEntryList .profile-entry').forEach(function(r){var s=r.querySelectorAll('select'),inp=r.querySelectorAll('input');entries.push({type:s[0].value,address:+inp[0].value||0,label:inp[1].value.trim(),dataType:s[1].value})});return entries}
function loadIntoEditor(p){$('profileName').value=p.name||'';$('profileSlaveId').value=p.slaveId||1;$('profileEntryList').innerHTML='';(p.entries||[]).forEach(function(e){addProfileEntry(e.type,e.address,e.label,e.dataType)})}
function activateProfile(p){activeProfile=JSON.parse(JSON.stringify(p));$('profileBadge').classList.add('visible');$('profileBadgeName').textContent=p.name||'Unnamed';$('profileBtn').classList.add('profile-active');if(p.slaveId)$('slaveId').value=p.slaveId;resetResponseArea();applyProfileToFC(currentFC)}
function clearActiveProfile(){activeProfile=null;$('profileBadge').classList.remove('visible');$('profileBtn').classList.remove('profile-active');resetResponseArea();$('profileFcInfo').style.display='none'}
function saveCurrentProfile(){var name=$('profileName').value.trim();if(!name){alert('Enter a profile name.');return}var p={name:name,slaveId:+$('profileSlaveId').value||1,entries:collectEntries(),savedAt:new Date().toISOString()};var saved=JSON.parse(localStorage.getItem('modbusProfiles')||'[]');var idx=saved.findIndex(function(x){return x.name===name});if(idx>=0)saved[idx]=p;else saved.push(p);localStorage.setItem('modbusProfiles',JSON.stringify(saved));activateProfile(p);renderSaved();addLog('tx','Profile "'+name+'" saved ('+p.entries.length+' entries, Slave '+p.slaveId+')')}
function exportProfile(){var name=$('profileName').value.trim()||'modbus-profile';var p={name:name,slaveId:+$('profileSlaveId').value||1,entries:collectEntries()};var b=new Blob([JSON.stringify(p,null,2)],{type:'application/json'});var u=URL.createObjectURL(b);var a=document.createElement('a');a.href=u;a.download=name.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json';a.click();URL.revokeObjectURL(u)}
function importProfile(ev){var file=ev.target.files[0];if(!file)return;var r=new FileReader();r.onload=function(e){try{var p=JSON.parse(e.target.result);if(!Array.isArray(p.entries))throw new Error('Invalid format');loadIntoEditor(p);activateProfile(p);addLog('tx','Imported "'+p.name+'" ('+p.entries.length+' entries)')}catch(err){alert('Import failed: '+err.message)}};r.readAsText(file);ev.target.value=''}
function renderSaved(){var saved=JSON.parse(localStorage.getItem('modbusProfiles')||'[]'),list=$('savedProfilesList');if(!saved.length){list.innerHTML='<div class="no-profiles">No saved profiles yet.</div>';return}list.innerHTML=saved.map(function(p,i){return'<div class="saved-profile-item"><div><div class="sp-name">'+esc(p.name)+'</div><div class="sp-info">'+p.entries.length+' entries \u00B7 Slave '+(p.slaveId||1)+(p.savedAt?' \u00B7 '+new Date(p.savedAt).toLocaleDateString():'')+'</div></div><div class="sp-actions"><button class="sp-load" data-idx="'+i+'">Load</button><button class="sp-del" data-idx="'+i+'">\u2715</button></div></div>'}).join('')}
function loadSaved(i){var s=JSON.parse(localStorage.getItem('modbusProfiles')||'[]');if(s[i]){loadIntoEditor(s[i]);activateProfile(s[i])}}
function delSaved(i){var s=JSON.parse(localStorage.getItem('modbusProfiles')||'[]');if(s[i]&&confirm('Delete "'+s[i].name+'"?')){if(activeProfile&&activeProfile.name===s[i].name)clearActiveProfile();s.splice(i,1);localStorage.setItem('modbusProfiles',JSON.stringify(s));renderSaved()}}
function openProfile(){$('profileModal').classList.add('visible');renderSaved()}
function closeProfile(){$('profileModal').classList.remove('visible')}
function openAbout(){$('aboutModal').classList.add('visible')}
function closeAbout(){$('aboutModal').classList.remove('visible')}

// ─── Dtype Grid ──────────────────────────────────────
function buildDtypeGrid(rc,dsa){var grid=$('dtypeGrid');$('sectionDtype').style.display='block';grid.innerHTML='';var opts=Object.entries(DATA_TYPES).map(function(kv){return'<option value="'+kv[0]+'">'+kv[1].label+'</option>'}).join('');for(var i=0;i<rc;i++){if(!registerTypes[i])registerTypes[i]='uint16';var d=document.createElement('div');d.className='dtype-item';d.innerHTML='<span class="dtype-addr">'+(dsa+i)+'</span><select data-reg="'+i+'">'+opts+'</select>';d.querySelector('select').value=registerTypes[i];grid.appendChild(d)}}
function copyFirstToAll(){var f=registerTypes[0]||'uint16',rc=lastResponse&&lastResponse.regValues?lastResponse.regValues.length:0;for(var i=0;i<rc;i++)registerTypes[i]=f;document.querySelectorAll('#dtypeGrid select').forEach(function(s){s.value=f});reRender()}
function reRender(){if(lastResponse&&(lastResponse.fc===3||lastResponse.fc===4))displayResponse(lastResponse.fc,lastResponse.data,lastResponse.displayStartAddr,lastResponse.quantity,lastResponse.elapsed)}

// ─── Error/Reset ─────────────────────────────────────
function showError(t,d){$('emptyState').style.display='none';$('responseTable').style.display='none';$('errorState').style.display='flex';$('errorTitle').textContent=t;$('errorDetail').textContent=d||'';$('sectionDtype').style.display='none';$('sectionRaw').style.display='none'}
function clearError(){$('errorState').style.display='none'}
function resetResponseArea(){$('responseTable').style.display='none';$('tableHead').innerHTML='';$('tableBody').innerHTML='';$('errorState').style.display='none';$('emptyState').style.display='flex';$('responseMeta').style.display='none';$('sectionDtype').style.display='none';$('sectionRaw').style.display='none';lastResponse=null;registerTypes={}}

// ─── Profile Auto-Config ─────────────────────────────
function applyProfileToFC(fc){
  var mw=$('writeManualWrap'),pw=$('writePickerWrap'),info=$('profileFcInfo');
  var entryTypeLabels={coil:'coils',discrete:'discrete inputs',holding:'holding registers',input:'input registers'};
  if(!activeProfile){pw.style.display='none';mw.style.display='block';info.style.display='none';$('writeGroupTitle').textContent='Write Value(s)';return}
  var et=FC_TO_ENTRY[fc];
  if(!et){pw.style.display='none';mw.style.display='block';info.style.display='none';$('writeGroupTitle').textContent='Write Value(s)';return}
  var entries=activeProfile.entries.filter(function(e){return e.type===et});
  if(!entries.length){
    pw.style.display='none';mw.style.display='block';$('writeGroupTitle').textContent='Write Value(s)';
    var typeName=entryTypeLabels[et]||et;
    info.style.display='block';
    info.innerHTML='<strong style="color:var(--accent-pink)">'+esc(activeProfile.name)+'</strong> has no '+typeName+' defined. You can still query manually using the address fields, or <a href="#" id="linkEditProfile" style="color:var(--accent-pink);text-decoration:underline">edit the profile</a> to add entries.';
    var link=$('linkEditProfile');
    if(link)link.addEventListener('click',function(ev){ev.preventDefault();openProfile()});
    return;
  }
  info.style.display='none';
  var addrs=entries.map(function(e){return e.address}).sort(function(a,b){return a-b});
  var baseAddr=FC_BASE_ADDR[fc]||0,startAddr=addrs[0],maxEnd=0;
  for(var i=0;i<entries.length;i++){var dt=entries[i].dataType&&entries[i].dataType!=='default'?entries[i].dataType:'uint16';var span=DATA_TYPES[dt]?DATA_TYPES[dt].regSpan:1;if(entries[i].address+span>maxEnd)maxEnd=entries[i].address+span}
  var qty=Math.max(1,maxEnd-startAddr);
  $('startAddr').value=startAddr;$('quantity').value=Math.min(qty,fc<=2?2000:125);
  $('minusOffsetEnabled').checked=true;$('minusOffset').value=baseAddr;updateOffsetUI();
  if(writeFCs.indexOf(fc)>=0){buildWritePicker(fc,entries);mw.style.display='none';$('writeGroupTitle').textContent='Write \u2014 '+activeProfile.name}
  else{pw.style.display='none';mw.style.display='block'}
}

// ─── Write Picker ────────────────────────────────────
function buildWritePicker(fc,entries){
  var wrap=$('writePickerWrap'),picker=$('writePicker');
  picker.innerHTML='';writePickerEntries=[];
  if(!entries.length){wrap.style.display='none';return}
  wrap.style.display='block';
  var isSingle=(fc===5||fc===6),isCoil=(fc===5||fc===15);
  var hint=$('writePickerHint');
  if(isSingle)hint.textContent=isCoil?'Click a coil to select it, set ON/OFF, then Send Update:':'Click a register to select it, enter a value, then Send Update:';
  else hint.textContent=isCoil?'Click coils to select (multiple), set ON/OFF, then Send Update:':'Click registers to select (multiple), enter values, then Send Update:';
  entries.sort(function(a,b){return a.address-b.address}).forEach(function(e,idx){
    var div=document.createElement('div');div.className='wp-item';div.dataset.idx=idx;
    var tl=e.dataType&&e.dataType!=='default'&&DATA_TYPES[e.dataType]?DATA_TYPES[e.dataType].label:(isCoil?'Coil':'UINT16');
    var valHtml;
    if(isCoil)valHtml='<div class="wp-val"><select data-wpval="'+idx+'"><option value="0">OFF (0)</option><option value="1">ON (1)</option></select></div>';
    else valHtml='<div class="wp-val"><input type="text" data-wpval="'+idx+'" placeholder="Value"></div>';
    div.innerHTML='<span class="wp-addr">'+e.address+'</span><span class="wp-label">'+esc(e.label||'\u2014')+'</span><span class="wp-type">'+tl+'</span>'+valHtml;
    if(isSingle){
      div.addEventListener('click',function(ev){
        if(ev.target.tagName==='INPUT'||ev.target.tagName==='SELECT')return;
        document.querySelectorAll('#writePicker .wp-item').forEach(function(d){d.classList.remove('selected')});
        div.classList.add('selected');$('startAddr').value=e.address;$('quantity').value=1;updateOffsetUI();
        if(isCoil){var sel=div.querySelector('select');$('writeValue').value=sel?sel.value:'0'}
        else{var inp=div.querySelector('input');$('writeValue').value=inp?inp.value:'0'}
      });
    }else{
      div.addEventListener('click',function(ev){
        if(ev.target.tagName==='INPUT'||ev.target.tagName==='SELECT')return;
        div.classList.toggle('selected');updateMultiWriteFromPicker(fc);
      });
    }
    picker.appendChild(div);writePickerEntries.push(e);
  });
  if(isSingle&&picker.firstChild){picker.firstChild.classList.add('selected');$('startAddr').value=entries[0].address;$('quantity').value=1;updateOffsetUI()}
  if(fc===5)picker.querySelectorAll('select[data-wpval]').forEach(function(sel){sel.addEventListener('change',function(){var item=this.closest('.wp-item');if(item&&item.classList.contains('selected'))$('writeValue').value=this.value})});
  if(fc===6)picker.querySelectorAll('input[data-wpval]').forEach(function(inp){inp.addEventListener('input',function(){var item=this.closest('.wp-item');if(item&&item.classList.contains('selected'))$('writeValue').value=this.value})});
  if(fc===15||fc===16)picker.querySelectorAll('[data-wpval]').forEach(function(el){el.addEventListener('change',function(){updateMultiWriteFromPicker(fc)});el.addEventListener('input',function(){updateMultiWriteFromPicker(fc)})});
}

function updateMultiWriteFromPicker(fc){
  var items=document.querySelectorAll('#writePicker .wp-item.selected');
  if(!items.length){$('writeValue').value='';pendingMultiWrites=null;return}
  var selected=[];
  items.forEach(function(item){var idx=+item.dataset.idx;var e=writePickerEntries[idx];var valEl=item.querySelector('[data-wpval]');selected.push({address:e.address,val:valEl?valEl.value:'0',label:e.label||''})});
  selected.sort(function(a,b){return a.address-b.address});
  var contiguous=true;
  for(var i=1;i<selected.length;i++){if(selected[i].address!==selected[i-1].address+1){contiguous=false;break}}
  if(selected.length===1){$('startAddr').value=selected[0].address;$('quantity').value=1;$('writeValue').value=selected[0].val;pendingMultiWrites=null}
  else if(contiguous){$('startAddr').value=selected[0].address;$('quantity').value=selected.length;$('writeValue').value=selected.map(function(s){return s.val||'0'}).join(', ');pendingMultiWrites=null}
  else{$('startAddr').value=selected[0].address;$('quantity').value=selected.length;$('writeValue').value=selected.map(function(s){return s.val||'0'}).join(', ');pendingMultiWrites=selected}
  updateOffsetUI();
}

// ─── FC ──────────────────────────────────────────────
function setFC(fc,tabEl){
  currentFC=fc;pendingMultiWrites=null;resetResponseArea();
  document.querySelectorAll('.fc-tab').forEach(function(t){t.classList.remove('active')});
  tabEl.classList.add('active');
  $('fcName').textContent=fcNames[fc];
  var b=$('fcBadge');b.textContent='FC '+String(fc).padStart(2,'0');
  b.className=writeFCs.indexOf(fc)>=0?'fc-badge write':'fc-badge';
  if(writeFCs.indexOf(fc)>=0&&isPolling)stopPolling();
  $('sendBtnText').textContent=writeFCs.indexOf(fc)>=0?'Send Update':'Send Query';
  var wg=$('writeGroup'),wl=$('writeLabel'),wh=$('writeHint'),wv=$('writeValue');
  var mw=$('writeManualWrap'),pw=$('writePickerWrap');
  if(writeFCs.indexOf(fc)>=0){
    wg.style.display='block';
    if(fc===5){wl.textContent='Coil Value';wv.placeholder='1 or 0';wh.textContent='1/true/on for ON, 0/false/off for OFF.'}
    else if(fc===6){wl.textContent='Register Value (0-65535)';wv.placeholder='e.g. 1234';wh.textContent='Single 16-bit unsigned integer.'}
    else if(fc===15){wl.textContent='Coil Values';wv.placeholder='1,0,1,1,0,1';wh.textContent='Comma/space separated 1/0.'}
    else if(fc===16){wl.textContent='Register Values';wv.placeholder='100,200,300';wh.textContent='Comma/space separated integers.'}
    mw.style.display='block';pw.style.display='none';
  }else wg.style.display='none';
  applyProfileToFC(fc);
}

// ─── Send Query ──────────────────────────────────────
function sendQuery(){
  if(!connected){addLog('err','Not connected.');return}
  var sid=+$('slaveId').value,dsa=+$('startAddr').value,wa=getWireAddress(dsa),qty=+$('quantity').value,fc=currentFC;
  if(pendingMultiWrites&&(fc===16||fc===15)){
    var isCoil=(fc===15);
    addLog('tx','[Multi-write] Sending '+pendingMultiWrites.length+' individual '+(isCoil?'coil':'register')+' writes...');
    var allOk=true,chain=Promise.resolve();
    pendingMultiWrites.forEach(function(item){
      chain=chain.then(function(){
        var itemWa=getWireAddress(item.address);var frame,expMin=8;
        if(isCoil){var cv=item.val==='1'||item.val.toLowerCase()==='true'||item.val==='on';frame=mkWCoil(sid,itemWa,cv)}
        else{var rv=parseInt(item.val);if(isNaN(rv)||rv<0||rv>65535){addLog('err','Invalid value for '+item.address+' ('+(item.label||'')+')');allOk=false;return}frame=mkWReg(sid,itemWa,rv)}
        var lbl=item.label?' ('+item.label+')':'';
        addLog('tx','  Write '+item.address+lbl+' = '+item.val+' \u2192 '+hex(frame));
        return writer.write(frame).then(function(){return readResp(expMin)}).then(function(resp){
          var el='';if(!resp.length){addLog('err','  Timeout on '+item.address+lbl);allOk=false;return}
          addLog('rx','  '+hex(resp));
          if(!verifyCRC(resp)){addLog('err','  CRC failed on '+item.address+lbl);allOk=false;return}
          if(resp[1]&0x80){var ec=resp[2],en={1:'Illegal Function',2:'Illegal Data Address',3:'Illegal Data Value',4:'Slave Device Failure'};addLog('err','  Exception on '+item.address+lbl+': '+(en[ec]||'Unknown'));allOk=false}
        });
      });
    });
    chain.then(function(){if(allOk){clearError();addLog('tx','[Multi-write] All writes completed.')}else showError('Partial Write','Some writes failed. Check log.')});
    return;
  }
  var frame,expMin;
  if(fc<=2){frame=mkFrame(sid,fc,wa,qty);expMin=5+Math.ceil(qty/8)}
  else if(fc<=4){frame=mkFrame(sid,fc,wa,qty);expMin=5+qty*2}
  else if(fc===5){var v=$('writeValue').value.trim();frame=mkWCoil(sid,wa,v==='1'||v.toLowerCase()==='true'||v==='on');expMin=8}
  else if(fc===6){var v2=+$('writeValue').value.trim();if(isNaN(v2)||v2<0||v2>65535){showError('Invalid Value','0\u201365535');return}frame=mkWReg(sid,wa,v2);expMin=8}
  else if(fc===15){var vs=$('writeValue').value.trim().split(/[\s,]+/).map(function(x){return x==='1'||x.toLowerCase()==='true'});frame=mkWCoils(sid,wa,vs);expMin=8}
  else if(fc===16){var vs2=$('writeValue').value.trim().split(/[\s,]+/).map(Number);if(vs2.some(isNaN)){showError('Invalid','All must be integers');return}frame=mkWRegs(sid,wa,vs2);expMin=8}
  var oe=$('minusOffsetEnabled').checked,ai=oe&&wa!==dsa?'Addr='+dsa+'\u2192Wire='+wa:'Addr='+wa;
  addLog('tx','['+fcNames[fc]+'] Slave='+sid+' '+ai+' Qty='+qty+' \u2192 '+hex(frame));
  var t0=performance.now();
  writer.write(frame).then(function(){return readResp(expMin)}).then(function(resp){
    var el=(performance.now()-t0).toFixed(1);
    if(!resp.length){addLog('err','Timeout');showError('Timeout','No response from slave.');return}
    addLog('rx',hex(resp)+' ('+el+'ms, '+resp.length+'b)');
    if(!verifyCRC(resp)){addLog('err','CRC failed');showError('CRC Error','Check wiring/baud rate.');return}
    if(resp[1]&0x80){var ec=resp[2],en={1:'Illegal Function',2:'Illegal Data Address',3:'Illegal Data Value',4:'Slave Device Failure'};addLog('err','Exception: '+(en[ec]||'Unknown')+' ('+ec+')');showError('Exception: '+(en[ec]||'Unknown'),'Code '+ec+', FC='+fc+', Addr='+wa);return}
    clearError();showRawFrame(resp);displayResponse(fc,resp,dsa,qty,el);
  }).catch(function(e){addLog('err',e.message);showError('Error',e.message)});
}

function showRawFrame(d){$('sectionRaw').style.display='block';$('rawHex').textContent=hex(d);$('rawBin').textContent=Array.from(d).map(function(b){return b.toString(2).padStart(8,'0')}).join(' ');$('rawAscii').textContent=Array.from(d).map(function(b){return(b>=32&&b<=126)?String.fromCharCode(b):'\u00B7'}).join('')}

// ─── Display Response ────────────────────────────────
function displayResponse(fc,data,dsa,qty,elapsed){
  var tbl=$('responseTable'),head=$('tableHead'),body=$('tableBody');
  $('responseMeta').style.display='flex';$('respTime').textContent=elapsed;$('respBytes').textContent=data.length;$('respSlave').textContent=data[0];
  $('emptyState').style.display='none';tbl.style.display='table';body.innerHTML='';
  var hp=!!activeProfile;
  if(fc===1||fc===2){
    $('sectionDtype').style.display='none';
    var hdr='<th>Address</th>';if(hp)hdr+='<th>Label</th>';hdr+='<th>Value</th><th>State</th><th>Hex</th><th>Binary</th>';
    head.innerHTML='<tr>'+hdr+'</tr>';
    for(var i=0;i<qty;i++){
      var val=(data[3+(i>>3)]>>(i&7))&1,addr=dsa+i,lbl=getProfileLabel(fc,addr);
      var tr=document.createElement('tr');tr.className='fade-in';tr.style.animationDelay=i*15+'ms';
      var cells='<td class="addr">'+addr+'</td>';if(hp)cells+='<td class="lbl">'+esc(lbl||'\u2014')+'</td>';
      cells+='<td class="'+(val?'bool-true':'bool-false')+'">'+val+'</td><td class="'+(val?'bool-true':'bool-false')+'">'+(val?'ON':'OFF')+'</td><td class="hex">0x'+val.toString(16).toUpperCase().padStart(2,'0')+'</td><td style="color:var(--text-muted)">'+val.toString(2)+'</td>';
      tr.innerHTML=cells;body.appendChild(tr);
    }
    lastResponse={fc:fc,data:data,displayStartAddr:dsa,quantity:qty,elapsed:elapsed};
  }else if(fc===3||fc===4){
    var bc=data[2],rc=bc/2,rv=[];
    for(var i2=0;i2<rc;i2++)rv.push((data[3+i2*2]<<8)|data[4+i2*2]);
    lastResponse={fc:fc,data:data,displayStartAddr:dsa,quantity:qty,elapsed:elapsed,regValues:rv};
    applyProfileTypes(rc,dsa,fc);buildDtypeGrid(rc,dsa);
    var hdr2='<th>Address</th>';if(hp)hdr2+='<th>Label</th>';hdr2+='<th>Raw(U16)</th><th>Hex</th><th>Type</th><th>Interpreted</th>';
    head.innerHTML='<tr>'+hdr2+'</tr>';
    var bo=getByteOrder(),idx=0;
    while(idx<rc){
      var type=registerTypes[idx]||'uint16',def=DATA_TYPES[type],span=def?def.regSpan:1;
      var decoded=decodeValue(type,rv.slice(idx,idx+span),bo),raw=rv[idx],addr2=dsa+idx,lbl2=getProfileLabel(fc,addr2);
      var tr2=document.createElement('tr');tr2.className='fade-in';tr2.style.animationDelay=idx*15+'ms';
      var c2='<td class="addr">'+addr2+'</td>';if(hp)c2+='<td class="lbl">'+esc(lbl2||'\u2014')+'</td>';
      c2+='<td class="val">'+raw+'</td><td class="hex">0x'+raw.toString(16).toUpperCase().padStart(4,'0')+'</td><td>'+(def?def.label:type)+'</td><td class="interpreted">'+esc(decoded)+'</td>';
      tr2.innerHTML=c2;body.appendChild(tr2);
      for(var j=1;j<span&&(idx+j)<rc;j++){
        var tr3=document.createElement('tr');tr3.className='fade-in';var ru=rv[idx+j],lbl3=getProfileLabel(fc,dsa+idx+j);
        var c3='<td class="addr">'+(dsa+idx+j)+'</td>';if(hp)c3+='<td class="lbl">'+esc(lbl3||'\u2014')+'</td>';
        c3+='<td class="val">'+ru+'</td><td class="hex">0x'+ru.toString(16).toUpperCase().padStart(4,'0')+'</td><td class="span-note">\u2191 '+def.label+'</td><td class="span-note">\u2014</td>';
        tr3.innerHTML=c3;body.appendChild(tr3);
      }
      idx+=span;
    }
  }else{
    $('sectionDtype').style.display='none';
    head.innerHTML='<tr><th>Field</th><th>Value</th><th>Hex</th></tr>';
    var ra=(data[2]<<8|data[3]),vr=(data[4]<<8|data[5]);
    var rows=[['Slave ID',data[0],'0x'+data[0].toString(16).toUpperCase().padStart(2,'0')],['Function Code',data[1],'0x'+data[1].toString(16).toUpperCase().padStart(2,'0')],['Address (wire)',ra,'0x'+ra.toString(16).toUpperCase().padStart(4,'0')],['Address (display)',dsa,'\u2014'],[fc===5||fc===15?'Coil Value':'Reg Value',vr,'0x'+vr.toString(16).toUpperCase().padStart(4,'0')],['Status','Success \u2713','\u2014']];
    rows.forEach(function(row,i){var tr=document.createElement('tr');tr.className='fade-in';tr.style.animationDelay=i*30+'ms';tr.innerHTML='<td>'+row[0]+'</td><td class="val">'+row[1]+'</td><td class="hex">'+row[2]+'</td>';body.appendChild(tr)});
    lastResponse={fc:fc,data:data,displayStartAddr:dsa,quantity:qty,elapsed:elapsed};
  }
}

// ─── Polling ─────────────────────────────────────────
function togglePolling(){var cb=$('pollingEnabled');if(cb.checked){if(!connected){addLog('err','Connect first.');cb.checked=false;return}var iv=+$('pollInterval').value||1000;isPolling=true;addLog('tx','Polling every '+iv+'ms');sendQuery();pollingTimer=setInterval(sendQuery,iv)}else stopPolling()}
function stopPolling(){if(pollingTimer){clearInterval(pollingTimer);pollingTimer=null}isPolling=false;$('pollingEnabled').checked=false;addLog('tx','Polling stopped')}

// ─── Log ─────────────────────────────────────────────
function addLog(dir,msg){logEntries++;$('logCount').textContent=logEntries;var lb=$('logBody'),now=new Date(),t=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0')+'.'+String(now.getMilliseconds()).padStart(3,'0'),dl=dir==='tx'?'TX':dir==='rx'?'RX':'!!',e=document.createElement('div');e.className='log-entry fade-in';e.innerHTML='<span class="log-time">'+t+'</span><span class="log-dir '+dir+'">'+dl+'</span><span class="log-msg">'+msg+'</span>';lb.appendChild(e);lb.scrollTop=lb.scrollHeight}
function clearLog(){$('logBody').innerHTML='';logEntries=0;$('logCount').textContent='0'}

// ─── Helpers ─────────────────────────────────────────
function hex(a){return Array.from(a).map(function(b){return b.toString(16).toUpperCase().padStart(2,'0')}).join(' ')}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// ─── Event Binding (CSP-compliant, no inline handlers) ───
document.addEventListener('DOMContentLoaded',function(){
  // Modals
  $('aboutModal').addEventListener('click',function(ev){if(ev.target===this)closeAbout()});
  $('btnCloseAbout').addEventListener('click',closeAbout);
  $('profileModal').addEventListener('click',function(ev){if(ev.target===this)closeProfile()});
  $('btnAbout').addEventListener('click',openAbout);
  $('profileBtn').addEventListener('click',openProfile);
  $('btnProfileClear').addEventListener('click',clearActiveProfile);

  // Profile editor
  $('btnAddEntry').addEventListener('click',function(){addProfileEntry()});
  $('btnProfSave').addEventListener('click',saveCurrentProfile);
  $('btnProfExport').addEventListener('click',exportProfile);
  $('btnProfImport').addEventListener('click',function(){$('profileImportFile').click()});
  $('profileImportFile').addEventListener('change',importProfile);
  $('btnProfClear').addEventListener('click',clearActiveProfile);
  $('btnProfClose').addEventListener('click',closeProfile);

  // Profile entry delete (event delegation)
  $('profileEntryList').addEventListener('click',function(ev){var btn=ev.target.closest('.pe-del');if(btn)btn.parentElement.remove()});

  // Saved profiles load/delete (event delegation)
  $('savedProfilesList').addEventListener('click',function(ev){
    var loadBtn=ev.target.closest('.sp-load');
    if(loadBtn){loadSaved(+loadBtn.dataset.idx);return}
    var delBtn=ev.target.closest('.sp-del');
    if(delBtn)delSaved(+delBtn.dataset.idx);
  });

  // Connection
  $('btnConnect').addEventListener('click',toggleConnection);
  $('btnDisconnect').addEventListener('click',disconnect);

  // Slave config
  $('startAddr').addEventListener('input',updateWirePreview);

  // Offset
  $('minusOffsetEnabled').addEventListener('change',updateOffsetUI);
  $('minusOffset').addEventListener('input',updateOffsetUI);

  // Polling
  $('pollingEnabled').addEventListener('change',togglePolling);

  // FC tabs (event delegation)
  $('fcTabs').addEventListener('click',function(ev){
    var tab=ev.target.closest('[data-fc]');
    if(tab)setFC(+tab.dataset.fc,tab);
  });

  // Send
  $('sendBtn').addEventListener('click',sendQuery);

  // Collapsible sections (event delegation)
  document.querySelectorAll('.collapsible-header[data-section]').forEach(function(hdr){
    hdr.addEventListener('click',function(){toggleSection(this.dataset.section)});
  });

  // Dtype: copy first, apply, byte order
  $('btnCopyFirst').addEventListener('click',function(ev){ev.stopPropagation();copyFirstToAll()});
  $('btnApply').addEventListener('click',function(ev){ev.stopPropagation();reRender()});
  $('byteOrder').addEventListener('change',reRender);

  // Dtype grid select changes (event delegation)
  $('dtypeGrid').addEventListener('change',function(ev){
    var sel=ev.target.closest('select[data-reg]');
    if(sel){registerTypes[+sel.dataset.reg]=sel.value;reRender()}
  });

  // Clear log
  $('btnClearLog').addEventListener('click',function(ev){ev.stopPropagation();clearLog()});
});
