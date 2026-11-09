(() => {
  const cfg = window.TOTED_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.startsWith('YOUR_') && !cfg.SUPABASE_ANON_KEY.startsWith('YOUR_');
  const db = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = (id) => document.getElementById(id);
  const homeView=$('homeView'), albumView=$('albumView'), albumList=$('albumList'), photoGrid=$('photoGrid');
  let currentAlbum=null, currentPhotos=[], viewerIndex=0, scale=1, tx=0, ty=0, pointers=new Map(), startPoint=null, pinchStart=0, pinchDistance=0;
  const publicUrl=(path)=>db.storage.from('photos').getPublicUrl(path).data.publicUrl;
  const escapeHtml=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // 아이폰 브라우저 내부 사진 저장소
  let archiveDB;

  function openArchiveDB(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('totedArchive',1);

      request.onupgradeneeded=()=>{
        const db=request.result;

        if(!db.objectStoreNames.contains('albums')){
          db.createObjectStore('albums',{keyPath:'id'});
        }

        if(!db.objectStoreNames.contains('photos')){
          const photos=db.createObjectStore('photos',{keyPath:'id'});
          photos.createIndex('albumId','albumId',{unique:false});
        }
      };

      request.onsuccess=()=>{
        archiveDB=request.result;
        resolve(archiveDB);
      };

      request.onerror=()=>reject(request.error);
    });
  }

  function saveRecord(storeName,record){
    return new Promise((resolve,reject)=>{
      const tx=archiveDB.transaction(storeName,'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }

  function getAllRecords(storeName){
    return new Promise((resolve,reject)=>{
      const tx=archiveDB.transaction(storeName,'readonly');
      const request=tx.objectStore(storeName).getAll();
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }  async function loadAlbums(){
  const albums=await getAllRecords('albums');

  albumList.innerHTML='';
  $('homeMessage').classList.toggle('hidden',albums.length!==0);

  albums.sort((a,b)=>b.createdAt-a.createdAt);

  albums.forEach(album=>{
    const button=document.createElement('button');
    button.className='album-card';
    button.type='button';

    const imageUrl=URL.createObjectURL(album.cover);

    button.innerHTML=`
      <img loading="lazy" src="${imageUrl}" alt="">
      <h2>${escapeHtml(album.title)}</h2>
      <p class="album-meta">PHOTO COLLECTION</p>
    `;

    button.addEventListener('click',()=>openAlbum(album));
    albumList.append(button);
  });
}

async function openAlbum(album){
  currentAlbum=album;
  homeView.classList.add('hidden');
  albumView.classList.remove('hidden');

  $('albumTitle').textContent=album.title;
  $('albumCover').innerHTML='';

  const coverUrl=URL.createObjectURL(album.cover);
  const coverImage=document.createElement('img');
  coverImage.src=coverUrl;
  $('albumCover').append(coverImage);

  photoGrid.innerHTML='<div class="loading">사진을 불러오는 중…</div>';

  const tx=archiveDB.transaction('photos','readonly');
  const request=tx.objectStore('photos').index('albumId').getAll(album.id);

  request.onsuccess=()=>{
    currentPhotos=request.result
      .sort((a,b)=>a.sortOrder-b.sortOrder)
      .map(photo=>({
        ...photo,
        url:URL.createObjectURL(photo.image)
      }));

    $('photoCount').textContent=`${currentPhotos.length} PHOTOS`;
    photoGrid.innerHTML='';

    currentPhotos.forEach((photo,index)=>{
      const button=document.createElement('button');
      button.className='photo-cell';
      button.type='button';
      button.innerHTML=`<img loading="lazy" src="${photo.url}" alt="사진 ${index+1}">`;
      button.addEventListener('click',()=>showViewer(index));
      photoGrid.append(button);
    });
  };
}
  }
  function showHome(){albumView.classList.add('hidden');homeView.classList.remove('hidden');currentAlbum=null;history.replaceState(null,'','#home');}
  $('backHome').addEventListener('click',showHome);
  $('openUpload').addEventListener('click',()=>{if(!db){alert('먼저 README의 Supabase 설정을 완료해 주세요.');return;}$('uploadDialog').showModal();});
  $('closeUpload').addEventListener('click',()=>$('uploadDialog').close());
  $('uploadForm').addEventListener('submit',async(e)=>{
    e.preventDefault();

    const status=$('uploadStatus');
    const submit=$('submitUpload');
    const title=$('albumName').value.trim();
    const cover=$('coverFile').files[0];
    const files=[...$('photoFiles').files];

    if(!title){
      status.textContent='앨범 이름을 입력해 주세요.';
      return;
    }

    if(!cover||!files.length){
      status.textContent='대표 사진과 앨범 사진을 선택해 주세요.';
      return;
    }

    if(files.length>20){
      status.textContent='앨범 사진은 최대 20장까지 올릴 수 있어요.';
      return;
    }

    const all=[cover,...files];

    if(all.some(f=>!f.type.startsWith('image/')||f.size>15*1024*1024)){
      status.textContent='이미지 파일만 가능하며 사진 한 장은 15MB 이하여야 해요.';
      return;
    }

    submit.disabled=true;

    try{
      const albumId=crypto.randomUUID();

      status.textContent='앨범 저장 중…';

      await saveRecord('albums',{
        id:albumId,
        title:title,
        cover:cover,
        createdAt:Date.now()
      });

      for(let i=0;i<files.length;i++){
        status.textContent=`사진 저장 중… ${i+1}/${files.length}`;

        await saveRecord('photos',{
          id:crypto.randomUUID(),
          albumId:albumId,
          image:files[i],
          sortOrder:i
        });
      }

      status.textContent='저장 완료!';
      $('uploadForm').reset();

      setTimeout(()=>{
        $('uploadDialog').close();
        status.textContent='';
        loadAlbums();
      },900);

    }catch(err){
      status.textContent='저장 중 문제가 발생했어요: '+err.message;
    }finally{
      submit.disabled=false;
    }
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
