# toted archive

모바일 우선 사진 아카이브. GitHub Pages + Supabase 무료 요금제에서 시작하도록 만든 기본 프로젝트입니다.

## 들어 있는 기능
- 어두운 테마의 세로형 앨범 목록
- 앨범별 사진 격자
- 사진 전체 화면 보기
- 두 손가락 확대/축소 및 확대 상태에서 이동
- 기본 배율에서 위로 스와이프하면 이전 사진, 아래로 스와이프하면 다음 사진
- 업로드 비밀번호 확인 후 앨범과 사진 등록

## 1. Supabase 프로젝트 준비
1. Supabase에서 새 프로젝트를 만듭니다. 유료 플랜이나 유료 옵션은 선택하지 마세요.
2. SQL Editor에서 `supabase/schema.sql`의 내용을 붙여 넣고 실행합니다.
3. Project Settings의 API 화면에서 Project URL과 anon/public key를 확인합니다.
4. `config.js`의 `YOUR_SUPABASE_PROJECT_URL`, `YOUR_SUPABASE_ANON_KEY`를 바꿉니다. anon key는 공개용 키입니다.

## 2. 업로드 함수 배포
Supabase CLI가 설치된 컴퓨터에서 프로젝트 폴더를 열고 다음을 실행합니다.

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set UPLOAD_PASSWORD='여기에_직접_정한_긴_비밀번호'
supabase functions deploy upload
```

Supabase가 제공하는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 기본 환경 변수는 Edge Function에서 사용합니다. service role key를 `config.js`나 GitHub 저장소에 넣지 마세요.

## 3. GitHub Pages 배포
1. GitHub에서 새 저장소를 만듭니다. 예: `toted-archive`
2. 이 폴더의 파일을 저장소 최상위에 업로드합니다. `index.html`이 최상위에 있어야 합니다.
3. 저장소의 Settings → Pages → Build and deployment에서 `Deploy from a branch`를 선택합니다.
4. Branch는 `main`, folder는 `/ (root)`로 설정하고 Save를 누릅니다.
5. 잠시 기다리면 GitHub Pages 주소가 생성됩니다.

## 무료 사용 관련 주의
- GitHub Pages와 Supabase 무료 요금제의 현재 한도 안에서만 운영합니다.
- 무료 요금제의 한도, 일시 정지 조건, 정책은 바뀔 수 있으며 영구 무료가 보장되지는 않습니다.
- Supabase 무료 프로젝트는 비활성 상태가 길어지면 일시 정지될 수 있습니다.
- 이 프로젝트는 사진 파일을 공개 읽기 버킷에 저장합니다. 사이트 방문자는 사진을 볼 수 있습니다.
- 업로드 비밀번호는 Edge Function의 secret으로만 저장합니다. 프런트엔드 파일에는 절대 넣지 마세요.
- 비밀번호 방식은 계정 로그인보다 단순하지만, 업로드 주소와 비밀번호가 유출되면 다른 사람도 업로드할 수 있습니다. 긴 비밀번호를 사용하고 다른 곳에서 재사용하지 마세요.

## 제한
- 앨범당 대표 사진 1장 + 사진 최대 20장
- 사진 형식: JPG, PNG, WEBP, GIF
- 사진 한 장당 최대 6MB
- 현재 버전은 앨범/사진 삭제 및 수정 기능은 포함하지 않습니다.
