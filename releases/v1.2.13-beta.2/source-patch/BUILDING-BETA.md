# Beta 鏋勫缓璇存槑

瀹屾暣淇敼鍚庢簮鐮佷綅浜?`source.tar.gz`銆俙source-patch/src`銆乣include`銆乣scripts`銆乣tests` 瑕嗙洊涓婃父 `runtime-src/` 瀵瑰簲璺緞锛宍source-patch/ui` 瑕嗙洊涓婃父 `ui/`銆?

褰撳墠宸ヤ綔鍖哄鐜帮紙浠?`E:\Demo\U60\devui` 杩愯锛夛細

```powershell
python -X utf8 .\build-tools\test-beta.py
python -X utf8 .\build-tools\test-install.py
python -X utf8 .\local-assets\u60pro-screen-ui-v1.0.0\runtime-src\scripts\build-windows.py
python -X utf8 .\build-tools\package-beta.py
```

Windows 鏋勫缓渚濊禆宸插浐瀹氬湪 `local-assets/screen-build/`锛歓ig 0.14.1銆丗reeType 2.13.3銆乴itehtml 0.10锛涙瀯寤鸿剼鏈笉浼氳嚜鍔ㄤ笅杞藉畠浠€傛祴璇曚娇鐢ㄥ凡瀛樺湪鐨?`docker-desktop` WSL锛屽彧閫氳繃 stdin 浼犲叆鐙珛娴嬭瘯鏂囦欢锛屽湪 `/tmp/devui-*` 闅旂鐩綍鎵ц锛屼笉鎸傝浇璺敱鍣ㄦ垨椤圭洰鐩綍銆傜Щ鍒板叾浠栫數鑴戞椂闇€鍑嗗鐩稿悓渚濊禆骞惰皟鏁存祴璇曚娇鐢ㄧ殑 WSL 鍚嶇О銆?

鐢熸垚鍣ㄥ include 澶存枃浠惰绠楃紦瀛橀敭锛岄伩鍏嶅彧鏀?header 鍗磋鐢ㄦ棫鐩爣鏂囦欢銆傚畬鏁存簮鐮佸唴 `beta-build-tools/` 鐨勮剼鏈搴斿伐浣滃尯 `build-tools/`锛岄渶杩樺師浠ヤ笂鐩綍缁撴瀯浣跨敤銆傚師 Linux 鏋勫缓鏂规硶浠嶈 `runtime-src/scripts/build.sh` 鍜屼笂娓?`BUILDING.md`銆?
