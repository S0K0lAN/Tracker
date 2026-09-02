package io.github.s0k0lan.focusflow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidWindowValidationTest {
  @Test
  fun convertsPhysicalPixelsToDensityIndependentPixels() {
    val result = AndroidWindowValidation.toDpInsets(
      topPx = 96,
      rightPx = 0,
      bottomPx = 144,
      leftPx = 3,
      density = 3f,
    )

    assertEquals(32.0, result?.top ?: -1.0, 0.0001)
    assertEquals(0.0, result?.right ?: -1.0, 0.0001)
    assertEquals(48.0, result?.bottom ?: -1.0, 0.0001)
    assertEquals(1.0, result?.left ?: -1.0, 0.0001)
  }

  @Test
  fun rejectsInvalidDensity() {
    assertNull(AndroidWindowValidation.toDpInsets(1, 1, 1, 1, 0f))
    assertNull(AndroidWindowValidation.toDpInsets(1, 1, 1, 1, Float.NaN))
    assertNull(AndroidWindowValidation.toDpInsets(1, 1, 1, 1, Float.POSITIVE_INFINITY))
  }

  @Test
  fun rejectsNegativeAndUnreasonablyLargeInsets() {
    assertNull(AndroidWindowValidation.toDpInsets(-1, 0, 0, 0, 1f))
    assertNull(AndroidWindowValidation.toDpInsets(4097, 0, 0, 0, 1f))
  }

  @Test
  fun acceptsOnlyBooleanThemeValues() {
    assertTrue(AndroidWindowValidation.parseDarkTheme(true) == true)
    assertFalse(AndroidWindowValidation.parseDarkTheme(false) ?: true)
    assertNull(AndroidWindowValidation.parseDarkTheme("true"))
    assertNull(AndroidWindowValidation.parseDarkTheme(1))
    assertNull(AndroidWindowValidation.parseDarkTheme(null))
  }
}
