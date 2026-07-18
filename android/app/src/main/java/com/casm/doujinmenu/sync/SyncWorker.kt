package com.casm.doujinmenu.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.casm.doujinmenu.DoujinMenuApplication
import java.io.IOException

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val repository = (applicationContext as DoujinMenuApplication).repository
        if (!repository.hasConnection()) return Result.success()
        return try {
            repository.syncNow()
            Result.success()
        } catch (_: IOException) {
            Result.retry()
        } catch (_: Exception) {
            Result.failure()
        }
    }
}
