package io.github.s0k0lan.focusflow

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean

@TauriPlugin
class GoogleAuthorizationPlugin(private val activity: Activity) : Plugin(activity) {
  private val authorizationInProgress = AtomicBoolean(false)

  @Command
  fun authorize(invoke: Invoke) {
    if (!authorizationInProgress.compareAndSet(false, true)) {
      invoke.reject(
        "Google authorization is already in progress",
        ERROR_UNAVAILABLE,
      )
      return
    }

    val request = AuthorizationRequest.builder()
      .setRequestedScopes(listOf(Scope(DRIVE_APPDATA_SCOPE)))
      .setOptOutIncludingGrantedScopes(true)
      .build()

    try {
      Identity.getAuthorizationClient(activity)
        .authorize(request)
        .addOnSuccessListener(activity) { result ->
          if (result.hasResolution()) {
            val pendingIntent = result.pendingIntent
            if (pendingIntent == null) {
              rejectAuthorization(
                invoke,
                ERROR_UNAVAILABLE,
                "Google authorization did not provide a resolution",
              )
              return@addOnSuccessListener
            }

            try {
              startIntentSenderForResult(
                invoke,
                IntentSenderRequest.Builder(pendingIntent.intentSender).build(),
                "onAuthorizationResult",
              )
            } catch (_: Exception) {
              rejectAuthorization(
                invoke,
                ERROR_UNAVAILABLE,
                "Google authorization UI could not be opened",
              )
            }
          } else {
            resolveAuthorization(invoke, result)
          }
        }
        .addOnFailureListener(activity) { error ->
          rejectAuthorization(invoke, error)
        }
        .addOnCanceledListener(activity) {
          rejectAuthorization(
            invoke,
            ERROR_CANCEL,
            "Google authorization was canceled",
          )
        }
    } catch (error: Exception) {
      rejectAuthorization(invoke, error)
    }
  }

  @ActivityCallback
  fun onAuthorizationResult(invoke: Invoke, activityResult: ActivityResult) {
    val data = activityResult.data
    if (data == null) {
      val code = if (activityResult.resultCode == Activity.RESULT_CANCELED) {
        ERROR_CANCEL
      } else {
        ERROR_UNAVAILABLE
      }
      val message = if (code == ERROR_CANCEL) {
        "Google authorization was canceled"
      } else {
        "Google authorization returned no result"
      }
      rejectAuthorization(invoke, code, message)
      return
    }

    try {
      val result = Identity.getAuthorizationClient(activity)
        .getAuthorizationResultFromIntent(data)
      resolveAuthorization(invoke, result)
    } catch (error: Exception) {
      rejectAuthorization(invoke, error)
    }
  }

  @Command
  fun disconnect(invoke: Invoke) {
    val accessToken = invoke.getArgs().optString("accessToken").trim()
    if (accessToken.isEmpty()) {
      invoke.reject("An access token is required to clear authorization", ERROR_CONFIG)
      return
    }

    val request = ClearTokenRequest.builder()
      .setToken(accessToken)
      .build()

    try {
      Identity.getAuthorizationClient(activity)
        .clearToken(request)
        .addOnSuccessListener(activity) {
          invoke.resolve()
        }
        .addOnFailureListener(activity) { error ->
          reject(invoke, error)
        }
        .addOnCanceledListener(activity) {
          invoke.reject("Clearing Google authorization was canceled", ERROR_CANCEL)
        }
    } catch (error: Exception) {
      reject(invoke, error)
    }
  }

  private fun resolveAuthorization(invoke: Invoke, result: AuthorizationResult) {
    if (!result.grantedScopes.contains(DRIVE_APPDATA_SCOPE)) {
      rejectAuthorization(
        invoke,
        ERROR_ACCESS_DENIED,
        "Access to the private Google Drive app folder was not granted",
      )
      return
    }

    val accessToken = result.accessToken?.takeIf { it.isNotBlank() }
    if (accessToken == null) {
      rejectAuthorization(
        invoke,
        ERROR_ACCESS_DENIED,
        "Google authorization returned no access token",
      )
      return
    }

    val response = JSObject()
    response.put("accessToken", accessToken)
    response.put("expiresAt", System.currentTimeMillis() + SAFE_TOKEN_LIFETIME_MS)

    authorizationInProgress.set(false)
    invoke.resolve(response)
  }

  private fun rejectAuthorization(invoke: Invoke, error: Exception) {
    val (code, message) = classify(error)
    rejectAuthorization(invoke, code, message)
  }

  private fun rejectAuthorization(invoke: Invoke, code: String, message: String) {
    authorizationInProgress.set(false)
    invoke.reject(message, code)
  }

  private fun reject(invoke: Invoke, error: Exception) {
    val (code, message) = classify(error)
    invoke.reject(message, code)
  }

  private fun classify(error: Exception): Pair<String, String> {
    if (error is CancellationException) {
      return ERROR_CANCEL to "Google authorization was canceled"
    }

    if (error is SecurityException || error is IllegalArgumentException) {
      return ERROR_CONFIG to "Google authorization is not configured for this application"
    }

    if (error !is ApiException) {
      return ERROR_UNAVAILABLE to "Google authorization is unavailable"
    }

    return when (error.statusCode) {
      CommonStatusCodes.CANCELED ->
        ERROR_CANCEL to "Google authorization was canceled"
      CommonStatusCodes.DEVELOPER_ERROR ->
        ERROR_CONFIG to "Google authorization is not configured for this application"
      CommonStatusCodes.ERROR,
      CommonStatusCodes.INVALID_ACCOUNT,
      CommonStatusCodes.SIGN_IN_REQUIRED,
      -> ERROR_ACCESS_DENIED to "Google account access was not granted"
      else -> ERROR_UNAVAILABLE to "Google authorization is unavailable"
    }
  }

  companion object {
    private const val DRIVE_APPDATA_SCOPE =
      "https://www.googleapis.com/auth/drive.appdata"

    // Google access tokens normally last one hour. Expiring locally five minutes
    // early avoids starting a Drive operation with a token near its boundary.
    private const val SAFE_TOKEN_LIFETIME_MS = 55L * 60L * 1000L

    private const val ERROR_ACCESS_DENIED = "access-denied"
    private const val ERROR_CANCEL = "cancel"
    private const val ERROR_CONFIG = "config"
    private const val ERROR_UNAVAILABLE = "unavailable"
  }
}
