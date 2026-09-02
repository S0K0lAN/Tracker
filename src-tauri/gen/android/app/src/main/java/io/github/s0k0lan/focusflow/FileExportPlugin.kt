package io.github.s0k0lan.focusflow

import android.app.Activity
import android.content.ClipData
import android.content.ActivityNotFoundException
import android.content.Intent
import android.system.Os
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.IOException
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

@TauriPlugin
class FileExportPlugin(private val activity: Activity) : Plugin(activity) {
  private val exportInProgress = AtomicBoolean(false)

  /**
   * JS contract:
   * invoke("plugin:file-export|save_file", { fileName, mimeType, base64Data })
   *   -> { status: "saved" | "cancelled" }
   */
  @Command
  fun saveFile(invoke: Invoke) {
    val args = invoke.getArgs()
    val fileName = args.optString("fileName")
    val mimeType = args.optString("mimeType")
    val base64Data = args.optString("base64Data")

    val validationError = FileExportValidation.validate(fileName, mimeType, base64Data)
    if (validationError != null) {
      invoke.reject(validationError.message, validationError.code)
      return
    }

    if (!exportInProgress.compareAndSet(false, true)) {
      invoke.reject("Another file export is already in progress", ERROR_BUSY)
      return
    }

    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = mimeType
      putExtra(Intent.EXTRA_TITLE, fileName)
    }

    try {
      startActivityForResult(invoke, intent, "onSaveFileResult")
    } catch (_: ActivityNotFoundException) {
      reject(invoke, ERROR_NO_ACTIVITY, "No document provider is available")
    } catch (_: Exception) {
      reject(invoke, ERROR_UNAVAILABLE, "The document picker could not be opened")
    }
  }

  /**
   * JS contract:
   * invoke("plugin:file-export|open_file", {
   *   fileName, mimeType: "application/pdf", base64Data
   * }) -> { status: "opened" }
   */
  @Command
  fun openFile(invoke: Invoke) {
    val args = invoke.getArgs()
    val fileName = args.optString("fileName")
    val mimeType = args.optString("mimeType")
    val base64Data = args.optString("base64Data")

    val validationError = FileExportValidation.validatePdf(fileName, mimeType, base64Data)
    if (validationError != null) {
      invoke.reject(validationError.message, validationError.code)
      return
    }

    if (!exportInProgress.compareAndSet(false, true)) {
      invoke.reject("Another file operation is already in progress", ERROR_BUSY)
      return
    }

    thread(name = "focus-flow-pdf-preview") {
      val previewDirectory = File(activity.cacheDir, PREVIEW_DIRECTORY)
      val previewToken = UUID.randomUUID().toString()
      val previewFile = File(previewDirectory, "$PREVIEW_FILE_PREFIX$previewToken.pdf")
      val temporaryFile = File(previewDirectory, "$PREVIEW_FILE_PREFIX$previewToken.tmp")

      try {
        val bytes = Base64.decode(base64Data, Base64.NO_WRAP)
        if (bytes.size > FileExportValidation.MAX_DECODED_BYTES) {
          reject(invoke, ERROR_PAYLOAD_TOO_LARGE, "The PDF exceeds 16 MiB")
          return@thread
        }

        if (!previewDirectory.exists() && !previewDirectory.mkdirs()) {
          throw IOException("The preview cache directory could not be created")
        }
        if (!previewDirectory.isDirectory) {
          throw IOException("The preview cache path is not a directory")
        }

        // Every external viewer receives a one-time URI. Removing older private
        // previews prevents cache growth and, critically, prevents a viewer
        // holding an old URI grant from observing a later attachment.
        previewDirectory.listFiles()?.forEach { cachedPreview ->
          if (
            cachedPreview.name == LEGACY_PREVIEW_FILE_NAME ||
            cachedPreview.name.startsWith(PREVIEW_FILE_PREFIX)
          ) {
            cachedPreview.delete()
          }
        }
        FileOutputStream(temporaryFile).use { stream ->
          stream.write(bytes)
          stream.flush()
          stream.fd.sync()
        }

        // rename(2) exposes the complete PDF atomically to FileProvider.
        Os.rename(temporaryFile.absolutePath, previewFile.absolutePath)
      } catch (_: Exception) {
        temporaryFile.delete()
        reject(invoke, ERROR_WRITE_FAILED, "The PDF preview could not be written")
        return@thread
      }

      activity.runOnUiThread {
        openPdf(invoke, previewFile)
      }
    }
  }

  private fun openPdf(invoke: Invoke, previewFile: File) {
    try {
      val uri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        previewFile,
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, PDF_MIME_TYPE)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri("Focus Flow PDF", uri)
      }
      activity.startActivity(intent)
      resolve(invoke, STATUS_OPENED)
    } catch (_: ActivityNotFoundException) {
      reject(invoke, ERROR_NO_ACTIVITY, "No PDF viewer is available")
    } catch (_: Exception) {
      reject(invoke, ERROR_UNAVAILABLE, "The PDF viewer could not be opened")
    }
  }

  @ActivityCallback
  fun onSaveFileResult(invoke: Invoke, activityResult: ActivityResult) {
    if (activityResult.resultCode == Activity.RESULT_CANCELED) {
      resolve(invoke, STATUS_CANCELLED)
      return
    }

    if (activityResult.resultCode != Activity.RESULT_OK) {
      reject(invoke, ERROR_UNAVAILABLE, "The document picker returned an unexpected result")
      return
    }

    val uri = activityResult.data?.data
    if (uri == null) {
      reject(invoke, ERROR_UNAVAILABLE, "The document picker returned no destination")
      return
    }

    val base64Data = invoke.getArgs().optString("base64Data")
    thread(name = "focus-flow-file-export") {
      try {
        val bytes = Base64.decode(base64Data, Base64.NO_WRAP)
        if (bytes.size > FileExportValidation.MAX_DECODED_BYTES) {
          reject(invoke, ERROR_PAYLOAD_TOO_LARGE, "The exported file exceeds 16 MiB")
          return@thread
        }

        val stream = activity.contentResolver.openOutputStream(uri, "w")
          ?: throw IOException("The document provider did not open the destination")
        stream.use {
          it.write(bytes)
          it.flush()
        }
        resolve(invoke, STATUS_SAVED)
      } catch (_: Exception) {
        try {
          activity.contentResolver.delete(uri, null, null)
        } catch (_: Exception) {
          // Some providers do not allow deleting a partially created document.
        }
        reject(invoke, ERROR_WRITE_FAILED, "The selected document could not be written")
      }
    }
  }

  private fun resolve(invoke: Invoke, status: String) {
    exportInProgress.set(false)
    val response = JSObject()
    response.put("status", status)
    invoke.resolve(response)
  }

  private fun reject(invoke: Invoke, code: String, message: String) {
    exportInProgress.set(false)
    invoke.reject(message, code)
  }

  companion object {
    private const val STATUS_SAVED = "saved"
    private const val STATUS_CANCELLED = "cancelled"
    private const val STATUS_OPENED = "opened"

    private const val PDF_MIME_TYPE = "application/pdf"
    private const val PREVIEW_DIRECTORY = "focus-flow"
    private const val PREVIEW_FILE_PREFIX = "preview-"
    private const val LEGACY_PREVIEW_FILE_NAME = "preview.pdf"

    private const val ERROR_BUSY = "busy"
    private const val ERROR_NO_ACTIVITY = "no-activity"
    private const val ERROR_PAYLOAD_TOO_LARGE = "payload-too-large"
    private const val ERROR_UNAVAILABLE = "unavailable"
    private const val ERROR_WRITE_FAILED = "write-failed"
  }
}

internal data class FileExportValidationError(val code: String, val message: String)

internal object FileExportValidation {
  const val MAX_DECODED_BYTES = 16 * 1024 * 1024
  private const val MAX_FILE_NAME_UTF8_BYTES = 255
  private const val MAX_MIME_TYPE_LENGTH = 127
  private val mimeTypePattern = Regex("^[A-Za-z0-9!#\\$&^_.+-]+/[A-Za-z0-9!#\\$&^_.+-]+$")
  private val base64Pattern = Regex("^[A-Za-z0-9+/]*={0,2}$")

  fun validate(
    fileName: String,
    mimeType: String,
    base64Data: String,
  ): FileExportValidationError? {
    if (
      fileName.isBlank() ||
      fileName != fileName.trim() ||
      fileName == "." ||
      fileName == ".." ||
      fileName.toByteArray(Charsets.UTF_8).size > MAX_FILE_NAME_UTF8_BYTES ||
      fileName.any { it.code < 32 || it == '/' || it == '\\' }
    ) {
      return FileExportValidationError(
        "invalid-file-name",
        "The file name is invalid",
      )
    }

    if (
      mimeType.length > MAX_MIME_TYPE_LENGTH ||
      !mimeTypePattern.matches(mimeType)
    ) {
      return FileExportValidationError(
        "invalid-mime-type",
        "The MIME type is invalid",
      )
    }

    if (base64Data.length % 4 != 0 || !base64Pattern.matches(base64Data)) {
      return FileExportValidationError(
        "invalid-base64",
        "The file data is not valid base64",
      )
    }

    val padding = when {
      base64Data.endsWith("==") -> 2
      base64Data.endsWith('=') -> 1
      else -> 0
    }
    val decodedBytes = (base64Data.length.toLong() / 4L) * 3L - padding
    if (decodedBytes > MAX_DECODED_BYTES) {
      return FileExportValidationError(
        "payload-too-large",
        "The exported file exceeds 16 MiB",
      )
    }

    return null
  }

  fun validatePdf(
    fileName: String,
    mimeType: String,
    base64Data: String,
  ): FileExportValidationError? {
    val validationError = validate(fileName, mimeType, base64Data)
    if (validationError != null) {
      return validationError
    }
    if (mimeType != "application/pdf") {
      return FileExportValidationError(
        "invalid-mime-type",
        "Only application/pdf can be opened",
      )
    }
    return null
  }
}
