package com.casm.doujinmenu.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "books")
data class BookEntity(
    @PrimaryKey val syncId: String,
    val remoteId: Long,
    val title: String,
    val pageCount: Int,
    val currentPage: Int,
    val isFavorite: Boolean,
    val lastReadAt: String?,
    val version: Long,
    val updatedAt: String?,
    val coverUrl: String,
)

@Entity(
    tableName = "history_events",
    indices = [Index("bookSyncId"), Index("viewedAt")],
)
data class HistoryEntity(
    @PrimaryKey val eventId: String,
    val bookSyncId: String,
    val viewedAt: String,
    val currentPage: Int?,
    val deviceId: String,
)

@Entity(
    tableName = "pending_mutations",
    indices = [Index("bookSyncId"), Index("createdAt")],
)
data class PendingMutationEntity(
    @PrimaryKey val mutationId: String,
    val bookSyncId: String,
    val baseVersion: Long,
    val currentPage: Int?,
    val isFavorite: Boolean?,
    val historyEventId: String?,
    val historyViewedAt: String?,
    val historyCurrentPage: Int?,
    val createdAt: Long,
)

@Entity(tableName = "sync_metadata")
data class SyncMetadataEntity(
    @PrimaryKey val key: String,
    val value: String,
)
