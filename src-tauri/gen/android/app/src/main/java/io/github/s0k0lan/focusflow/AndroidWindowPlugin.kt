package io.github.s0k0lan.focusflow

import android.app.Activity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class AndroidWindowPlugin(private val activity: Activity) : Plugin(activity) {
  /**
   * JS contract:
   * invoke("plugin:android-window|safe_area_insets")
   *   -> { top: number, right: number, bottom: number, left: number }
   * Values are CSS pixels / Android density-independent pixels.
   */
  @Command
  fun safeAreaInsets(invoke: Invoke) {
    activity.runOnUiThread {
      val decorView = activity.window?.decorView
      if (decorView == null) {
        invoke.reject("The Android window is not available yet", ERROR_UNAVAILABLE)
        return@runOnUiThread
      }

      val rootInsets = decorView.rootWindowInsets
      if (rootInsets == null) {
        ViewCompat.requestApplyInsets(decorView)
        invoke.reject("Window insets are not available yet", ERROR_UNAVAILABLE)
        return@runOnUiThread
      }

      val insets = WindowInsetsCompat
        .toWindowInsetsCompat(rootInsets, decorView)
        .getInsets(
          WindowInsetsCompat.Type.systemBars() or
            WindowInsetsCompat.Type.displayCutout(),
        )
      val density = activity.resources.displayMetrics.density
      val converted = AndroidWindowValidation.toDpInsets(
        insets.top,
        insets.right,
        insets.bottom,
        insets.left,
        density,
      )
      if (converted == null) {
        invoke.reject("Window insets are invalid", ERROR_UNAVAILABLE)
        return@runOnUiThread
      }

      val response = JSObject()
      response.put("top", converted.top)
      response.put("right", converted.right)
      response.put("bottom", converted.bottom)
      response.put("left", converted.left)
      invoke.resolve(response)
    }
  }

  /**
   * JS contract:
   * invoke("plugin:android-window|set_system_bar_appearance", { darkTheme })
   * resolves without a value after both icon appearance flags are applied.
   */
  @Command
  fun setSystemBarAppearance(invoke: Invoke) {
    val darkTheme = AndroidWindowValidation.parseDarkTheme(
      invoke.getArgs().opt("darkTheme"),
    )
    if (darkTheme == null) {
      invoke.reject("darkTheme must be a boolean", ERROR_UNAVAILABLE)
      return
    }

    activity.runOnUiThread {
      try {
        val window = activity.window
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        val useDarkIcons = !darkTheme
        controller.isAppearanceLightStatusBars = useDarkIcons
        controller.isAppearanceLightNavigationBars = useDarkIcons
        invoke.resolve()
      } catch (_: Exception) {
        invoke.reject("System bar appearance is unavailable", ERROR_UNAVAILABLE)
      }
    }
  }

  companion object {
    private const val ERROR_UNAVAILABLE = "unavailable"
  }
}

internal data class SafeAreaInsets(
  val top: Double,
  val right: Double,
  val bottom: Double,
  val left: Double,
)

internal object AndroidWindowValidation {
  private const val MAX_INSET_DP = 4096.0

  fun toDpInsets(
    topPx: Int,
    rightPx: Int,
    bottomPx: Int,
    leftPx: Int,
    density: Float,
  ): SafeAreaInsets? {
    if (!density.isFinite() || density <= 0f) {
      return null
    }

    val physicalInsets = intArrayOf(topPx, rightPx, bottomPx, leftPx)
    if (physicalInsets.any { it < 0 }) {
      return null
    }

    val converted = physicalInsets.map { it.toDouble() / density.toDouble() }
    if (converted.any { !it.isFinite() || it < 0.0 || it > MAX_INSET_DP }) {
      return null
    }

    return SafeAreaInsets(
      top = converted[0],
      right = converted[1],
      bottom = converted[2],
      left = converted[3],
    )
  }

  fun parseDarkTheme(value: Any?): Boolean? = value as? Boolean
}
