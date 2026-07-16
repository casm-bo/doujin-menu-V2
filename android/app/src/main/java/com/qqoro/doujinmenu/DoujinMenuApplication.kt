package com.qqoro.doujinmenu

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.qqoro.doujinmenu.data.SyncRepository
import com.qqoro.doujinmenu.data.local.DoujinMenuDatabase
import com.qqoro.doujinmenu.data.network.CompanionClient
import com.qqoro.doujinmenu.data.security.SecureConnectionStore
import com.qqoro.doujinmenu.sync.SyncWorker
import java.util.concurrent.TimeUnit

class DoujinMenuApplication : Application() {
    val repository: SyncRepository by lazy {
        SyncRepository(
            DoujinMenuDatabase.getInstance(this),
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
