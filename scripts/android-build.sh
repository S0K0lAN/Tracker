#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd -P)"

# shellcheck source=mobile-env.sh
source "${SCRIPT_DIRECTORY}/mobile-env.sh"
cd -- "${REPOSITORY_ROOT}"

fail() {
  printf 'android-build: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail 'не найден Node.js 18.19 или новее'
command -v npm >/dev/null 2>&1 || fail 'не найден npm'
node_version="$(node -p 'process.versions.node')"
IFS=. read -r node_major node_minor _ <<<"${node_version}"
if (( node_major < 18 || (node_major == 18 && node_minor < 19) )); then
  fail "ожидался Node.js 18.19 или новее, найден ${node_version}"
fi
[[ -x "${REPOSITORY_ROOT}/node_modules/.bin/tauri" ]] \
  || fail 'не установлен локальный Tauri CLI; выполните npm ci в корне Tracker'
[[ -f "${REPOSITORY_ROOT}/src-tauri/tauri.conf.json" ]] \
  || fail 'не найден src-tauri/tauri.conf.json; сначала инициализируйте Tauri 2 shell'
[[ -d "${REPOSITORY_ROOT}/src-tauri/gen/android/app" ]] \
  || fail 'Android-проект ещё не создан; выполните npx tauri android init --ci после настройки mobile-env'

if grep -Eq '"identifier"[[:space:]]*:[[:space:]]*"com\.tauri\.dev"' "${REPOSITORY_ROOT}/src-tauri/tauri.conf.json"; then
  fail 'замените шаблонный identifier com.tauri.dev на постоянный application ID до сборки APK'
fi

debug_keystore="${FOCUS_FLOW_TOOLING_DIR}/focus-flow-debug.keystore"
if [[ ! -f "${debug_keystore}" ]]; then
  printf 'Generating project-local Android debug keystore...\n'
  old_umask="$(umask)"
  umask 077
  "${JAVA_HOME}/bin/keytool" -genkeypair -noprompt \
    -keystore "${debug_keystore}" \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -dname 'CN=Android Debug,O=Android,C=US' \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000
  umask "${old_umask}"
fi
chmod 600 -- "${debug_keystore}"
"${JAVA_HOME}/bin/keytool" -list \
  -keystore "${debug_keystore}" \
  -storepass android \
  -alias androiddebugkey >/dev/null \
  || fail 'project-local debug keystore повреждён или использует неожиданные credentials'

printf 'Building Focus Flow aarch64 debug APK with Tauri 2...\n'
build_started_at="$(date +%s)"
"${REPOSITORY_ROOT}/node_modules/.bin/tauri" android build \
  --debug \
  --apk \
  --target aarch64 \
  --ci

apk_output_root="${REPOSITORY_ROOT}/src-tauri/gen/android/app/build/outputs/apk"
[[ -d "${apk_output_root}" ]] || fail "Tauri завершился без каталога APK: ${apk_output_root}"

apk_path="$(
  find "${apk_output_root}" -type f -name '*debug*.apk' -printf '%T@\t%p\n' \
    | sort -nr \
    | awk -F '\t' 'NR == 1 { print $2 }'
)"
[[ -n "${apk_path}" && -f "${apk_path}" ]] || fail 'после сборки не найден debug APK'

apk_modified_at="$(stat -c '%Y' -- "${apk_path}")"
(( apk_modified_at + 2 >= build_started_at )) \
  || fail "найден только устаревший APK: ${apk_path}"

printf 'Built APK: %s\n' "${apk_path}"
"${SCRIPT_DIRECTORY}/android-verify.sh" "${apk_path}"
