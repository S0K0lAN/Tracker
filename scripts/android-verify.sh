#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd -P)"

# shellcheck source=mobile-env.sh
source "${SCRIPT_DIRECTORY}/mobile-env.sh"
cd -- "${REPOSITORY_ROOT}"

fail() {
  printf 'android-verify: %s\n' "$1" >&2
  exit 1
}

if (( $# > 1 )); then
  fail 'использование: scripts/android-verify.sh [путь-к-debug-apk]'
fi

if (( $# == 1 )); then
  apk_path="$1"
  [[ "${apk_path}" == /* ]] || apk_path="${REPOSITORY_ROOT}/${apk_path}"
else
  apk_output_root="${REPOSITORY_ROOT}/src-tauri/gen/android/app/build/outputs/apk"
  [[ -d "${apk_output_root}" ]] || fail 'APK ещё не собран; запустите scripts/android-build.sh'
  apk_path="$(
    find "${apk_output_root}" -type f -name '*debug*.apk' -printf '%T@\t%p\n' \
      | sort -nr \
      | awk -F '\t' 'NR == 1 { print $2 }'
  )"
fi

[[ -n "${apk_path}" && -f "${apk_path}" ]] || fail "файл APK не найден: ${apk_path:-путь не задан}"
apk_path="$(readlink -f -- "${apk_path}")"
case "${apk_path}" in
  "${REPOSITORY_ROOT}"/*) ;;
  *) fail "APK должен находиться внутри Tracker: ${apk_path}" ;;
esac

command -v unzip >/dev/null 2>&1 || fail 'не найден unzip, необходимый для проверки ABI'
command -v sha256sum >/dev/null 2>&1 || fail 'не найден sha256sum'
command -v apksigner >/dev/null 2>&1 || fail 'не найден apksigner, подпись APK нельзя проверить'
command -v zipalign >/dev/null 2>&1 || fail 'не найден zipalign, выравнивание APK нельзя проверить'
command -v aapt >/dev/null 2>&1 || fail 'не найден aapt, manifest APK нельзя проверить'

mapfile -t packaged_abis < <(
  unzip -Z1 "${apk_path}" \
    | awk -F/ '$1 == "lib" && NF >= 3 && $3 ~ /\.so$/ { print $2 }' \
    | sort -u
)
(( ${#packaged_abis[@]} > 0 )) || fail 'APK не содержит нативную библиотеку Tauri'
if (( ${#packaged_abis[@]} != 1 )) || [[ "${packaged_abis[0]}" != 'arm64-v8a' ]]; then
  fail "ожидался только ABI arm64-v8a, упакованы: ${packaged_abis[*]}"
fi

printf 'Verifying APK: %s\n' "${apk_path}"
printf '  size:   %s bytes\n' "$(stat -c '%s' -- "${apk_path}")"
printf '  sha256: %s\n' "$(sha256sum -- "${apk_path}" | awk '{print $1}')"
printf '  ABI:    arm64-v8a\n'

apksigner verify --verbose --print-certs "${apk_path}" \
  || fail 'подпись APK не прошла проверку'

zipalign -c -P 16 4 "${apk_path}" \
  || fail 'zipalign обнаружил неверное выравнивание APK или нативных библиотек'
printf '  zipalign: 4-byte ZIP and 16 KiB native-page alignment OK\n'

badging="$(aapt dump badging "${apk_path}")" || fail 'aapt не смог прочитать APK'
package_name="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"${badging}")"
min_sdk="$(sed -n "s/^sdkVersion:'\([^']*\)'.*/\1/p" <<<"${badging}")"
target_sdk="$(sed -n "s/^targetSdkVersion:'\([^']*\)'.*/\1/p" <<<"${badging}")"
[[ "${package_name}" == 'io.github.s0k0lan.focusflow.debug' ]] \
  || fail "ожидался package io.github.s0k0lan.focusflow.debug, найден ${package_name:-пусто}"
[[ "${min_sdk}" =~ ^[0-9]+$ ]] || fail "aapt вернул некорректный minSdk: ${min_sdk:-пусто}"
[[ "${min_sdk}" == '24' ]] || fail "ожидался minSdk 24, найден ${min_sdk:-пусто}"
[[ "${target_sdk}" == "${FOCUS_FLOW_ANDROID_PLATFORM}" ]] \
  || fail "ожидался targetSdk ${FOCUS_FLOW_ANDROID_PLATFORM}, найден ${target_sdk:-пусто}"

permissions="$(aapt dump permissions "${apk_path}")" || fail 'aapt не смог прочитать permissions'
mapfile -t requested_permissions < <(
  sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p" <<<"${permissions}"
)
(( ${#requested_permissions[@]} > 0 )) || fail 'APK не объявляет обязательное разрешение INTERNET'
for requested_permission in "${requested_permissions[@]}"; do
  case "${requested_permission}" in
    android.permission.INTERNET|"${package_name}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION") ;;
    *) fail "APK запрашивает неожиданное разрешение: ${requested_permission}" ;;
  esac
done
printf '%s\n' "${requested_permissions[@]}" | grep -Fxq 'android.permission.INTERNET' \
  || fail 'APK не объявляет обязательное разрешение INTERNET'

printf '  package:   %s\n' "${package_name}"
printf '  minSdk:    %s\n' "${min_sdk}"
printf '  targetSdk: %s\n' "${target_sdk}"
printf '  permission: %s\n' "${requested_permissions[@]}"

printf 'Android APK verification passed.\n'
