import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const allowed = new Set(['image/jpeg','image/png','image/webp','image/gif']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);
  try {
    const body = await req.json();
    const expected = Deno.env.get('UPLOAD_PASSWORD');
    if (!expected) return json({ error: '서버 비밀번호가 아직 설정되지 않았습니다.' }, 500);
    if (typeof body.password !== 'string' || body.password !== expected) return json({ error: '비밀번호가 올바르지 않습니다.' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey);

    if (body.action === 'prepare') {
      const title = String(body.title ?? '').trim();
      const files = body.files;
      if (!title || title.length > 80) return json({ error: '앨범 제목은 1~80자로 입력해 주세요.' }, 400);
      if (!Array.isArray(files) || files.length < 2 || files.length > 21) return json({ error: '대표 사진 1장과 앨범 사진 1~20장을 선택해 주세요.' }, 400);
      for (const f of files) {
        if (!allowed.has(f.type) || !Number.isFinite(f.size) || f.size <= 0 || f.size > 6291456) return json({ error: '지원하지 않는 사진 형식이거나 6MB를 초과했습니다.' }, 400);
      }
      const albumId = crypto.randomUUID();
      const uploads = [];
      for (const f of files) {
        const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'} as Record<string,string>)[f.type];
        const path = `${albumId}/${crypto.randomUUID()}.${ext}`;
        const { data, error } = await admin.storage.from('photos').createSignedUploadUrl(path);
        if (error) throw error;
        uploads.push({ path, token: data.token });
      }
      return json({ album_id: albumId, uploads });
    }

    if (body.action === 'finalize') {
      const title = String(body.title ?? '').trim();
      const uploads = body.uploads;
      if (!/^[0-9a-f-]{36}$/i.test(String(body.album_id ?? '')) || !title || title.length > 80 || !Array.isArray(uploads) || uploads.length < 2 || uploads.length > 21) return json({ error: '앨범 정보가 올바르지 않습니다.' }, 400);
      const prefix = `${body.album_id}/`;
      if (uploads.some((u: any) => typeof u.path !== 'string' || !u.path.startsWith(prefix))) return json({ error: '파일 경로가 올바르지 않습니다.' }, 400);
      const { data: listed, error: listError } = await admin.storage.from('photos').list(String(body.album_id), { limit: 30 });
      if (listError) throw listError;
      const present = new Set((listed ?? []).map((x: any) => `${body.album_id}/${x.name}`));
      if (uploads.some((u: any) => !present.has(u.path))) return json({ error: '업로드되지 않은 사진이 있습니다.' }, 400);
      const cover = uploads.find((u: any) => u.role === 'cover') ?? uploads[0];
      const { error: albumError } = await admin.from('albums').insert({ id: body.album_id, title, cover_path: cover.path });
      if (albumError) throw albumError;
      const rows = uploads.filter((u: any) => u.path !== cover.path).map((u: any, i: number) => ({ album_id: body.album_id, storage_path: u.path, sort_order: Number.isInteger(u.sort_order) ? u.sort_order : i }));
      const { error: photoError } = await admin.from('photos').insert(rows);
      if (photoError) { await admin.from('albums').delete().eq('id', body.album_id); throw photoError; }
      return json({ ok: true });
    }
    return json({ error: '알 수 없는 요청입니다.' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: '서버 처리 중 오류가 발생했습니다.' }, 500);
  }
});
