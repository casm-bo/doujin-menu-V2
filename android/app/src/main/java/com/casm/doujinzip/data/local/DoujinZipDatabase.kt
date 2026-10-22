package com.casm.doujinzip.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        BookEntity::class,
        HistoryEntity::class,
        PendingMutationEntity::class,
        SyncMetadataEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class DoujinZipDatabase : RoomDatabase() {
    abstract fun syncDao(): SyncDao

    companion object {
        @Volatile private var instance: DoujinZipDatabase? = null

        fun getInstance(context: Context): DoujinZipDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    DoujinZipDatabase::class.java,
                    "doujinzip-sync.db",
                ).build().also { instance = it }
            }
    }
}
