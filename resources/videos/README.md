# public/videos

App ke saath jane wali videos yahan aati hain. `electron-builder.yml` is folder
ko `resources/videos` mein rakhta hai (asar ke bahar). Production mein app ka
localhost server `/videos/<naam>` inhi files se deta hai; `maya-media://` raasta
bhi hai (`src/lib/bundled-media.ts`, `electron/main.js` → `registerMediaProtocol`).

## Files
- `light-female-1.mp4` — Classic card ki roshni wali female character ki zinda video
  (`src/components/voice/LightAvatar.tsx`, `LOOK.video`). Gemini se bani
  (`scene-studio/prompts/female-light/idle-v5.txt`), Windows ke apne transcoder se
  1280x720, 24fps, ~1.4 Mbps, bina awaaz (~1.4 MB). Asal 1080p:
  `scene-studio/clips/female-light/idle-v5.mp4` (git mein nahi). LightAvatar ise
  same-origin `fetch` se memory mein le kar WebGL par chalata hai (doosre origin ki
  video WebGL mein parhi nahi ja sakti). Clip badlo to card ka rang
  (`LIGHT_AVATAR_CARD_BG`) dobara naapo.
- `light-female-1r.mp4` — wohi clip ULTI (frames ulti tarteeb, `scene-studio/video-tools/extract.js` + `frames-to-mp4.ps1`), muft ka doosra pattern; dono master par shuru/khatam. Loop dono ko random chunta hai.
- `light-female-silk-1.mp4` / `-1r` aur `light-female-bob-1.mp4` / `-1r` (14 Nov 2026) — wohi character ke doosre
  hairstyles (`src/lib/avatar/hair-styles.ts`). Asal 1080p: `scene-studio/clips/female-light-silk/idle-v2b.mp4`,
  `scene-studio/clips/female-light-bob/idle-v4c.mp4`. Wohi 720p / 24fps / ~1.4 MB. Background (2,22,31) / (3,20,30) — card
  ke `#02131b` se 2-4 darje, kinare ghulte hain. `scripts/test-onboarding.js` jaanchta hai ke ye sab mojood hain.
- Loop pichli clip ki ulti foran nahi chunta ("rewind" nahi). Koi clip server par na mile (HTTP error) to sirf wo chhoot-ti hai; sab gayab = tasveer par code wali lehar. Video ke upar bhi baal/shawl ki halki lehar hamesha (`SWAY`) — character kabhi saakit nahi.
- Nayi clip sirf tab jab card mein bhi figure hile (v14, 5 Nov: card mein saakit lagi = "sticker", hatayi).
- Ye mp4 git mein NAHI (`.gitignore`: `public/videos/*.mp4`) — build isi laptop ki files se banta hai.
- Nayi clip jorni ho: `scene-studio/video-tools/README.md` (jaanch → 720p → ulti → `LOOK.video.clips`).
- `maya-ai-engine-guide.mp4` — Settings → Tutorials ki "AI Engine guide" (7 Nov 2026, 8:48,
  Roman Urdu, sirf Lifetime ko dikhti hai). 1280x720, H.264 constant-quality (qp 30) + Opus 32k
  mono, 9.6 MB. Player: `src/components/modules/settings/TutorialGuideCard.tsx`; bahar ke player
  mein kholna: `electron/main/ipc/tutorial-handlers.js`. Ye file git MEIN hai (`.gitignore` ka
  istisna) taake har build mein jaye. Asal 1080p (126 MB, YouTube ke liye):
  `Desktop\My Folders\All Maya Ai Creatives\Tutorials\`. File ka naam badlo to handler ki
  fehrist aur `config/tutorials.ts` dono badlo.

Purana intro (`maya start video.mp4`) 6 Oct 2026 ko naye onboarding ("First
Contact") ke saath hata diya gaya — us ki jagah ab
`src/components/onboarding/scenes/WakeScene.tsx` hai. Video git history mein hai.
