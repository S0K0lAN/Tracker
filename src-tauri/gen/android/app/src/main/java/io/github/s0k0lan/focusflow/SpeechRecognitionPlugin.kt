package io.github.s0k0lan.focusflow

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.atomic.AtomicBoolean

@TauriPlugin
class SpeechRecognitionPlugin(private val activity: Activity) : Plugin(activity) {
  private val recognitionInProgress = AtomicBoolean(false)

  /**
   * JS contract:
   * invoke("plugin:speech-recognition|recognize", { locale: "ru-RU" })
   *   -> { status: "recognized", transcript: string } | { status: "cancelled" }
   */
  @Command
  fun recognize(invoke: Invoke) {
    val locale = invoke.getArgs().optString("locale")
    if (!SpeechRecognitionValidation.isValidLocale(locale)) {
      invoke.reject("The recognition locale is invalid", ERROR_UNAVAILABLE)
      return
    }

    if (!recognitionInProgress.compareAndSet(false, true)) {
      invoke.reject("Speech recognition is already in progress", ERROR_UNAVAILABLE)
      return
    }

    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(
        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
      )
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, locale)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, MAX_RESULTS)
    }

    try {
      startActivityForResult(invoke, intent, "onRecognitionResult")
    } catch (_: ActivityNotFoundException) {
      reject(invoke, ERROR_NO_ACTIVITY, "No speech recognition activity is available")
    } catch (_: Exception) {
      reject(invoke, ERROR_UNAVAILABLE, "Speech recognition could not be opened")
    }
  }

  @ActivityCallback
  fun onRecognitionResult(invoke: Invoke, activityResult: ActivityResult) {
    if (activityResult.resultCode == Activity.RESULT_CANCELED) {
      resolveCancelled(invoke)
      return
    }

    if (activityResult.resultCode != Activity.RESULT_OK) {
      reject(invoke, ERROR_UNAVAILABLE, "Speech recognition returned an unexpected result")
      return
    }

    val transcript = activityResult.data
      ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
      ?.asSequence()
      ?.map(String::trim)
      ?.firstOrNull(String::isNotEmpty)

    if (transcript == null) {
      reject(invoke, ERROR_NO_MATCH, "Speech recognition returned no match")
      return
    }

    recognitionInProgress.set(false)
    val response = JSObject()
    response.put("status", STATUS_RECOGNIZED)
    response.put("transcript", transcript)
    invoke.resolve(response)
  }

  private fun resolveCancelled(invoke: Invoke) {
    recognitionInProgress.set(false)
    val response = JSObject()
    response.put("status", STATUS_CANCELLED)
    invoke.resolve(response)
  }

  private fun reject(invoke: Invoke, code: String, message: String) {
    recognitionInProgress.set(false)
    invoke.reject(message, code)
  }

  companion object {
    private const val MAX_RESULTS = 5
    private const val STATUS_RECOGNIZED = "recognized"
    private const val STATUS_CANCELLED = "cancelled"

    private const val ERROR_NO_ACTIVITY = "no-activity"
    private const val ERROR_NO_MATCH = "no-match"
    private const val ERROR_UNAVAILABLE = "unavailable"
  }
}

internal object SpeechRecognitionValidation {
  private const val MAX_LOCALE_LENGTH = 35
  private val localePattern = Regex(
    "^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?" +
      "(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*",
  )

  fun isValidLocale(locale: String): Boolean =
    locale.length in 2..MAX_LOCALE_LENGTH && localePattern.matches(locale)
}
