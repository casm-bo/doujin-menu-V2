package com.qqoro.doujinmenu.data.local

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
abstract class DoujinMenuDatabase : RoomDatabase() {
    abstract fun syncDao(): SyncDao

    companion object {
        @Volatile private var instance: DoujinMenuDatabase? = null

        fun getInstance(context: Context): DoujinMenuDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    DoujinMenuDatabase::class.java,
                    "doujin-menu-sync.db",
                ).build().also { instance = it }
            }
    }
}
