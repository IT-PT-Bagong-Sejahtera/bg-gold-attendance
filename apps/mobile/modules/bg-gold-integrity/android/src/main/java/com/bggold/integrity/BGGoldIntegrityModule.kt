package com.bggold.integrity

import android.content.pm.PackageManager
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CLOUD_PROJECT_META_DATA = "com.bggold.integrity.CLOUD_PROJECT_NUMBER"

class BGGoldIntegrityModule : Module() {
  @Volatile
  private var tokenProvider: StandardIntegrityManager.StandardIntegrityTokenProvider? = null

  override fun definition() = ModuleDefinition {
    Name("BGGoldIntegrity")

    AsyncFunction("requestToken") { requestHash: String, promise: Promise ->
      if (requestHash.isBlank() || requestHash.length > 500) {
        promise.reject("E_INTEGRITY_HASH", "Hash permintaan Play Integrity tidak valid.", null)
        return@AsyncFunction
      }
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.reject("E_INTEGRITY_CONTEXT", "Konteks Android belum tersedia.", null)
        return@AsyncFunction
      }
      val metadata = context.packageManager.getApplicationInfo(
        context.packageName,
        PackageManager.GET_META_DATA,
      ).metaData
      val cloudProjectNumber = metadata?.getString(CLOUD_PROJECT_META_DATA)?.toLongOrNull()
        ?: metadata?.getLong(CLOUD_PROJECT_META_DATA, 0L)
        ?: 0L
      if (cloudProjectNumber <= 0L) {
        promise.reject("E_INTEGRITY_CONFIG", "PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER belum dikonfigurasi.", null)
        return@AsyncFunction
      }
      val manager = IntegrityManagerFactory.createStandard(context)
      val existing = tokenProvider
      if (existing != null) {
        request(existing, requestHash, promise)
        return@AsyncFunction
      }
      manager.prepareIntegrityToken(
        StandardIntegrityManager.PrepareIntegrityTokenRequest.builder()
          .setCloudProjectNumber(cloudProjectNumber)
          .build(),
      ).addOnSuccessListener { prepared ->
        tokenProvider = prepared
        request(prepared, requestHash, promise)
      }.addOnFailureListener { error ->
        promise.reject("E_INTEGRITY_PREPARE", "Play Integrity belum dapat disiapkan: ${error.message ?: "unknown"}", error)
      }
    }
  }

  private fun request(
    provider: StandardIntegrityManager.StandardIntegrityTokenProvider,
    requestHash: String,
    promise: Promise,
  ) {
    provider.request(
      StandardIntegrityManager.StandardIntegrityTokenRequest.builder()
        .setRequestHash(requestHash)
        .build(),
    ).addOnSuccessListener { response ->
      promise.resolve(response.token())
    }.addOnFailureListener { error ->
      tokenProvider = null
      promise.reject("E_INTEGRITY_REQUEST", "Pemeriksaan Play Integrity gagal: ${error.message ?: "unknown"}", error)
    }
  }
}
