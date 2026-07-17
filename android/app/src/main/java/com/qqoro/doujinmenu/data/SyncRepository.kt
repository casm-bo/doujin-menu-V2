package com.qqoro.doujinmenu.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.room.withTransaction
import com.qqoro.doujinmenu.data.local.BookEntity
import com.qqoro.doujinmenu.data.local.DoujinMenuDatabase
import com.qqoro.doujinmenu.data.local.HistoryEntity
import com.qqoro.doujinmenu.data.local.PendingMutationEntity
import com.qqoro.doujinmenu.data.local.SyncMetadataEntity
import com.qqoro.doujinmenu.data.network.CompanionClient
import com.qqoro.doujinmenu.data.network.PrivateLanUrl
import com.qqoro.doujinmenu.data.security.SecureConnectionStore
import kotlinx.coroutines.flow.Flow
import java.time.Instant
import java.util.UUID

class SyncRepository(
    private val database: DoujinMenuDatabase,
    private val client: CompanionClient,
    private val connectionStore: SecureConnectionStore,
) {
    private val dao = database.syncDao()
    private val coverCache = object : LruCache<String, Bitmap>(COVER_CACHE_BYTES) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    fun observeBooks(): Flow<List<BookEntity>> = dao.observeBooks()

    fun hasConnection(): Boolean = connectionStore.load() != null

    suspend fun checkConnection() {
        val connection = requireConnection()
        client.checkConnection(connection.baseUrl, connection.token)
    }

    suspend fun loadCover(syncId: String): Bitmap? {
        val book = dao.getBook(syncId) ?: return null
        val cacheKey = "$syncId:${book.updatedAt.orEmpty()}"
        coverCache.get(cacheKey)?.let { return it }
        val connection = requireConnection()
        val bytes = client.getLibraryImage(
            connection.baseUrl,
            connection.token,
            book.coverUrl,
        )
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also {
            coverCache.put(cacheKey, it)
        }
    }

    suspend fun pair(baseUrl: String, code: String, deviceName: String) {
        val normalizedUrl = PrivateLanUrl.normalize(baseUrl)
        val result = client.pair(normalizedUrl, code, deviceName)
        connectionStore.save(normalizedUrl, result.deviceId, result.token)
        initialSync()
    }

    suspend fun initialSync() {
        val connection = requireConnection()
        val library = client.listBooks(connection.baseUrl, connection.token)
        val bootstrap = client.bootstrap(connection.baseUrl, connection.token)
        val stateBySyncId = bootstrap.books.associateBy { it.syncId }
        database.withTransaction {
            dao.clearBooks()
            dao.clearHistory()
            dao.clearPendingMutations()
            dao.upsertBooks(
                library.map { book ->
                    val state = stateBySyncId[book.syncId]
                    book.toEntity(state)
                },
            )
            dao.insertHistory(bootstrap.history.map { it.toEntity() })
            putCursor(bootstrap.cursor)
        }
    }

    suspend fun syncNow() {
        val connection = requireConnection()
        uploadPending(connection.baseUrl, connection.token)
        refreshLibrary(connection.baseUrl, connection.token)

        var cursor = getCursor()
        do {
            val payload = client.getChanges(connection.baseUrl, connection.token, cursor)
            database.withTransaction {
                payload.changes.forEach { change ->
                    applyRemoteState(change.state)
                    change.historyEvent?.let { dao.insertHistory(listOf(it.toEntity())) }
                }
                cursor = payload.cursor
                putCursor(cursor)
            }
        } while (payload.hasMore)
    }

    suspend fun updateCurrentPage(
        syncId: String,
        currentPage: Int,
        addHistory: Boolean = false,
    ) {
        database.withTransaction {
            val book = dao.getBook(syncId) ?: return@withTransaction
            val page = if (book.pageCount > 0) {
                currentPage.coerceIn(0, book.pageCount)
            } else {
                currentPage.coerceAtLeast(0)
            }
            val now = Instant.now().toString()
            val history = if (addHistory) {
                PendingHistoryEvent(UUID.randomUUID().toString(), now, page)
            } else {
                null
            }
            dao.upsertBook(book.copy(currentPage = page, lastReadAt = now))
            dao.insertPendingMutation(
                PendingMutationEntity(
                    mutationId = UUID.randomUUID().toString(),
                    bookSyncId = syncId,
                    baseVersion = book.version,
                    currentPage = page,
                    isFavorite = null,
                    historyEventId = history?.eventId,
                    historyViewedAt = history?.viewedAt,
                    historyCurrentPage = history?.currentPage,
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
    }

    suspend fun setFavorite(syncId: String, favorite: Boolean) {
        database.withTransaction {
            val book = dao.getBook(syncId) ?: return@withTransaction
            dao.upsertBook(book.copy(isFavorite = favorite))
            dao.insertPendingMutation(
                PendingMutationEntity(
                    mutationId = UUID.randomUUID().toString(),
                    bookSyncId = syncId,
                    baseVersion = book.version,
                    currentPage = null,
                    isFavorite = favorite,
                    historyEventId = null,
                    historyViewedAt = null,
                    historyCurrentPage = null,
                    createdAt = System.currentTimeMillis(),
                ),
            )
        }
    }

    fun disconnect() {
        connectionStore.clear()
        coverCache.evictAll()
    }

    private suspend fun uploadPending(baseUrl: String, token: String) {
        while (true) {
            val pending = dao.getPendingMutations(100)
            if (pending.isEmpty()) return
            val payload = client.pushChanges(baseUrl, token, pending.map { it.toMutation() })
            database.withTransaction {
                payload.results.forEach { result ->
                    result.state?.let { applyRemoteState(it) }
                }
                val completed = payload.results
                    .filter { it.status in COMPLETED_MUTATION_STATUSES }
                    .map { it.mutationId }
                if (completed.isNotEmpty()) dao.deletePendingMutations(completed)
            }
            if (payload.results.none { it.status in COMPLETED_MUTATION_STATUSES }) return
        }
    }

    private suspend fun refreshLibrary(baseUrl: String, token: String) {
        val books = client.listBooks(baseUrl, token)
        database.withTransaction {
            dao.upsertBooks(books.map { remote -> remote.toEntity(null) })
            if (books.isEmpty()) {
                dao.clearBooks()
            } else {
                dao.deleteBooksNotIn(books.map { it.syncId })
            }
        }
    }

    private suspend fun applyRemoteState(state: RemoteBookState) {
        val book = dao.getBook(state.syncId) ?: return
        if (state.version < book.version) return
        dao.upsertBook(
            book.copy(
                currentPage = state.currentPage,
                isFavorite = state.isFavorite,
                lastReadAt = state.lastReadAt,
                version = state.version,
                updatedAt = state.updatedAt,
            ),
        )
    }

    private suspend fun getCursor(): Long =
        dao.getMetadata(CURSOR_KEY)?.toLongOrNull() ?: 0L

    private suspend fun putCursor(cursor: Long) {
        dao.putMetadata(SyncMetadataEntity(CURSOR_KEY, cursor.toString()))
    }

    private fun requireConnection() = connectionStore.load()
        ?: error("데스크톱과 먼저 페어링하세요.")

    private fun RemoteBook.toEntity(state: RemoteBookState?): BookEntity = BookEntity(
        syncId = syncId,
        remoteId = remoteId,
        title = title,
        pageCount = pageCount,
        currentPage = state?.currentPage ?: currentPage,
        isFavorite = state?.isFavorite ?: isFavorite,
        lastReadAt = state?.lastReadAt ?: lastReadAt,
        version = state?.version ?: version,
        updatedAt = state?.updatedAt ?: updatedAt,
        coverUrl = coverUrl,
    )

    private fun RemoteHistoryEvent.toEntity() = HistoryEntity(
        eventId = eventId,
        bookSyncId = bookSyncId,
        viewedAt = viewedAt,
        currentPage = currentPage,
        deviceId = deviceId,
    )

    private fun PendingMutationEntity.toMutation() = SyncMutation(
        mutationId = mutationId,
        bookSyncId = bookSyncId,
        baseVersion = baseVersion,
        currentPage = currentPage,
        isFavorite = isFavorite,
        historyEvent = historyEventId?.let {
            PendingHistoryEvent(
                eventId = it,
                viewedAt = checkNotNull(historyViewedAt),
                currentPage = historyCurrentPage,
            )
        },
    )

    private companion object {
        const val COVER_CACHE_BYTES = 24 * 1024 * 1024
        const val CURSOR_KEY = "change_cursor"
        val COMPLETED_MUTATION_STATUSES = setOf("applied", "duplicate", "not_found")
    }
}
