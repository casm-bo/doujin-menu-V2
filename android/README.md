# 동인메뉴 Android

데스크톱 Companion 서버와 같은 Wi-Fi에서 페어링하고 동기화하는 Android 클라이언트입니다.

## 현재 구현 범위

- 6자리 코드 페어링
- Android Keystore 기반 토큰 암호화 저장
- 사설 IPv4 Companion 주소만 허용
- Room 라이브러리 및 열람 상태 캐시
- 현재 페이지와 즐겨찾기 오프라인 변경 큐
- 초기 동기화 및 커서 기반 증분 동기화
- WorkManager 15분 주기 재시도

## 빌드

Android Studio의 JDK와 Android SDK가 설정된 환경에서 실행합니다.

```powershell
cd android
./gradlew.bat testDebugUnitTest assembleDebug
```

생성 APK: `app/build/outputs/apk/debug/app-debug.apk`

## 수동 연결 확인

1. 데스크톱 설정에서 Companion 서버를 켭니다.
2. 페어링 코드를 생성합니다.
3. Android 앱에 데스크톱의 사설 IPv4 주소와 코드를 입력합니다.
4. 초기 동기화 후 표시되는 로컬 캐시 도서 수를 확인합니다.

공용 Wi-Fi에서는 사용하지 않는 것을 권장합니다.
