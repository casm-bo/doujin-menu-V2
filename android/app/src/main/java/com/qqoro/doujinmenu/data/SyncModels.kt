package com.qqoro.doujinmenu.data

data class RemoteBook(
    val remoteId: Long,
    val syncId: String,
    val title: String,
    val pageCount: Int,
    val currentPage: Int,
    val isFavorite: Boolean,
    val lastReadAt: String?,
    val version: Long,
    val updatedAt: String?,
    val coverUrl: String,
)

data class RemoteBookState(
    val syncId: String,
    val currentPage: Int,
    val isFavorite: Boolean,
    val lastReadAt: String?,
    val version: Long,
    val updatedAt: String?,
)

data class RemoteHistoryEvent(
    val eventId: String,
    val bookSyncId: String,
    val viewedAt: String,
    val currentPage: Int?,
    val deviceId: String,
)

data class BootstrapPayload(
    val cursor: Long,
    val serverTime: String,
    val books: List<RemoteBookState>,
    val history: List<RemoteHistoryEvent>,
)

data class RemoteSyncChange(
    val cursor: Long,
    val state: RemoteBookState,
    val historyEvent: RemoteHistoryEvent?,
)

data class ChangesPayload(
    val cursor: Long,
    val hasMore: Boolean,
    val changes: List<RemoteSyncChange>,
)

data class SyncMutation(
    val mutationId: String,
    val bookSyncId: String,
    val baseVersion: Long,
    val currentPage: Int? = null,
    val isFavorite: Boolean? = null,
    val historyEvent: PendingHistoryEvent? = null,
)

data class PendingHistoryEvent(
    val eventId: String,
    val viewedAt: String,
    val currentPage: Int?,
)

data class MutationResult(
    val mutationId: String,
    val status: String,
    val conflict: Boolean,
    val state: RemoteBookState?,
)

data class PushPayload(
    val cursor: Long,
    val serverTime: String,
    val results: List<MutationResult>,
)

data class PairingResult(
    val deviceId: String,
    val deviceName: String,
    val token: String,
)
