#!/usr/bin/env bash

# This file is intentionally safe to source. It does not change shell options
# and keeps every project-owned tool/cache below Tracker/.tooling.

_focus_flow_mobile_env_error() {
  printf 'mobile-env: %s\n' "$1" >&2
  return 1
}

_focus_flow_prepend_path() {
  local directory="$1"
  case ":${PATH:-}:" in
    *":${directory}:"*) ;;
    *) PATH="${directory}${PATH:+:${PATH}}" ;;
  esac
}

_focus_flow_mobile_env_setup() {
  local script_directory repository_root tooling_directory java_binary java_home
  local rust_version adb_version cmdline_tools_version java_major gradle_wrapper_checksum

  script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)" || return 1
  repository_root="$(cd -- "${script_directory}/.." && pwd -P)" || return 1
  tooling_directory="${repository_root}/.tooling"

  [[ -f "${repository_root}/package.json" ]] \
    || _focus_flow_mobile_env_error "не найден package.json в ${repository_root}; запускайте скрипт из checkout Focus Flow" \
    || return 1
  [[ -d "${tooling_directory}" ]] \
    || _focus_flow_mobile_env_error "не найден ${tooling_directory}; установите локальные Rust и Android SDK по docs/android-device-testing.md" \
    || return 1

  export FOCUS_FLOW_REPO_ROOT="${repository_root}"
  export FOCUS_FLOW_TOOLING_DIR="${tooling_directory}"
  export FOCUS_FLOW_RUST_VERSION="1.98.0"
  export FOCUS_FLOW_ANDROID_PLATFORM="36"
  export FOCUS_FLOW_ANDROID_BUILD_TOOLS_VERSION="36.1.0"
  export FOCUS_FLOW_ANDROID_REQUIRED_BUILD_TOOLS_VERSION="35.0.0"
  export FOCUS_FLOW_ANDROID_NDK_VERSION="29.0.14206865"
  export FOCUS_FLOW_ANDROID_CMDLINE_TOOLS_VERSION="22.0"
  export FOCUS_FLOW_ADB_VERSION="37.0.1-15733141"
  export FOCUS_FLOW_GRADLE_WRAPPER_VERSION="8.14.3"
  export FOCUS_FLOW_GRADLE_WRAPPER_JAR_SHA256="7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172"
  export FOCUS_FLOW_GRADLE_DISTRIBUTION_SHA256="bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531"

  [[ -f "${repository_root}/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar" ]] \
    || _focus_flow_mobile_env_error "не найден Gradle wrapper ${FOCUS_FLOW_GRADLE_WRAPPER_VERSION}" \
    || return 1
  command -v sha256sum >/dev/null 2>&1 \
    || _focus_flow_mobile_env_error "не найден sha256sum для проверки Gradle wrapper" \
    || return 1
  gradle_wrapper_checksum="$(sha256sum -- "${repository_root}/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar" | awk '{ print $1 }')"
  [[ "${gradle_wrapper_checksum}" == "${FOCUS_FLOW_GRADLE_WRAPPER_JAR_SHA256}" ]] \
    || _focus_flow_mobile_env_error "Gradle wrapper не соответствует официальному ${FOCUS_FLOW_GRADLE_WRAPPER_VERSION}: ${gradle_wrapper_checksum:-checksum недоступен}" \
    || return 1
  grep -Fxq \
    "distributionUrl=https\\://services.gradle.org/distributions/gradle-${FOCUS_FLOW_GRADLE_WRAPPER_VERSION}-bin.zip" \
    "${repository_root}/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties" \
    || _focus_flow_mobile_env_error "Gradle distribution URL не закреплён на ${FOCUS_FLOW_GRADLE_WRAPPER_VERSION}" \
    || return 1
  grep -Fxq \
    "distributionSha256Sum=${FOCUS_FLOW_GRADLE_DISTRIBUTION_SHA256}" \
    "${repository_root}/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties" \
    || _focus_flow_mobile_env_error "Gradle distribution checksum не соответствует ${FOCUS_FLOW_GRADLE_WRAPPER_VERSION}" \
    || return 1

  export RUSTUP_HOME="${tooling_directory}/rustup"
  export CARGO_HOME="${tooling_directory}/cargo"
  [[ -x "${CARGO_HOME}/bin/rustup" ]] \
    || _focus_flow_mobile_env_error "не найден ${CARGO_HOME}/bin/rustup; установите Rust ${FOCUS_FLOW_RUST_VERSION} внутрь .tooling" \
    || return 1
  if [[ -d "${RUSTUP_HOME}/toolchains/${FOCUS_FLOW_RUST_VERSION}-x86_64-unknown-linux-gnu" ]]; then
    export RUSTUP_TOOLCHAIN="${FOCUS_FLOW_RUST_VERSION}"
  elif [[ -d "${RUSTUP_HOME}/toolchains/stable-x86_64-unknown-linux-gnu" ]]; then
    export RUSTUP_TOOLCHAIN="stable"
  else
    _focus_flow_mobile_env_error "не найден Rust ${FOCUS_FLOW_RUST_VERSION} в ${RUSTUP_HOME}/toolchains; выполните команды восстановления из docs/android-device-testing.md"
    return 1
  fi

  export ANDROID_HOME="${tooling_directory}/android-sdk"
  export ANDROID_SDK_ROOT="${ANDROID_HOME}"
  export ANDROID_USER_HOME="${tooling_directory}/android-user"
  export ANDROID_BUILD_TOOLS_HOME="${ANDROID_HOME}/build-tools/${FOCUS_FLOW_ANDROID_BUILD_TOOLS_VERSION}"
  export NDK_HOME="${ANDROID_HOME}/ndk/${FOCUS_FLOW_ANDROID_NDK_VERSION}"
  export ANDROID_NDK_HOME="${NDK_HOME}"
  [[ -f "${ANDROID_HOME}/platforms/android-${FOCUS_FLOW_ANDROID_PLATFORM}/android.jar" ]] \
    || _focus_flow_mobile_env_error "не найдена SDK Platform ${FOCUS_FLOW_ANDROID_PLATFORM}; установите platforms;android-${FOCUS_FLOW_ANDROID_PLATFORM}" \
    || return 1
  [[ -x "${ANDROID_BUILD_TOOLS_HOME}/aapt" ]] \
    || _focus_flow_mobile_env_error "не найдены Android Build Tools ${FOCUS_FLOW_ANDROID_BUILD_TOOLS_VERSION} в ${ANDROID_BUILD_TOOLS_HOME}" \
    || return 1
  [[ -x "${ANDROID_BUILD_TOOLS_HOME}/apksigner" ]] \
    || _focus_flow_mobile_env_error "Android Build Tools ${FOCUS_FLOW_ANDROID_BUILD_TOOLS_VERSION} не содержат apksigner" \
    || return 1
  [[ -x "${ANDROID_BUILD_TOOLS_HOME}/zipalign" ]] \
    || _focus_flow_mobile_env_error "Android Build Tools ${FOCUS_FLOW_ANDROID_BUILD_TOOLS_VERSION} не содержат zipalign" \
    || return 1
  [[ -x "${ANDROID_HOME}/build-tools/${FOCUS_FLOW_ANDROID_REQUIRED_BUILD_TOOLS_VERSION}/aapt" ]] \
    || _focus_flow_mobile_env_error "не найдены обязательные для AGP Android Build Tools ${FOCUS_FLOW_ANDROID_REQUIRED_BUILD_TOOLS_VERSION}" \
    || return 1
  [[ -x "${ANDROID_HOME}/platform-tools/adb" ]] \
    || _focus_flow_mobile_env_error "не найден ADB; установите platform-tools в ${ANDROID_HOME}" \
    || return 1
  [[ -x "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" ]] \
    || _focus_flow_mobile_env_error "не найдены Android Command-line Tools ${FOCUS_FLOW_ANDROID_CMDLINE_TOOLS_VERSION}" \
    || return 1
  cmdline_tools_version="$(awk -F= '$1 == "Pkg.Revision" { print $2; exit }' "${ANDROID_HOME}/cmdline-tools/latest/source.properties" 2>/dev/null)"
  [[ "${cmdline_tools_version}" == "${FOCUS_FLOW_ANDROID_CMDLINE_TOOLS_VERSION}" ]] \
    || _focus_flow_mobile_env_error "ожидались Android Command-line Tools ${FOCUS_FLOW_ANDROID_CMDLINE_TOOLS_VERSION}, найдены ${cmdline_tools_version:-неизвестно}" \
    || return 1
  [[ -x "${NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/clang" ]] \
    || _focus_flow_mobile_env_error "не найден Android NDK ${FOCUS_FLOW_ANDROID_NDK_VERSION} в ${NDK_HOME}" \
    || return 1

  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" && -x "${JAVA_HOME}/bin/javac" ]]; then
    java_home="${JAVA_HOME}"
  else
    java_binary="$(command -v java 2>/dev/null || true)"
    [[ -n "${java_binary}" ]] \
      || _focus_flow_mobile_env_error "не найдена Java 17; установите OpenJDK 17" \
      || return 1
    java_binary="$(readlink -f -- "${java_binary}")"
    java_home="$(cd -- "$(dirname -- "${java_binary}")/.." && pwd -P)" || return 1
  fi
  [[ -x "${java_home}/bin/javac" ]] \
    || _focus_flow_mobile_env_error "JAVA_HOME=${java_home} не содержит javac; требуется полный JDK 17" \
    || return 1
  export JAVA_HOME="${java_home}"
  java_major="$("${JAVA_HOME}/bin/javac" -version 2>&1 | awk '{ split($2, version, "."); print version[1] }')"
  [[ "${java_major}" == '17' ]] \
    || _focus_flow_mobile_env_error "ожидался JDK 17, найден javac ${java_major:-неизвестно}; задайте JAVA_HOME на OpenJDK 17" \
    || return 1

  export GRADLE_USER_HOME="${tooling_directory}/gradle"
  export GRADLE_OPTS="${GRADLE_OPTS:+${GRADLE_OPTS} }-Dorg.gradle.internal.http.connectionTimeout=120000 -Dorg.gradle.internal.http.socketTimeout=120000"
  export TMPDIR="${tooling_directory}/tmp"
  mkdir -p -- "${ANDROID_USER_HOME}" "${GRADLE_USER_HOME}" "${TMPDIR}" || return 1

  _focus_flow_prepend_path "${NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin"
  _focus_flow_prepend_path "${ANDROID_BUILD_TOOLS_HOME}"
  _focus_flow_prepend_path "${ANDROID_HOME}/cmdline-tools/latest/bin"
  _focus_flow_prepend_path "${ANDROID_HOME}/platform-tools"
  _focus_flow_prepend_path "${CARGO_HOME}/bin"
  _focus_flow_prepend_path "${JAVA_HOME}/bin"
  export PATH

  rust_version="$(rustc --version 2>/dev/null | awk '{print $2}')"
  [[ "${rust_version}" == "${FOCUS_FLOW_RUST_VERSION}" ]] \
    || _focus_flow_mobile_env_error "ожидался Rust ${FOCUS_FLOW_RUST_VERSION}, найден ${rust_version:-неизвестно}; обновите локальный toolchain осознанно" \
    || return 1
  rustup target list --installed | grep -Fxq 'aarch64-linux-android' \
    || _focus_flow_mobile_env_error "не установлен Rust target aarch64-linux-android; добавьте его локальным rustup" \
    || return 1

  adb_version="$(adb version 2>/dev/null | awk '/^Version / { print $2; exit }')"
  [[ "${adb_version}" == "${FOCUS_FLOW_ADB_VERSION}" ]] \
    || _focus_flow_mobile_env_error "ожидался ADB ${FOCUS_FLOW_ADB_VERSION}, найден ${adb_version:-неизвестно}; проверьте platform-tools" \
    || return 1
}

if _focus_flow_mobile_env_setup; then
  _focus_flow_mobile_env_status=0
else
  _focus_flow_mobile_env_status=$?
fi

if (( _focus_flow_mobile_env_status != 0 )); then
  unset -f _focus_flow_mobile_env_error _focus_flow_prepend_path _focus_flow_mobile_env_setup
  return "${_focus_flow_mobile_env_status}" 2>/dev/null || exit "${_focus_flow_mobile_env_status}"
fi

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf 'Focus Flow mobile environment is ready.\n'
  printf '  repository:  %s\n' "${FOCUS_FLOW_REPO_ROOT}"
  printf '  Java:       %s\n' "$(java -version 2>&1 | sed -n '1p')"
  printf '  Rust:       %s\n' "$(rustc --version)"
  printf '  SDK:        android-%s\n' "${FOCUS_FLOW_ANDROID_PLATFORM}"
  printf '  Build Tools: %s\n' "${FOCUS_FLOW_ANDROID_BUILD_TOOLS_VERSION}"
  printf '  NDK:        %s\n' "${FOCUS_FLOW_ANDROID_NDK_VERSION}"
  printf '  CLI Tools:  %s\n' "${FOCUS_FLOW_ANDROID_CMDLINE_TOOLS_VERSION}"
  printf '  ADB:        %s\n' "$(adb version | awk '/^Version / { print $2; exit }')"
  printf '  Gradle wrapper: %s (SHA-256 verified)\n' "${FOCUS_FLOW_GRADLE_WRAPPER_VERSION}"
fi

unset _focus_flow_mobile_env_status
unset -f _focus_flow_mobile_env_error _focus_flow_prepend_path _focus_flow_mobile_env_setup
