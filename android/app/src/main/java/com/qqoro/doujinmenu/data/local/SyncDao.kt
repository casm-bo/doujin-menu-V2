package com.qqoro.doujinmenu.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface SyncDao {
    @Query("SELECT * FROM books ORDER BY title COLLATE NOCASE")
    fun observeBooks(): Flow<List<BookEntity>>

    @Query("SELECT * FROM books WHERE syncId = :syncId")
    suspend fun getBook(syncId: String): BookEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertBooks(books: List<BookEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertBook(book: BookEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertHistory(events: List<HistoryEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPendingMutation(mutation: PendingMutationEntity)

    @Query("SELECT * FROM pending_mutations ORDER BY createdAt LIMIT :limit")
    suspend fun getPendingMutations(limit: Int): List<PendingMutationEntity>

    @Query("DELETE FROM pending_mutations WHERE mutationId IN (:mutationIds)")
    suspend fun deletePendingMutations(mutationIds: List<String>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMetadata(metadata: SyncMetadataEntity)

    @Query("SELECT value FROM sync_metadata WHERE `key` = :key")
    suspend fun getMetadata(key: String): String?

    @Query("DELETE FROM books")
    suspend fun clearBooks()

    @Query("DELETE FROM books WHERE syncId NOT IN (:syncIds)")
    suspend fun deleteBooksNotIn(syncIds: List<String>)

    @Query("DELETE FROM history_events")
    suspend fun clearHistory()

    @Query("DELETE FROM pending_mutations")
    suspend fun clearPendingMutations()
}
