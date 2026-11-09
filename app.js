(() => {
  const cfg = window.TOTED_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.startsWith('YOUR_') && !cfg.SUPABASE_ANON_KEY.startsWith('YOUR_');
  const db = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = (id) => document.getElementById(id);
  const homeView=$('homeView'), albumView=$('albumView'), albumList=$('albumList'), photoGrid=$('photoGrid');
  let currentAlbum=null, currentPhotos=[], viewerIndex=0, scale=1, tx=0, ty=0, pointers=new Map(), startPoint=null, pinchStart=0, pinchDistance=0;
  const publicUrl=(path)=>db.storage.from('photos').getPublicUrl(path).data.publicUrl;
  const escapeHtml=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function loadAlbums(){
    if(!db){albumList.innerHTML='<div class="loading">아직 Supabase 연결 전이에요.<br>README 안내에 따라 설정을 마치면 앨범이 표시됩니다.</div>';return;}
    const {data,error}=await db.from('albums').select('id,title,cover_path,created_at').order('created_at',{ascending:false});
    if(error){albumList.innerHTML='<div class="loading">앨범을 불러오지 못했어요. Supabase 설정을 확인해 주세요.</div>';return;}
    albumList.innerHTML='';$('homeMessage').classList.toggle('hidden',data.length!==0);
    data.forEach(album=>{
      const button=document.createElement('button');button.className='album-card';button.type='button';
      button.innerHTML=`<img loading="lazy" src="${publicUrl(album.cover_path)}" alt=""><h2>${escapeHtml(album.title)}</h2><p class="album-meta">PHOTO COLLECTION</p>`;
      button.addEventListener('click',()=>openAlbum(album));albumList.append(button);
    });
  }
  async function openAlbum(album){
    currentAlbum=album;homeView.classList.add('hidden');albumView.classList.remove('hidden');$('albumTitle').textContent=album.title;$('albumCover').innerHTML=`<img src="${publicUrl(album.cover_path)}" alt="">`;
    photoGrid.innerHTML='<div class="loading">사진을 불러오는 중…</div>';
    const {data,error}=await db.from('photos').select('id,storage_path,sort_order').eq('album_id',album.id).order('sort_order');
    if(error){photoGrid.innerHTML='<p class="loading">사진을 불러오지 못했어요.</p>';return;}
    currentPhotos=data.map(p=>({...p,url:publicUrl(p.storage_path)}));$('photoCount').textContent=`${data.length} PHOTOS`;photoGrid.innerHTML='';
    currentPhotos.forEach((photo,index)=>{const b=document.createElement('button');b.className='photo-cell';b.type='button';b.innerHTML=`<img loading="lazy" src="${photo.url}" alt="사진 ${index+1}">`;b.addEventListener('click',()=>showViewer(index));photoGrid.append(b);});
  }
  function showHome(){albumView.classList.add('hidden');homeView.classList.remove('hidden');currentAlbum=null;history.replaceState(null,'','#home');}
  $('backHome').addEventListener('click',showHome);
  $('openUpload').addEventListener('click',()=>{if(!db){alert('먼저 README의 Supabase 설정을 완료해 주세요.');return;}$('uploadDialog').showModal();});
  $('closeUpload').addEventListener('click',()=>$('uploadDialog').close());

  $('uploadForm').addEventListener('submit',async(e)=>{
    e.preventDefault();const status=$('uploadStatus'),submit=$('submitUpload');const password=$('uploadPassword').value.trim(),title=$('albumName').value.trim(),cover=$('coverFile').files[0],files=[...$('photoFiles').files];
    if(!cover||!files.length){status.textContent='대표 사진과 앨범 사진을 선택해 주세요.';return;}
    if(files.length>20){status.textContent='앨범 사진은 최대 20장까지 올릴 수 있어요.';return;}
    const all=[cover,...files];if(all.some(f=>!['image/jpeg','image/png','image/webp','image/gif'].includes(f.type)||f.size>6*1024*1024)){status.textContent='JPG, PNG, WEBP, GIF만 가능하며 사진 한 장은 6MB 이하여야 해요.';return;}
    submit.disabled=true;status.textContent='업로드 준비 중…';
    try{
      const filesInfo=all.map((f,i)=>({name:f.name,type:f.type,size:f.size,role:i===0?'cover':'photo',sort_order:i-1}));
      const prepare=await fetch(`${cfg.SUPABASE_URL}/functions/v1/upload`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.SUPABASE_ANON_KEY},body:JSON.stringify({action:'prepare',password,title,files:filesInfo})});
      const prep=await prepare.json();if(!prepare.ok)throw new Error(prep.error||'비밀번호 또는 업로드 준비를 확인해 주세요.');
      for(let i=0;i<all.length;i++){status.textContent=`사진 업로드 중… ${i+1}/${all.length}`;const item=prep.uploads[i];const {error}=await db.storage.from('photos').uploadToSignedUrl(item.path,item.token,all[i],{contentType:all[i].type});if(error)throw error;}
      status.textContent='앨범 정보 저장 중…';
      const finish=await fetch(`${cfg.SUPABASE_URL}/functions/v1/upload`,{method:'POST',headers:{'Content-Type':'application/json','apikey':cfg.SUPABASE_ANON_KEY},body:JSON.stringify({action:'finalize',password,album_id:prep.album_id,title,uploads:prep.uploads.map((u,i)=>({path:u.path,role:i===0?'cover':'photo',sort_order:i-1}))})});
      const done=await finish.json();if(!finish.ok)throw new Error(done.error||'앨범 저장에 실패했어요.');
      status.textContent='업로드 완료!';$('uploadForm').reset();setTimeout(()=>{$('uploadDialog').close();status.textContent='';loadAlbums();},900);
    }catch(err){status.textContent=err.message||'업로드 중 문제가 생겼어요.';}finally{submit.disabled=false;}
  });

  const viewer=$('viewer'),stage=$('viewerStage'),img=$('viewerImage');
  function applyTransform(){img.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;}
  function resetZoom(){scale=1;tx=0;ty=0;applyTransform();}
  function showViewer(index){viewerIndex=index;img.src=currentPhotos[index].url;viewer.classList.remove('hidden');$('viewerCounter').textContent=`${index+1} / ${currentPhotos.length}`;resetZoom();}
  function closeViewer(){viewer.classList.add('hidden');pointers.clear();resetZoom();}
  function movePhoto(delta){if(scale>1.01)return;viewerIndex=(viewerIndex+delta+currentPhotos.length)%currentPhotos.length;img.src=currentPhotos[viewerIndex].url;$('viewerCounter').textContent=`${viewerIndex+1} / ${currentPhotos.length}`;resetZoom();}
  $('closeViewer').addEventListener('click',closeViewer);
  stage.addEventListener('pointerdown',e=>{stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1)startPoint={x:e.clientX,y:e.clientY,time:Date.now()};if(pointers.size===2){const p=[...pointers.values()];pinchDistance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);pinchStart=scale;startPoint=null;}});
  stage.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const p=[...pointers.values()],d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);scale=Math.max(1,Math.min(5,pinchStart*d/(pinchDistance||d)));applyTransform();}else if(pointers.size===1&&scale>1){const dx=e.clientX-(startPoint?.x??e.clientX),dy=e.clientY-(startPoint?.y??e.clientY);tx+=dx;ty+=dy;startPoint={x:e.clientX,y:e.clientY};applyTransform();}});
  function pointerEnd(e){const p=pointers.get(e.pointerId);if(p&&pointers.size===1&&startPoint&&scale===1){const dx=e.clientX-startPoint.x,dy=e.clientY-startPoint.y;if(Math.abs(dy)>55&&Math.abs(dy)>Math.abs(dx)*1.2){if(dy<0)movePhoto(-1);else movePhoto(1);}}pointers.delete(e.pointerId);if(pointers.size<2)pinchDistance=0;if(pointers.size===0)startPoint=null;if(scale<1.03){scale=1;tx=0;ty=0;applyTransform();}}
  stage.addEventListener('pointerup',pointerEnd);stage.addEventListener('pointercancel',pointerEnd);stage.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!viewer.classList.contains('hidden'))closeViewer();});
  loadAlbums();
})();
