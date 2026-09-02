package io.github.s0k0lan.focusflow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileExportValidationTest {
  @Test
  fun acceptsPortableJsonExport() {
    assertNull(
      FileExportValidation.validate(
        "focus-flow-backup.json",
        "application/json",
        "e30=",
      ),
    )
  }

  @Test
  fun rejectsPathLikeFileNames() {
    val error = FileExportValidation.validate(
      "../backup.json",
      "application/json",
      "e30=",
    )

    assertEquals("invalid-file-name", error?.code)
  }

  @Test
  fun rejectsInvalidMimeTypes() {
    val error = FileExportValidation.validate(
      "backup.json",
      "application/json; charset=utf-8",
      "e30=",
    )

    assertEquals("invalid-mime-type", error?.code)
  }

  @Test
  fun rejectsMalformedBase64() {
    val error = FileExportValidation.validate(
      "backup.json",
      "application/json",
      "not base64",
    )

    assertEquals("invalid-base64", error?.code)
  }

  @Test
  fun rejectsPayloadOverDecodedLimitWithoutDecodingIt() {
    val encodedLength = ((FileExportValidation.MAX_DECODED_BYTES / 3) + 2) * 4
    val error = FileExportValidation.validate(
      "backup.json",
      "application/json",
      "A".repeat(encodedLength),
    )

    assertEquals("payload-too-large", error?.code)
  }

  @Test
  fun acceptsPdfPreview() {
    assertNull(
      FileExportValidation.validatePdf(
        "Документ.pdf",
        "application/pdf",
        "JVBERi0=",
      ),
    )
  }

  @Test
  fun rejectsNonPdfPreviewMimeType() {
    val error = FileExportValidation.validatePdf(
      "document.txt",
      "text/plain",
      "dGV4dA==",
    )

    assertEquals("invalid-mime-type", error?.code)
  }
}
