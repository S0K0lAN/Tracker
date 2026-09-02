package io.github.s0k0lan.focusflow

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechRecognitionValidationTest {
  @Test
  fun acceptsBoundedBcp47Locales() {
    assertTrue(SpeechRecognitionValidation.isValidLocale("ru-RU"))
    assertTrue(SpeechRecognitionValidation.isValidLocale("en"))
    assertTrue(SpeechRecognitionValidation.isValidLocale("zh-Hans-CN"))
    assertTrue(SpeechRecognitionValidation.isValidLocale("es-419"))
  }

  @Test
  fun rejectsUnderscoresAndMalformedTags() {
    assertFalse(SpeechRecognitionValidation.isValidLocale("ru_RU"))
    assertFalse(SpeechRecognitionValidation.isValidLocale("r-RU"))
    assertFalse(SpeechRecognitionValidation.isValidLocale("ru-"))
    assertFalse(SpeechRecognitionValidation.isValidLocale(""))
  }

  @Test
  fun rejectsUnboundedLocaleTags() {
    assertFalse(
      SpeechRecognitionValidation.isValidLocale(
        "en-Latn-US-variant1-variant2-variant3",
      ),
    )
  }
}
