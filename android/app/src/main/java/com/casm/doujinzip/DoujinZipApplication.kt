package com.casm.doujinzip

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.casm.doujinzip.data.SyncRepository
import com.casm.doujinzip.data.local.DoujinZipDatabase
import com.casm.doujinzip.data.network.CompanionClient
import com.casm.doujinzip.data.security.SecureConnectionStore
import com.casm.doujinzip.sync.SyncWorker
import java.util.concurrent.TimeUnit

class DoujinZipApplication : Application() {
    val repository: SyncRepository by lazy {
        SyncRepository(
            DoujinZipDatabase.getInstance(this),
            CompanionClient(),
            SecureConnectionStore(this),
        )
    }

    override fun onCreate() {
        super.onCreate()
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            PERIODIC_SYNC_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    private companion object {
        const val PERIODIC_SYNC_NAME = "companion-periodic-sync"
    }
}
