# Paperly (페이퍼리)

개인용 PDF 필기 앱 (iPad · Galaxy Tab). Expo / React Native 단일 코드베이스.

핵심 기능
- PDF 가져오기 → 기기 안에서 AES-GCM 암호화 저장 (iOS Keychain / Android Keystore 키, 백업·파일앱 노출 없음)
- 실제 PDF 페이지 렌더링: iOS PDFKit · Android PdfRenderer (로컬 Expo 모듈 `modules/pdf-renderer`) · 웹 미리보기는 pdf.js
- 필기: 펜/연필/형광펜/만년필/붓펜, 스트로크·벡터 지우개, 올가미(복제/삭제), 도형, 텍스트 상자, 레이저 포인터, 색·굵기·투명도, 획/직선 보정
- 실행취소/다시실행, 페이지별 필기 버전 기록·복원, 회독(필기 레이어) 전환, 현재 페이지 지우기
- 레이아웃: 세로/가로/연속 스크롤/두 페이지, 핀치·버튼 확대, 전체 화면, 북마크, 썸네일·목차·검색 패널, 여러 문서 탭
- 보안: 스크린샷·화면녹화·미러링 차단(FLAG_SECURE / iOS secure layer), 앱 전환 화면 가림, 공유·내보내기 기능 없음

개발
```bash
npm install
npx expo start --web      # 브라우저 미리보기 (보안 기능·암호화는 네이티브 전용)
npx expo prebuild         # ios/ android/ 생성 후 Xcode / Android Studio로 실행
```

빌드 (GitHub Actions)
- `Android APK (Galaxy Tab sideload)`: push마다 서명된 APK 아티팩트 생성. 첫 실행 시 생성된 keystore 아티팩트를 보관해 `ANDROID_KEYSTORE_BASE64/PASSWORD/KEY_ALIAS/KEY_PASSWORD` 시크릿으로 넣으면 업데이트 설치가 가능.
- `iOS build (iPad)`: `compile-check`는 서명 없이 컴파일 검증. `testflight` 잡은 수동 실행이며 README 상단의 시크릿이 필요.
