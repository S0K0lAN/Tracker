# Проверка Focus Flow на OnePlus Ace2

Этот документ начинается в точке, где локально уже установлены зависимости и
собран проверяемый `aarch64` debug APK. Он предназначен для ручного smoke на
физическом OnePlus Ace2, а не подтверждает готовность релиза в Google Play.

## Зафиксированное окружение сборки

- Rust 1.98.0;
- Android SDK Platform 36;
- Android Build Tools 35.0.0 (AGP) и 36.1.0 (явная сборка приложения);
- Android NDK 29.0.14206865;
- Android SDK Command-line Tools 22.0;
- ADB / Platform Tools 37.0.1;
- OpenJDK 17;
- Gradle Wrapper 8.14.3;
- Tauri CLI и API из `package-lock.json`.

Локальные Rust, Android SDK/NDK и проектные кэши располагаются в
`Tracker/.tooling`; скрипты рассчитаны на Linux x86_64.
`mobile-env.sh` и `android-verify.sh` не загружают и не обновляют toolchains:
отсутствие компонента завершается понятной ошибкой. Первый
запуск `android-build.sh` может дозагрузить зафиксированные Cargo/Gradle-
зависимости в эти проектные caches.

`mobile-env.sh` проверяет Gradle Wrapper до запуска Gradle:

- `gradle-wrapper.jar` SHA-256:
  `7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172`;
- `gradle-8.14.3-bin.zip` SHA-256 в `gradle-wrapper.properties`:
  `bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531`.

Несовпадение версии, URL или любого checksum останавливает сборку.

### Восстановление отсутствующего `.tooling`

На Ubuntu сначала должен быть установлен OpenJDK 17. Команды ниже выполняйте
из корня `Tracker`; они не используют домашний каталог для Rust, Android или
Gradle caches.

Загрузите `rustup-init` с официального `https://sh.rustup.rs`, предварительно
просмотрите файл, затем установите зафиксированный Rust:

```bash
TRACKER_ROOT="$(pwd -P)"
mkdir -p "$TRACKER_ROOT/.tooling/cargo" "$TRACKER_ROOT/.tooling/rustup"
curl --proto '=https' --tlsv1.2 --fail --show-error --location \
  --output "$TRACKER_ROOT/.tooling/rustup-init" https://sh.rustup.rs
chmod +x "$TRACKER_ROOT/.tooling/rustup-init"
RUSTUP_HOME="$TRACKER_ROOT/.tooling/rustup" \
  CARGO_HOME="$TRACKER_ROOT/.tooling/cargo" \
  "$TRACKER_ROOT/.tooling/rustup-init" -y --profile minimal \
  --default-toolchain none --no-modify-path
RUSTUP_HOME="$TRACKER_ROOT/.tooling/rustup" \
  CARGO_HOME="$TRACKER_ROOT/.tooling/cargo" \
  "$TRACKER_ROOT/.tooling/cargo/bin/rustup" toolchain install 1.98.0 \
  --profile minimal
RUSTUP_HOME="$TRACKER_ROOT/.tooling/rustup" \
  CARGO_HOME="$TRACKER_ROOT/.tooling/cargo" \
  "$TRACKER_ROOT/.tooling/cargo/bin/rustup" target add \
  --toolchain 1.98.0 aarch64-linux-android
```

Скачайте зафиксированные Android SDK Command-line Tools и Platform Tools из
официального репозитория Google, проверьте SHA-256 и распакуйте их. Команды
ниже рассчитаны на свежий `.tooling/android-sdk`:

```bash
TRACKER_ROOT="$(pwd -P)"
ANDROID_SDK="$TRACKER_ROOT/.tooling/android-sdk"
CMDLINE_ARCHIVE="$TRACKER_ROOT/.tooling/commandlinetools-linux-15859902_latest.zip"
PLATFORM_ARCHIVE="$TRACKER_ROOT/.tooling/platform-tools_r37.0.1-linux.zip"
mkdir -p "$ANDROID_SDK/cmdline-tools"
curl --proto '=https' --tlsv1.2 --fail --show-error --location \
  --output "$CMDLINE_ARCHIVE" \
  https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip
printf '%s  %s\n' \
  '4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583' \
  "$CMDLINE_ARCHIVE" | sha256sum --check
unzip -q "$CMDLINE_ARCHIVE" -d "$ANDROID_SDK/cmdline-tools"
mv "$ANDROID_SDK/cmdline-tools/cmdline-tools" \
  "$ANDROID_SDK/cmdline-tools/latest"
curl --proto '=https' --tlsv1.2 --fail --show-error --location \
  --output "$PLATFORM_ARCHIVE" \
  https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip
printf '%s  %s\n' \
  'd230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1' \
  "$PLATFORM_ARCHIVE" | sha256sum --check
unzip -q "$PLATFORM_ARCHIVE" -d "$ANDROID_SDK"
```

Затем установите остальные точные компоненты и примите лицензии интерактивно:

```bash
TRACKER_ROOT="$(pwd -P)"
ANDROID_SDK="$TRACKER_ROOT/.tooling/android-sdk"
SDKMANAGER="$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager"
"$SDKMANAGER" --sdk_root="$ANDROID_SDK" --licenses
"$SDKMANAGER" --sdk_root="$ANDROID_SDK" \
  "platforms;android-36" \
  "build-tools;35.0.0" \
  "build-tools;36.1.0" \
  "ndk;29.0.14206865"
```

JavaScript-зависимости восстанавливаются зафиксированным lockfile, при этом
npm cache также можно оставить внутри проекта:

```bash
TRACKER_ROOT="$(pwd -P)"
npm_config_cache="$TRACKER_ROOT/.tooling/npm-cache" npm ci
```

После установки снова запустите `bash scripts/mobile-env.sh`. Скрипт проверит
версии и наличие Android target до начала сборки.

Debug-keystore создаётся автоматически внутри `Tracker/.tooling` при первой
сборке. Он не попадает в Git; не удаляйте его между обновлениями приложения,
иначе Android не позволит установить новую APK поверх предыдущей.

Проверить окружение из корня `Tracker`:

```bash
bash scripts/mobile-env.sh
```

Для текущей shell-сессии:

```bash
source scripts/mobile-env.sh
```

Скрипт задаёт `JAVA_HOME`, `RUSTUP_HOME`, `CARGO_HOME`, `ANDROID_HOME`,
`ANDROID_SDK_ROOT`, `NDK_HOME`, `GRADLE_USER_HOME` и `PATH`, не используя
домашний каталог как место проектных зависимостей.

## Сборка и статическая проверка APK

```bash
scripts/android-build.sh
```

Команда собирает только debug APK для `arm64-v8a`, находит свежий артефакт и
сразу запускает:

- проверку debug-подписи через `apksigner`;
- проверку ZIP/16 KiB alignment через `zipalign`;
- проверку package name, `minSdk`, `targetSdk` и permissions через `aapt`;
- проверку, что в APK нет ABI кроме `arm64-v8a`.

Permission allowlist APK ограничен `android.permission.INTERNET` и внутренним
`${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, который AndroidX
создаёт с уровнем защиты `signature`. Доступ к файлам идёт через системный SAF
и не требует широких storage permissions; неожиданный permission останавливает
`android-verify.sh`.

Отдельно повторить проверку можно так:

```bash
scripts/android-verify.sh src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Используйте фактический путь, напечатанный build-скриптом, если имя артефакта
отличается.

Проверенный 2 сентября 2026 года артефакт для передачи на устройство:

- путь: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`;
- размер: `144211302` bytes;
- SHA-256:
  `e02a078781fdb28314b287997ee8bb7a90ddae1d04e5f91945a6010ad390fa80`;
- package: `io.github.s0k0lan.focusflow.debug`;
- debug signer SHA-1: `b79d899dcdd371316cd013f4a74aa985788ec89e`.

## Подготовка OnePlus Ace2

OnePlus Ace2 поставлялся с ColorOS 13 на Android 13 и 64-битным Snapdragon
8+ Gen 1, поэтому целевой ABI — `arm64-v8a`.

1. Зарядите телефон и подключите его качественным USB data-кабелем.
2. Откройте «Настройки → Об устройстве → Версия» и нажмите номер сборки семь
   раз, пока ColorOS не подтвердит режим разработчика. Названия пунктов могут
   немного отличаться после обновления ColorOS.
3. Откройте «Настройки → Дополнительные настройки → Для разработчиков» и
   включите «Отладка по USB».
4. Разблокируйте телефон, выберите USB-режим «Передача файлов» и подтвердите
   RSA fingerprint этого компьютера. Не выбирайте постоянное доверие на чужом
   компьютере.
5. Если обычный `adb install` блокируется политикой ColorOS, временно включите
   «Установка через USB» в параметрах разработчика. После теста отключите её.

Проверить соединение:

```bash
source scripts/mobile-env.sh
adb kill-server
adb start-server
adb devices -l
```

Статус должен быть `device`. При `unauthorized` разблокируйте экран и примите
RSA-запрос. При пустом списке смените USB-кабель/порт и повторно выберите
«Передача файлов».

Зафиксировать характеристики тестового устройства:

```bash
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk
adb shell getprop ro.product.cpu.abi
```

Последняя команда должна вернуть `arm64-v8a`.

## Установка и запуск

Задайте путь, который напечатал `android-build.sh`:

```bash
APK_PATH="src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
adb install -r "$APK_PATH"
```

Несмотря на имя каталога `universal`, verifier подтверждает, что эта сборка
содержит только `arm64-v8a`.

`-r` обновляет уже установленную debug-сборку и сохраняет её приватные данные.
Не удаляйте приложение перед обновлением: uninstall удаляет локальный snapshot.

Получить package name и запустить приложение:

```bash
PACKAGE_NAME="$(aapt dump badging "$APK_PATH" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
adb shell monkey -p "$PACKAGE_NAME" -c android.intent.category.LAUNCHER 1
```

## Логи и воспроизведение сбоя

Перед сценарием очистите старый logcat:

```bash
adb logcat --clear
adb shell am force-stop "$PACKAGE_NAME"
adb shell monkey -p "$PACKAGE_NAME" -c android.intent.category.LAUNCHER 1
adb logcat | tee .tooling/oneplus-ace2-logcat.txt
```

Воспроизведите проблему, запишите локальное время и завершите `logcat` через
`Ctrl+C`. Не публикуйте лог без просмотра: сторонние Android-компоненты могут
записать идентификаторы аккаунта или устройства.

## Обязательный smoke-checklist

### Установка, lifecycle и local-first

- [ ] Первый запуск открывается без белого/чёрного экрана и без crash dialog.
- [ ] Демо-данные отображаются, все девять маршрутов открываются.
- [ ] Новая задача сохраняется, затем остаётся после force-stop и запуска:

  ```bash
  adb shell am force-stop "$PACKAGE_NAME"
  adb shell monkey -p "$PACKAGE_NAME" -c android.intent.category.LAUNCHER 1
  ```

- [ ] Повторный `adb install -r "$APK_PATH"` сохраняет созданную задачу.
- [ ] В авиарежиме можно создавать, изменять, завершать и восстанавливать
  задачи; ошибка сети не откатывает локальные действия.
- [ ] После возврата сети приложение продолжает работать без reload/crash.

### Основные продуктовые правила

- [ ] Обычная задача без срока создаётся во «Входящих».
- [ ] Одной кнопкой создаётся задача «Весь день» на локальную дату.
- [ ] Длительность и дедлайн взаимно исключаются.
- [ ] Дедлайн нельзя сохранить без начала; срочность отсутствует без дедлайна.
- [ ] Дедлайновая полоса проходит по всем дням диапазона в месяце, неделе,
  трёх днях и дне.
- [ ] Выполненная задача остаётся в календаре.
- [ ] Архивные и удалённые задачи в календарь не попадают.
- [ ] JSON import показывает preview и не меняет данные до подтверждения.
- [ ] «Скачать копию» открывает SAF picker; выбранный документ содержит JSON,
  а закрытие/Back возвращает отмену без ложного сообщения об успехе.
- [ ] Вложение выбирается через Android picker, остаётся доступным после
  force-stop и `adb install -r`; приватный snapshot не содержит inline data URL.
- [ ] PDF открывается через системный chooser/viewer (`ACTION_VIEW`), а
  «Скачать» сохраняет его через SAF. Отмена системных экранов не приводит к
  crash или сообщению об успешном сохранении.
- [ ] «Надиктовать задачу» запускает нативный recognizer с `ru-RU`; результат,
  отмена, отсутствие recognizer и отказ дают различимые состояния и сохраняют
  ручной fallback.
- [ ] Pomodoro корректно восстанавливает оставшееся время после сворачивания.

### Google Drive

- [ ] На устройстве доступны Google Play Services:

  ```bash
  adb shell pm list packages com.google.android.gms
  ```

- [ ] «Войти через Google» открывает системный экран аккаунта, а не страницу
  внутри WebView; отмена и отказ возвращают понятное состояние без потери данных.
- [ ] После входа «Отправить» создаёт `focus-flow-data.json` в `appDataFolder`,
  а «Получить» восстанавливает тестовое изменение на другой локальной копии.
- [ ] Отключение очищает локальную краткоживущую сессию; после перезапуска
  приложение просит продолжить вход и не содержит token в экспортируемом JSON.

### Mobile UX/UI

- [ ] Status bar, фронтальная камера/cutout и скруглённые края не перекрывают
  header даже при fallback inset, если WebView не отдаёт CSS `env()`.
- [ ] Нижняя навигация находится выше gesture area и не обрезана.
- [ ] На экранах нет горизонтального overflow или случайного масштабирования.
- [ ] Кнопки и строки удобно нажимаются одним пальцем; нет двойных срабатываний.
- [ ] Экранная клавиатура не скрывает активное поле и кнопки сохранения.
- [ ] Системная кнопка/жест Back сначала закрывает viewer, редактор и sidebar,
  затем возвращает предыдущий маршрут и только потом выходит из приложения.
- [ ] Светлая, тёмная и системная темы, акценты, масштаб шрифта 120% и reduced
  motion сохраняют контраст и не ломают layout.
- [ ] Переключение темы обновляет цвет и контраст иконок status/navigation bars
  без светлой вспышки и без перезапуска Activity.
- [ ] Поворот portrait → landscape → portrait не теряет несохранённый текст и
  не дублирует действия.
- [ ] Свайпы календаря не конфликтуют с системным жестом Back.
- [ ] После десяти минут активной работы и нескольких переходов нет заметного
  роста задержки, мерцания или перегрева.

### Security/manifest

- [ ] `aapt dump permissions "$APK_PATH"` показывает только `INTERNET` и
  внутренний `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.
- [ ] Внутренний permission имеет `signature` protection; нет
  `READ_MEDIA_*`, `READ/WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO` или broad file
  access. SAF, recognizer и временный `content://` grant работают без них.

## Google Drive OAuth на Android

Android APK не запускает Google Identity Services JavaScript внутри WebView.
Он использует нативный `AuthorizationClient`, зарегистрированный как Tauri-
plugin, запрашивает только `https://www.googleapis.com/auth/drive.appdata` и
передаёт краткоживущий access token общему Drive runtime только в памяти.

Для корректного Android smoke необходимы отдельные внешние данные:

1. включённый Google Drive API;
2. OAuth client типа Android с package
   `io.github.s0k0lan.focusflow.debug`;
3. SHA-1 именно текущего debug-сертификата — его печатает
   `android-verify.sh` в поле `Signer #1 certificate SHA-1 digest`;
4. тестовый Google-аккаунт в OAuth consent screen, пока приложение находится
   в режиме Testing;
5. Google Play Services на OnePlus Ace2.

Если команда `adb shell pm list packages com.google.android.gms` ничего не
возвращает, нативный вход корректно будет недоступен. Это не мешает local-first
функциям, но для Drive smoke потребуется прошивка/устройство с официально
работающими Google Play Services.

До настройки credential и live проверки отмечайте Google Drive Android как
«реализовано, но не проверено с реальным аккаунтом». Browser OAuth и его web
client ID остаются отдельной конфигурацией. Для release application ID и
production-сертификата создаётся отдельный Android OAuth client.

## Результат теста

Для передачи отчёта приложите:

- commit SHA и SHA-256 APK из `android-verify.sh`;
- модель, Android/ColorOS version и ABI;
- пройденные/непройденные пункты checklist;
- точные шаги воспроизведения;
- screenshot/screen recording;
- очищенный от чувствительных данных фрагмент logcat.
